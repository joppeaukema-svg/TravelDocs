import { useLiveQuery } from 'dexie-react-hooks';
import { randomBytes, toBase64, utf8Encode } from '../crypto/bytes';
import { PBKDF2_ITERATIONS } from '../crypto/keys';
import { getMeta, isDemo, META, setMeta } from '../db/db';
import { PUSH_URL } from '../push/push';
import { decryptShare, encryptShare, normaliseCode, shareBytesFrom, sharePayload, shareToken, WrongTripCodeError } from '../trip/share';
import { applySharedTrip, getShareStatus, getTombstones, loadPhoneData, loadTrip, markReceived, markSent } from '../trip/store';

/**
 * Automatic sync between the travellers' phones, through the relay in push/
 * (the same Cloudflare Worker as the push notifications, on your own account).
 *
 * Each phone keeps one slot in a mailbox for the trip: everything it shares,
 * encrypted on the phone with the trip code — the same text Travelling together
 * would paste into a chat. The mailbox name is derived from the trip code with
 * PBKDF2, so the relay never learns the code and can't read what it keeps. The
 * phones fetch each other's slots and merge them with the usual rules (newest
 * edit wins, deletions carry over). Off until turned on, on each phone.
 */

export const SYNC_AVAILABLE = !!PUSH_URL && !isDemo;

const KEY = 'sync';

export interface SyncState {
  enabled: boolean;
  /** This phone's slot in the mailbox, and the key that guards it. */
  phone: string;
  token: string;
  /** The mailbox for the current trip code (deriving it takes a moment, so it's kept). */
  mailbox?: { code: string; id: string };
  /** Per other phone: the time of its slot that was last merged here. */
  seen: Record<string, string>;
  lastSyncAt?: string;
  /** When changes from the other phone last came in. */
  lastReceivedAt?: string;
  error?: string;
}

const b64url = (bytes: Uint8Array) => toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export async function getSyncState(): Promise<SyncState> {
  const stored = (await getMeta(KEY)) as SyncState | undefined;
  if (stored) return stored;
  return { enabled: false, phone: b64url(randomBytes(18)), token: b64url(randomBytes(32)), seen: {} };
}

async function saveSyncState(patch: Partial<SyncState>): Promise<SyncState> {
  const next = { ...(await getSyncState()), ...patch };
  await setMeta(KEY, next);
  return next;
}

export function useSyncState(): SyncState | undefined {
  return useLiveQuery(getSyncState, []);
}

/** The mailbox name for a trip code: slow to derive on purpose, like the encryption key. */
export async function mailboxId(code: string, iterations = PBKDF2_ITERATIONS): Promise<string> {
  const base = await crypto.subtle.importKey('raw', utf8Encode(normaliseCode(code)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: utf8Encode('travel-companion-sync-mailbox/1'), iterations },
    base,
    256,
  );
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

interface Relay {
  url: string;
  fetch: typeof fetch;
}
const defaultRelay = (): Relay => ({ url: PUSH_URL, fetch: (...args) => fetch(...args) });

async function call(relay: Relay, path: string, init?: RequestInit): Promise<Response> {
  const res = await relay.fetch(`${relay.url}${path}`, { cache: 'no-store', ...init });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      message = ((await res.json()) as { error?: string }).error ?? message;
    } catch {
      // Not JSON: keep the status.
    }
    throw new Error(message);
  }
  return res;
}

/**
 * One round: merge what the other phones sent since last time, then send this
 * phone's share if something changed here (or the relay no longer has it).
 */
export async function syncOnce(relay: Relay = defaultRelay()): Promise<void> {
  const state = await getSyncState();
  if (!state.enabled || !relay.url) return;
  const code = (await getMeta(META.shareCode)) as string | undefined;
  if (!code) return;
  try {
    let mailbox = state.mailbox?.code === code ? state.mailbox.id : undefined;
    if (!mailbox) {
      mailbox = await mailboxId(code);
      await saveSyncState({ mailbox: { code, id: mailbox }, seen: {} });
    }
    const { phones } = (await (await call(relay, `/sync/${mailbox}`)).json()) as { phones: Record<string, { at: string }> };

    const seen = { ...state.seen };
    let received: string | undefined;
    let problem: string | undefined;
    for (const [phone, slot] of Object.entries(phones)) {
      if (phone === state.phone || seen[phone] === slot.at) continue;
      const text = await (await call(relay, `/sync/${mailbox}/${phone}`)).text();
      try {
        const { payload, createdAt } = await decryptShare(shareBytesFrom(text), code);
        await applySharedTrip(payload);
        await markReceived(createdAt);
        received = new Date().toISOString();
      } catch (err) {
        if (!(err instanceof WrongTripCodeError)) throw err;
        problem = 'A phone in this mailbox uses a different trip code.';
      }
      seen[phone] = slot.at;
    }

    const { unsent } = await getShareStatus();
    const trip = await loadTrip();
    if (trip && (unsent > 0 || !phones[state.phone])) {
      const blob = await encryptShare(sharePayload(trip, await getTombstones(), await loadPhoneData()), code);
      await call(relay, `/sync/${mailbox}/${state.phone}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'text/plain', Authorization: `Bearer ${state.token}` },
        body: shareToken(new Uint8Array(await blob.arrayBuffer())),
      });
      // Only the edits counted before this round: anything made meanwhile goes next time.
      await markSent(undefined, unsent);
    }

    await saveSyncState({
      seen,
      lastSyncAt: new Date().toISOString(),
      ...(received ? { lastReceivedAt: received } : {}),
      error: problem,
    });
  } catch (err) {
    await saveSyncState({ error: err instanceof Error ? err.message : String(err) });
  }
}

let running: Promise<void> | null = null;

/** Syncs now, unless a round is already running (then waits for that one). Skipped offline. */
export function syncNow(): Promise<void> {
  if (!SYNC_AVAILABLE || (typeof navigator !== 'undefined' && navigator.onLine === false)) return Promise.resolve();
  running ??= syncOnce().finally(() => {
    running = null;
  });
  return running;
}

/** Turns sync on (and syncs) or off (and takes this phone's slot off the relay). */
export async function setSyncEnabled(on: boolean, relay?: Relay): Promise<void> {
  const state = await saveSyncState({ enabled: on, error: undefined });
  if (on) {
    await (relay ? syncOnce(relay) : syncNow());
    return;
  }
  relay ??= defaultRelay();
  if (state.mailbox && relay.url) {
    try {
      await call(relay, `/sync/${state.mailbox.id}/${state.phone}`, { method: 'DELETE', headers: { Authorization: `Bearer ${state.token}` } });
    } catch {
      // Offline or already gone: the relay forgets it after 180 days anyway.
    }
  }
  await saveSyncState({ seen: {}, lastSyncAt: undefined, lastReceivedAt: undefined });
}

