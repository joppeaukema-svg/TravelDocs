import { useLiveQuery } from 'dexie-react-hooks';
import { db, getMeta, isDemo, setMeta } from '../db/db';
import type { PushEntry } from './schedule';

/**
 * Push notifications through the small sender in push/ (a Cloudflare Worker).
 * Only the push subscription and { at, title, url } entries are sent to it.
 * Off until you turn it on in Settings; not available unless the site was
 * built with VITE_PUSH_URL.
 */
export const PUSH_URL = (import.meta.env.VITE_PUSH_URL as string | undefined)?.replace(/\/+$/, '') || '';

const KEY = 'push';

export interface PushState {
  id: string;
  token: string;
  enabledAt: string;
  lastSync?: { hash: string; at: string; entries: number };
  error?: string;
}

export type PushSupport = 'unconfigured' | 'demo' | 'unsupported' | 'needs-install' | 'ok';

export function pushSupport(): PushSupport {
  if (!PUSH_URL) return 'unconfigured';
  // The browser has one push subscription per site, shared with your real data.
  if (isDemo) return 'demo';
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return ios ? 'needs-install' : 'unsupported';
  }
  return 'ok';
}

export function usePushState(): PushState | null | undefined {
  return useLiveQuery(async () => ((await getMeta(KEY)) as PushState | undefined) ?? null, []);
}

function randomId(bytes: number): string {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64u(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function api(path: string, method: string, token?: string, body?: unknown): Promise<Response> {
  const res = await fetch(`${PUSH_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const msg = ((await res.json().catch(() => ({}))) as { error?: string }).error;
    throw new Error(msg ? `Push server: ${msg}` : `Push server answered ${res.status}`);
  }
  return res;
}

async function hashOf(value: unknown): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

/** Asks for permission, subscribes and sends the schedule. Call from a tap. */
export async function enablePush(schedule: PushEntry[]): Promise<void> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notifications are not allowed for this app. Allow them in the phone settings and try again.');
  const reg = await navigator.serviceWorker.ready;
  const { publicKey } = (await (await api('/vapid', 'GET')).json()) as { publicKey: string };
  if (!(await reg.pushManager.getSubscription())) {
    await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromB64u(publicKey) });
  }
  const state: PushState = { id: randomId(18), token: randomId(32), enabledAt: new Date().toISOString() };
  await setMeta(KEY, state);
  await syncPush(schedule, true);
}

/** Sends the schedule when it (or the subscription) changed since the last sync. */
export async function syncPush(schedule: PushEntry[], force = false): Promise<void> {
  const state = (await getMeta(KEY)) as PushState | undefined;
  if (!state) return;
  try {
    const sub = await currentSubscription();
    if (!sub) throw new Error('This phone is no longer subscribed. Turn notifications off and on again.');
    const subscription = sub.toJSON();
    const hash = await hashOf([subscription.endpoint, schedule]);
    if (!force && state.lastSync?.hash === hash) return;
    await api(`/subscriptions/${state.id}`, 'PUT', state.token, { subscription, schedule });
    await setMeta(KEY, { id: state.id, token: state.token, enabledAt: state.enabledAt, lastSync: { hash, at: new Date().toISOString(), entries: schedule.length } } satisfies PushState);
  } catch (err) {
    await setMeta(KEY, { ...state, error: err instanceof Error ? err.message : String(err) } satisfies PushState);
    if (force) throw err;
  }
}

export async function testPush(): Promise<void> {
  const state = (await getMeta(KEY)) as PushState | undefined;
  if (!state) throw new Error('Notifications are off.');
  await api(`/subscriptions/${state.id}/test`, 'POST', state.token);
}

/** Deletes everything on the server and unsubscribes this phone. */
export async function disablePush(): Promise<void> {
  const state = (await getMeta(KEY)) as PushState | undefined;
  if (state) await api(`/subscriptions/${state.id}`, 'DELETE', state.token).catch(() => undefined);
  await (await currentSubscription().catch(() => null))?.unsubscribe();
  await db.meta.delete(KEY);
}
