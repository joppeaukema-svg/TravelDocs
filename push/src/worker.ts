/**
 * The scheduled sender for Travel Companion push notifications, and the relay
 * for syncing a trip between the travellers' phones.
 *
 * Push: it stores, per phone, only the push subscription and a list of
 * { at, title, url } entries such as "Laos prep: 3 tasks due" — no names,
 * documents, bookings or places beyond the country. Every few minutes the
 * cron trigger sends what's due and forgets it.
 *
 * Sync: see "Trip sync" below. It only ever holds trips encrypted on the phones.
 */
import { generateVapidKeys, sendPush, type PushSubscriptionJSON, type VapidKeys } from './webpush';

export interface KV {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
  list(opts: { prefix: string; cursor?: string }): Promise<{ keys: { name: string }[]; list_complete: boolean; cursor?: string }>;
}

export interface Env {
  SUBS: KV;
  /** Optional: fixed keys. Without them the worker makes a key pair once and keeps it in SUBS. */
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT: string;
  /** The app's origin, e.g. https://you.github.io — the only site allowed to call the API. */
  ALLOWED_ORIGIN: string;
}

export interface Entry {
  /** UTC instant, ISO 8601. */
  at: string;
  title: string;
  /** In-app route, e.g. "#/checklists/la". */
  url: string;
}

interface Record {
  tokenHash: string;
  subscription: PushSubscriptionJSON;
  schedule: Entry[];
  updatedAt: string;
}

const MAX_ENTRIES = 300;
const KEEP_SECONDS = 180 * 86400; // forgotten 180 days after the app last synced
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /(^|\.)push\.apple\.com$/, /^updates\.push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/];

const keyOf = (id: string) => `sub:${id}`;

async function sha256(text: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const VAPID_KEY = 'config:vapid';

/** The VAPID keys: from the environment, else made on first use and stored (never returned) in KV. */
async function vapid(env: Env): Promise<VapidKeys> {
  if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
    return { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT };
  }
  const stored = await env.SUBS.get(VAPID_KEY);
  let keys = stored ? (JSON.parse(stored) as { publicKey: string; privateKey: string }) : null;
  if (!keys) {
    keys = await generateVapidKeys();
    await env.SUBS.put(VAPID_KEY, JSON.stringify(keys));
  }
  return { ...keys, subject: env.VAPID_SUBJECT };
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function validSubscription(s: unknown): PushSubscriptionJSON {
  const sub = s as PushSubscriptionJSON;
  let host = '';
  try {
    const u = new URL(sub.endpoint);
    if (u.protocol !== 'https:') throw new Error();
    host = u.hostname;
  } catch {
    throw new HttpError(400, 'Invalid endpoint');
  }
  // Only real push services: the worker must never become a way to POST to arbitrary URLs.
  if (!PUSH_HOSTS.some((re) => re.test(host))) throw new HttpError(400, 'Unknown push service');
  if (typeof sub.keys?.p256dh !== 'string' || typeof sub.keys?.auth !== 'string') throw new HttpError(400, 'Missing keys');
  return { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } };
}

