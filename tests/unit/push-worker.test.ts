import { describe, expect, it, vi } from 'vitest';
import worker, { sendDue, type Env, type KV } from '../../push/src/worker';
import { b64u, concat, encrypt, fromB64u, generateVapidKeys, hkdf, vapidAuthorization } from '../../push/src/webpush';

const enc = new TextEncoder();

/** A browser's side of a subscription: its key pair and auth secret. */
async function userAgent() {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return { pair, pub, auth, sub: { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: b64u(pub), auth: b64u(auth) } } };
}

/** Decrypts like a browser does (RFC 8291). */
async function decrypt(body: Uint8Array, ua: Awaited<ReturnType<typeof userAgent>>): Promise<string> {
  const salt = body.slice(0, 16);
  const rs = new DataView(body.buffer, body.byteOffset).getUint32(16);
  const idlen = body[20]!;
  const asPublic = body.slice(21, 21 + idlen);
  const ct = body.slice(21 + idlen);
  expect(rs).toBe(4096);
  const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, ua.pair.privateKey, 256));
  const ikm = await hkdf(ua.auth, secret, concat(enc.encode('WebPush: info\0'), ua.pub, asPublic), 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, ct));
  expect(plain[plain.length - 1]).toBe(2);
  return new TextDecoder().decode(plain.slice(0, -1));
}

function memoryKV(): KV & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get: async (k) => data.get(k) ?? null,
    put: async (k, v) => void data.set(k, v),
    delete: async (k) => void data.delete(k),
    list: async ({ prefix }) => ({ keys: [...data.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }),
  };
}

async function env(): Promise<Env & { SUBS: ReturnType<typeof memoryKV> }> {
  const keys = await generateVapidKeys();
  return {
    SUBS: memoryKV(),
    VAPID_PUBLIC_KEY: keys.publicKey,
    VAPID_PRIVATE_KEY: keys.privateKey,
    VAPID_SUBJECT: 'https://example.github.io/TravelDocs/',
    ALLOWED_ORIGIN: 'https://example.github.io',
  };
}