function validSchedule(s: unknown): Entry[] {
  if (!Array.isArray(s) || s.length > MAX_ENTRIES) throw new HttpError(400, 'Invalid schedule');
  return s.map((e: Partial<Entry>) => {
    if (typeof e.at !== 'string' || Number.isNaN(Date.parse(e.at))) throw new HttpError(400, 'Invalid time');
    if (typeof e.title !== 'string' || !e.title || e.title.length > 80) throw new HttpError(400, 'Invalid title');
    if (typeof e.url !== 'string' || !/^#\/[a-z0-9/_-]*$/i.test(e.url)) throw new HttpError(400, 'Invalid url');
    return { at: new Date(e.at).toISOString(), title: e.title, url: e.url };
  });
}

async function authorised(env: Env, id: string, token: string | undefined): Promise<Record | null> {
  const raw = await env.SUBS.get(keyOf(id));
  if (!raw) return null;
  const rec = JSON.parse(raw) as Record;
  if (!token || (await sha256(token)) !== rec.tokenHash) throw new HttpError(403, 'Wrong token');
  return rec;
}

const bearer = (req: Request) => req.headers.get('Authorization')?.replace(/^Bearer /, '');

// --- Trip sync ----------------------------------------------------------------
//
// A mailbox per trip. Each phone keeps one slot in it: the whole shared trip,
// encrypted on the phone with the trip code — the same text it would paste into
// a chat. The mailbox name is derived from the trip code on the phone (PBKDF2),
// so this worker never learns the code and can't read anything it stores. A slot
// can only be replaced or removed with the key the phone created it with.

const SYNC_KEEP_SECONDS = 180 * 86400;
const MAX_SYNC_CHARS = 3_000_000;
const MAX_PHONES = 8;

interface SyncSlot {
  at: string;
  size: number;
  tokenHash: string;
}
type SyncIndex = { [phone: string]: SyncSlot };

const boxKey = (box: string) => `sync:${box}`;
const slotKey = (box: string, phone: string) => `sync:${box}:${phone}`;

async function syncIndex(env: Env, box: string): Promise<SyncIndex> {
  const raw = await env.SUBS.get(boxKey(box));
  return raw ? (JSON.parse(raw) as SyncIndex) : {};
}

async function handleSync(req: Request, env: Env, box: string, phone: string | undefined): Promise<Response> {
  const index = await syncIndex(env, box);
  if (!phone) {
    if (req.method !== 'GET') throw new HttpError(405, 'Method not allowed');
    return Response.json({ phones: Object.fromEntries(Object.entries(index).map(([p, s]) => [p, { at: s.at, size: s.size }])) });
  }
  if (req.method === 'GET') {
    const text = index[phone] ? await env.SUBS.get(slotKey(box, phone)) : null;
    if (!text) throw new HttpError(404, 'Nothing from that phone');
    return new Response(text, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
  }
  const token = bearer(req);
  if (!token || token.length < 32) throw new HttpError(401, 'Missing token');
  const existing = index[phone];
  if (existing && (await sha256(token)) !== existing.tokenHash) throw new HttpError(403, 'Wrong token');

  if (req.method === 'PUT') {
    const text = await req.text();
    // Only the app's encrypted share text: nothing else can be parked here.
    if (!/^TC1\.[A-Za-z0-9_-]+\.$/.test(text) || text.length > MAX_SYNC_CHARS) throw new HttpError(400, 'Not an encrypted trip');
    if (!existing && Object.keys(index).length >= MAX_PHONES) throw new HttpError(409, 'Too many phones on this trip');
    const at = new Date().toISOString();
    await env.SUBS.put(slotKey(box, phone), text, { expirationTtl: SYNC_KEEP_SECONDS });
    // Read again just before writing, so a phone that sent at the same moment isn't dropped.
    const fresh = await syncIndex(env, box);
    fresh[phone] = { at, size: text.length, tokenHash: existing?.tokenHash ?? (await sha256(token)) };
    await env.SUBS.put(boxKey(box), JSON.stringify(fresh), { expirationTtl: SYNC_KEEP_SECONDS });
    return Response.json({ ok: true, at });
  }
  if (req.method === 'DELETE') {
    if (existing) {
      await env.SUBS.delete(slotKey(box, phone));
      const fresh = await syncIndex(env, box);
      delete fresh[phone];
      if (Object.keys(fresh).length) await env.SUBS.put(boxKey(box), JSON.stringify(fresh), { expirationTtl: SYNC_KEEP_SECONDS });
      else await env.SUBS.delete(boxKey(box));
    }
    return Response.json({ ok: true });
  }
  throw new HttpError(405, 'Method not allowed');
}

async function handle(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const json = (body: unknown, status = 200) => Response.json(body, { status });

  if (req.method === 'GET' && url.pathname === '/vapid') return json({ publicKey: (await vapid(env)).publicKey });

  const sync = /^\/sync\/([0-9a-f]{64})(?:\/([A-Za-z0-9_-]{16,64}))?$/.exec(url.pathname);
  if (sync) return handleSync(req, env, sync[1]!, sync[2]);

  const m = /^\/subscriptions\/([A-Za-z0-9_-]{16,64})(\/test)?$/.exec(url.pathname);
  if (!m) throw new HttpError(404, 'Not found');
  const id = m[1]!;

  if (req.method === 'PUT' && !m[2]) {
    const body = (await req.json()) as { subscription?: unknown; schedule?: unknown };
    const token = bearer(req);
    if (!token || token.length < 32) throw new HttpError(401, 'Missing token');
    const existing = await authorised(env, id, token);
    const rec: Record = {
      tokenHash: existing?.tokenHash ?? (await sha256(token)),
      subscription: validSubscription(body.subscription),
      schedule: validSchedule(body.schedule).sort((a, b) => a.at.localeCompare(b.at)),
      updatedAt: new Date().toISOString(),
    };
    await env.SUBS.put(keyOf(id), JSON.stringify(rec), { expirationTtl: KEEP_SECONDS });
    return json({ ok: true, entries: rec.schedule.length });
  }

  if (req.method === 'DELETE' && !m[2]) {
    if (await authorised(env, id, bearer(req))) await env.SUBS.delete(keyOf(id));
    return json({ ok: true });
  }

  if (req.method === 'POST' && m[2]) {
    const rec = await authorised(env, id, bearer(req));
    if (!rec) throw new HttpError(404, 'Unknown subscription');
    const status = await sendPush(rec.subscription, { title: 'Travel Companion', body: 'Test notification — push works on this phone.', url: '#/today' }, await vapid(env));
    if (status === 404 || status === 410) await env.SUBS.delete(keyOf(id));
    return json({ ok: status < 300, status }, status < 300 ? 200 : 502);
  }

  throw new HttpError(405, 'Method not allowed');
}

function cors(env: Env, res: Response): Response {
  const h = new Headers(res.headers);
  h.set('Access-Control-Allow-Origin', env.ALLOWED_ORIGIN);
  h.set('Access-Control-Allow-Methods', 'GET, PUT, POST, DELETE, OPTIONS');
  h.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  h.set('Access-Control-Max-Age', '86400');
  h.set('Vary', 'Origin');
  return new Response(res.body, { status: res.status, headers: h });
}

/** Sends everything that's due. Entries more than a day late are dropped unsent. */
export async function sendDue(env: Env, now = Date.now(), fetchImpl: typeof fetch = fetch): Promise<{ sent: number; removed: number }> {
  let sent = 0;
  let removed = 0;
  let cursor: string | undefined;
  let keys: VapidKeys | undefined;
  do {
    const page = await env.SUBS.list({ prefix: 'sub:', ...(cursor ? { cursor } : {}) });
    for (const { name } of page.keys) {
      const raw = await env.SUBS.get(name);
      if (!raw) continue;
      const rec = JSON.parse(raw) as Record;
      const due = rec.schedule.filter((e) => Date.parse(e.at) <= now);
      if (!due.length) continue;
      rec.schedule = rec.schedule.filter((e) => Date.parse(e.at) > now);
      let gone = false;
      // Several due at once (a missed run): send the latest few, not a burst.
      for (const e of due.filter((x) => now - Date.parse(x.at) < 86400_000).slice(-3)) {
        const status = await sendPush(rec.subscription, { title: e.title, body: 'Open your checklist', url: e.url }, (keys ??= await vapid(env)), fetchImpl);
        if (status === 404 || status === 410) {
          gone = true;
          break;
        }
        if (status < 300) sent++;
      }
      if (gone) {
        await env.SUBS.delete(name);
        removed++;
      } else {
        await env.SUBS.put(name, JSON.stringify(rec), { expirationTtl: KEEP_SECONDS });
      }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return { sent, removed };
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === 'OPTIONS') return cors(env, new Response(null, { status: 204 }));
    try {
      return cors(env, await handle(req, env));
    } catch (err) {
      const status = err instanceof HttpError ? err.status : err instanceof SyntaxError ? 400 : 500;
      return cors(env, Response.json({ error: err instanceof Error ? err.message : 'Error' }, { status }));
    }
  },
  async scheduled(_event: unknown, env: Env): Promise<void> {
    await sendDue(env);
  },
};