const TOKEN = 'x'.repeat(40);
const ID = 'phone-0123456789abcdef';
const call = (e: Env, method: string, path: string, body?: unknown, token = TOKEN) =>
  worker.fetch(
    new Request(`https://push.example.workers.dev${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
    e,
  );

describe('web push crypto', () => {
  it('encrypts so the browser can decrypt it (aes128gcm)', async () => {
    const ua = await userAgent();
    const body = await encrypt(enc.encode('{"title":"Laos prep: 3 tasks due"}'), ua.sub);
    expect(await decrypt(body, ua)).toBe('{"title":"Laos prep: 3 tasks due"}');
  });

  it('matches the RFC 8291 test vector (appendix A)', async () => {
    const asPub = fromB64u('BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8');
    const jwk = { kty: 'EC', crv: 'P-256', x: b64u(asPub.slice(1, 33)), y: b64u(asPub.slice(33)) };
    const serverKeys = {
      publicKey: await crypto.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, true, []),
      privateKey: await crypto.subtle.importKey('jwk', { ...jwk, d: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw' }, { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']),
    };
    const body = await encrypt(
      enc.encode('When I grow up, I want to be a watermelon'),
      {
        endpoint: 'https://fcm.googleapis.com/x',
        keys: {
          p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
          auth: 'BTBZMqHH6r4Tts7J_aSIgg',
        },
      },
      { salt: fromB64u('DGv6ra1nlYgDCS1FRnbzlw'), serverKeys },
    );
    expect(b64u(body)).toBe(
      'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
    );
  });

  it('signs a VAPID token the push service can verify', async () => {
    const keys = { ...(await generateVapidKeys()), subject: 'mailto:test@example.org' };
    const header = await vapidAuthorization('https://web.push.apple.com/abc/def', keys, Date.UTC(2026, 9, 1));
    const [, jwt, k] = /^vapid t=([^,]+), k=(.+)$/.exec(header)!;
    expect(k).toBe(keys.publicKey);
    const [h, c, s] = jwt!.split('.');
    const claims = JSON.parse(new TextDecoder().decode(fromB64u(c!)));
    expect(claims).toMatchObject({ aud: 'https://web.push.apple.com', sub: 'mailto:test@example.org' });
    expect(claims.exp).toBe(Date.UTC(2026, 9, 1) / 1000 + 12 * 3600);
    const pub = await crypto.subtle.importKey('raw', fromB64u(keys.publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    expect(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, fromB64u(s!), enc.encode(`${h}.${c}`))).toBe(true);
  });
});

describe('push worker API', () => {
  it('stores a subscription and schedule, and only the owner can change or delete it', async () => {
    const e = await env();
    const ua = await userAgent();
    const schedule = [{ at: '2026-10-21T01:00:00Z', title: 'Laos prep: 3 tasks due', url: '#/checklists/la' }];
    const res = await call(e, 'PUT', `/subscriptions/${ID}`, { subscription: ua.sub, schedule });
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://example.github.io');

    const stored = JSON.parse(e.SUBS.data.get(`sub:${ID}`)!);
    expect(Object.keys(stored).sort()).toEqual(['schedule', 'subscription', 'tokenHash', 'updatedAt']);
    expect(stored.tokenHash).not.toContain(TOKEN);
    expect(stored.schedule).toEqual([{ at: '2026-10-21T01:00:00.000Z', title: 'Laos prep: 3 tasks due', url: '#/checklists/la' }]);

    expect((await call(e, 'PUT', `/subscriptions/${ID}`, { subscription: ua.sub, schedule: [] }, 'y'.repeat(40))).status).toBe(403);
    expect((await call(e, 'DELETE', `/subscriptions/${ID}`, undefined, 'y'.repeat(40))).status).toBe(403);
    expect((await call(e, 'DELETE', `/subscriptions/${ID}`)).status).toBe(200);
    expect(e.SUBS.data.size).toBe(0);
  });

  it('rejects endpoints that are not push services, bad entries and short tokens', async () => {
    const e = await env();
    const ua = await userAgent();
    const bad = (sub: unknown, schedule: unknown, token?: string) => call(e, 'PUT', `/subscriptions/${ID}`, { subscription: sub, schedule }, token);
    expect((await bad({ ...ua.sub, endpoint: 'https://evil.example.com/x' }, [])).status).toBe(400);
    expect((await bad({ ...ua.sub, endpoint: 'http://fcm.googleapis.com/x' }, [])).status).toBe(400);
    expect((await bad(ua.sub, [{ at: 'soon', title: 'x', url: '#/today' }])).status).toBe(400);
    expect((await bad(ua.sub, [{ at: '2026-10-21T01:00:00Z', title: 'x', url: 'https://evil.example.com' }])).status).toBe(400);
    expect((await bad(ua.sub, [{ at: '2026-10-21T01:00:00Z', title: 'x'.repeat(81), url: '#/today' }])).status).toBe(400);
    expect((await bad(ua.sub, [], 'short')).status).toBe(401);
    expect(e.SUBS.data.size).toBe(0);
    expect((await worker.fetch(new Request('https://w/subscriptions/x', { method: 'OPTIONS' }), e)).status).toBe(204);
    expect(await (await call(e, 'GET', '/vapid')).json()).toEqual({ publicKey: e.VAPID_PUBLIC_KEY });
  });
});

describe('scheduled sender', () => {
  it('sends what is due, keeps the rest, forgets gone subscriptions', async () => {
    const e = await env();
    const ua = await userAgent();
    const now = Date.parse('2026-10-21T01:02:00Z');
    await call(e, 'PUT', `/subscriptions/${ID}`, {
      subscription: ua.sub,
      schedule: [
        { at: '2026-10-19T01:00:00Z', title: 'Too late', url: '#/checklists' },
        { at: '2026-10-21T01:00:00Z', title: 'Laos prep: 3 tasks due', url: '#/checklists/la' },
        { at: '2026-10-25T01:00:00Z', title: 'Leaving Laos: 2 tasks', url: '#/checklists/la' },
      ],
    });

    const bodies: string[] = [];
    const fetchOk = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      bodies.push(await decrypt(init!.body as Uint8Array, ua));
      expect((init!.headers as Record<string, string>)['Content-Encoding']).toBe('aes128gcm');
      return new Response(null, { status: 201 });
    }) as unknown as typeof fetch;

    expect(await sendDue(e, now, fetchOk)).toEqual({ sent: 1, removed: 0 });
    expect(bodies.map((b) => JSON.parse(b))).toEqual([{ title: 'Laos prep: 3 tasks due', body: 'Open your checklist', url: '#/checklists/la' }]);
    expect(JSON.parse(e.SUBS.data.get(`sub:${ID}`)!).schedule.map((x: { title: string }) => x.title)).toEqual(['Leaving Laos: 2 tasks']);

    const gone = vi.fn(async () => new Response(null, { status: 410 })) as unknown as typeof fetch;
    expect(await sendDue(e, Date.parse('2026-10-25T01:01:00Z'), gone)).toEqual({ sent: 0, removed: 1 });
    expect(e.SUBS.data.size).toBe(0);
  });
});
