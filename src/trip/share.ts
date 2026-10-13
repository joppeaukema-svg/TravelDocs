import { z } from 'zod';
import { concatBytes, fromBase64, randomBytes, toBase64, toBytes, utf8Decode, utf8Encode, type Bytes } from '../crypto/bytes';
import { PBKDF2_ITERATIONS } from '../crypto/keys';
import type { TripData } from './io';
import { Expense, SharedBudgets, Travellers, type ForWhom } from '../money/schema';
import { Booking, Day, Stay, TripMeta } from './schema';

/**
 * Sharing the trip with a travel companion — pasted in a chat, or synced through
 * the relay (sync/sync.ts):
 * - what travels is everything filled in about the trip: stays (with passport stamps), bookings
 *   marked "both of us", days and notes, checklist and packing ticks, the money (expenses,
 *   budgets, the two names, your own exchange rates) and the address card;
 *   never the vault (documents, personal details, insurance), the emergency card, the profile,
 *   settings, documents linked to a booking, private booking notes or "just me" bookings
 * - it's encrypted with a trip code both phones know (typed in, never sent with the data)
 * - receiving merges: newer edits win, deletions carry over
 */

export const SHARE_FORMAT = 'travel-companion-share/1';
const MAGIC = utf8Encode('TCSHARE1');

// No 0/O, 1/I/L: easy to read out loud and type.
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

/** A random trip code like "7K4Q-M2PX-9RTB" (~59 bits). */
export function newTripCode(): string {
  const chars: string[] = [];
  while (chars.length < 12) {
    for (const b of randomBytes(16)) {
      // Rejection sampling keeps every character equally likely.
      if (b < 248 && chars.length < 12) chars.push(ALPHABET[b % ALPHABET.length]!);
    }
  }
  return [chars.slice(0, 4), chars.slice(4, 8), chars.slice(8)].map((c) => c.join('')).join('-');
}

export function normaliseCode(code: string): string {
  return code.toUpperCase().replace(/[^0-9A-Z]/g, '');
}

export function isValidCode(code: string): boolean {
  const n = normaliseCode(code);
  return n.length === 12 && [...n].every((c) => ALPHABET.includes(c));
}

// --- What is shared ---------------------------------------------------------

/** Deletions, keyed "stay:<id>", "booking:<id>", "day:<date>", "expense:<id>" or "prep:<id>", with the time of deletion. */
export type Tombstones = Record<string, string>;

/** A checklist or packing tick (same shape as the prepState table). */
export const PrepTick = z.object({
  id: z.string(),
  status: z.enum(['done', 'snoozed', 'not-needed']),
  snoozedUntil: z.string().optional(),
  updatedAt: z.string(),
});
export type PrepTick = z.infer<typeof PrepTick>;

export const Extra = z.object({ value: z.unknown(), updatedAt: z.string() });
export type Extra = z.infer<typeof Extra>;

export const SharePayload = z.object({
  meta: TripMeta,
  stays: z.array(Stay),
  bookings: z.array(Booking),
  days: z.array(Day),
  deleted: z.record(z.string(), z.string()).default({}),
  // Missing in shares from older versions of the app.
  expenses: z.array(Expense).default([]),
  budgets: SharedBudgets.optional(),
  travellers: Travellers.optional(),
  /** Checklist and packing ticks. */
  prep: z.array(PrepTick).default([]),
  /** Small shared settings (own exchange rates, the address card), each with when it was last changed. */
  extras: z.record(z.string(), Extra).default({}),
});
export type SharePayload = z.infer<typeof SharePayload>;

/** What this phone has besides the itinerary, as it goes into a share and comes out of a merge. */
export interface PhoneData {
  expenses: Expense[];
  budgets?: SharedBudgets | undefined;
  travellers?: Travellers | undefined;
  prep?: PrepTick[];
  extras?: Record<string, Extra>;
}

function sharedBooking(b: Booking): Booking {
  const { myNote: _note, documentIds: _docs, ...rest } = b;
  return { ...rest, documentIds: [] };
}

export function sharePayload(data: TripData, deleted: Tombstones, phone: PhoneData = { expenses: [] }): SharePayload {
  const { importedAt: _i, ...meta } = data.meta;
  return {
    meta: TripMeta.parse(meta),
    stays: data.stays,
    bookings: data.bookings.filter((b) => b.who !== 'me').map(sharedBooking),
    days: data.days,
    deleted,
    expenses: phone.expenses,
    ...(phone.budgets ? { budgets: phone.budgets } : {}),
    ...(phone.travellers && (phone.travellers.a || phone.travellers.b) ? { travellers: phone.travellers } : {}),
    prep: phone.prep ?? [],
    extras: phone.extras ?? {},
  };
}

// --- Merge ------------------------------------------------------------------

export interface MergeStats {
  added: number;
  updated: number;
  removed: number;
}

const newer = (a: string | undefined, b: string | undefined) => (a ?? '') > (b ?? '');

/**
 * Merges a companion's shared trip into this phone's. For each item the most
 * recent edit wins; personal fields (passport stamp, linked documents, private
 * notes) are always kept from this phone; "just me" bookings are never touched.
 */
export function mergeTrip(
  local: TripData | null,
  localDeleted: Tombstones,
  incoming: SharePayload,
  localPhone: PhoneData = { expenses: [] },
): { data: TripData; deleted: Tombstones; stats: MergeStats; phone: PhoneData } {
  const stats: MergeStats = { added: 0, updated: 0, removed: 0 };
  const deleted: Tombstones = { ...localDeleted };
  for (const [k, at] of Object.entries(incoming.deleted)) if (newer(at, deleted[k])) deleted[k] = at;

  function merge<T extends { updatedAt?: string | undefined }>(
    kind: string,
    mine: T[],
    theirs: T[],
    key: (t: T) => string,
    keepMine: (mine: T, theirs: T) => T,
    protectedItem: (t: T) => boolean = () => false,
  ): T[] {
    const out = new Map(mine.map((t) => [key(t), t]));
    for (const t of theirs) {
      const k = key(t);
      const gone = deleted[`${kind}:${k}`];
      if (gone && !newer(t.updatedAt, gone)) continue;
      const m = out.get(k);
      if (!m) {
        out.set(k, t);
        stats.added++;
      } else if (!protectedItem(m) && newer(t.updatedAt, m.updatedAt)) {
        out.set(k, keepMine(m, t));
        stats.updated++;
      }
    }
    for (const [k, m] of out) {
      const gone = deleted[`${kind}:${k}`];
      if (gone && !protectedItem(m) && newer(gone, m.updatedAt)) {
        out.delete(k);
        stats.removed++;
      }
    }
    return [...out.values()];
  }

  const stays = merge(
    'stay',
    local?.stays ?? [],
    incoming.stays,
    (s) => s.id,
    (_m, t) => t,
  ).sort((a, b) => a.from.localeCompare(b.from));

  const bookings = merge(
    'booking',
    local?.bookings ?? [],
    incoming.bookings,
    (b) => b.id,
    (m, t) => ({ ...t, documentIds: m.documentIds, ...(m.myNote ? { myNote: m.myNote } : {}) }),
    (b) => b.who === 'me',
  );

  const days = merge('day', local?.days ?? [], incoming.days, (d) => d.date, (_m, t) => t).sort((a, b) =>
    a.date.localeCompare(b.date),
  );

  const meta =
    local && !newer(incoming.meta.updatedAt, local.meta.updatedAt)
      ? local.meta
      : { ...incoming.meta, ...(local?.meta.importedAt ? { importedAt: local.meta.importedAt } : {}) };

  // Money. "a" and "b" are slots for the two names; if the other phone entered them the other way
  // round, its expenses are turned around so each one stays with the right person.
  const mine = localPhone.travellers;
  const theirs = incoming.travellers;
  const swapped = !!(mine?.a && mine.b && mine.a !== mine.b && theirs && mine.a === theirs.b && mine.b === theirs.a);
  const flip = (w: ForWhom | undefined): ForWhom | undefined => (w === 'a' ? 'b' : w === 'b' ? 'a' : w);
  const theirExpenses = swapped ? incoming.expenses.map((e) => ({ ...e, ...(e.forWhom ? { forWhom: flip(e.forWhom) } : {}) })) : incoming.expenses;
  const expenses = merge('expense', localPhone.expenses, theirExpenses, (e) => e.id, (_m, t) => t).sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  const budgets = incoming.budgets && newer(incoming.budgets.updatedAt, localPhone.budgets?.updatedAt) ? incoming.budgets : localPhone.budgets;
  const named = (t: Travellers | undefined) => !!(t && (t.a || t.b));
  const travellers =
    !swapped && named(theirs) && (!named(mine) || newer(theirs!.updatedAt, mine!.updatedAt)) ? theirs : mine;

  const prep = merge('prep', localPhone.prep ?? [], incoming.prep, (p) => p.id, (_m, t) => t);
  const extras = { ...(localPhone.extras ?? {}) };
  for (const [k, v] of Object.entries(incoming.extras)) if (newer(v.updatedAt, extras[k]?.updatedAt)) extras[k] = v;

  return { data: { meta, stays, bookings, days }, deleted, stats, phone: { expenses, budgets, travellers, prep, extras } };
}

// --- File format ------------------------------------------------------------

const ShareHeader = z.object({
  format: z.literal(SHARE_FORMAT),
  createdAt: z.string(),
  salt: z.string(),
  iv: z.string(),
  iterations: z.number().int().positive(),
  compression: z.literal('gzip').optional(),
});

async function gzip(bytes: Uint8Array<ArrayBuffer>, mode: 'compress' | 'decompress'): Promise<Bytes> {
  const stream = new Blob([bytes]).stream().pipeThrough(mode === 'compress' ? new CompressionStream('gzip') : new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export class WrongTripCodeError extends Error {
  constructor() {
    super('That trip code does not open this file.');
    this.name = 'WrongTripCodeError';
  }
}

export class InvalidShareError extends Error {
  constructor() {
    super('This is not a shared trip file.');
    this.name = 'InvalidShareError';
  }
}

async function codeKey(code: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', utf8Encode(normaliseCode(code)), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

function u32(n: number): Bytes {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, n);
  return out;
}

/** MAGIC | u32 header length | header JSON | AES-GCM(payload JSON), header as additional data. */
export async function encryptShare(payload: SharePayload, code: string, iterations = PBKDF2_ITERATIONS, now = new Date()): Promise<Blob> {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const header = utf8Encode(
    JSON.stringify({ format: SHARE_FORMAT, createdAt: now.toISOString(), salt: toBase64(salt), iv: toBase64(iv), iterations, compression: 'gzip' }),
  );
  const key = await codeKey(code, salt, iterations);
  // Compressed before encryption (ciphertext doesn't compress): a whole trip fits in one chat message.
  const plain = await gzip(utf8Encode(JSON.stringify(payload)), 'compress');
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: header }, key, plain);
  return new Blob([concatBytes(MAGIC, u32(header.length), header, new Uint8Array(ct))], { type: 'application/octet-stream' });
}

export async function decryptShare(file: Uint8Array, code: string): Promise<{ payload: SharePayload; createdAt: string }> {
  const bytes = toBytes(file);
  if (bytes.length < MAGIC.length + 4 || !MAGIC.every((b, i) => bytes[i] === b)) throw new InvalidShareError();
  const len = new DataView(bytes.buffer).getUint32(MAGIC.length);
  const start = MAGIC.length + 4;
  const headerBytes = bytes.slice(start, start + len);
  let header: z.infer<typeof ShareHeader>;
  try {
    header = ShareHeader.parse(JSON.parse(utf8Decode(headerBytes)));
  } catch {
    throw new InvalidShareError();
  }
  const key = await codeKey(code, fromBase64(header.salt), header.iterations);
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(header.iv), additionalData: headerBytes },
      key,
      bytes.slice(start + len),
    );
  } catch {
    throw new WrongTripCodeError();
  }
  const json = header.compression === 'gzip' ? await gzip(new Uint8Array(plain), 'decompress') : new Uint8Array(plain);
  return { payload: SharePayload.parse(JSON.parse(utf8Decode(json))), createdAt: header.createdAt };
}

// --- As a chat message ------------------------------------------------------
// Chat apps mangle unknown file types (WhatsApp turns them into ".bin"), so the
// encrypted trip also travels as plain text: a message you copy and paste.

const TOKEN = 'TC1.';
// The block ends with a dot (not in the base64url alphabet), so text a chat app adds after it can't join in.
const TOKEN_RE = /TC1\.([A-Za-z0-9_-]+)\./;

function base64url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(text: string): Bytes {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  return fromBase64(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
}

/** The encrypted share as one line of text ("TC1.…."), as it's pasted in a chat and kept by the sync relay. */
export function shareToken(encrypted: Uint8Array): string {
  return TOKEN + base64url(encrypted) + '.';
}

export function shareText(encrypted: Uint8Array): string {
  return [
    'Travel Companion — our trip (encrypted).',
    'Open the app → More → Travelling together → paste this whole message.',
    '',
    shareToken(encrypted),
  ].join('\n');
}

/** The encrypted share from a pasted message, a text file or a binary share file. */
export function shareBytesFrom(input: string | Uint8Array): Bytes {
  if (typeof input !== 'string') {
    const bytes = toBytes(input);
    if (MAGIC.every((b, i) => bytes[i] === b)) return bytes;
    input = utf8Decode(bytes);
  }
  const m = TOKEN_RE.exec(input.replace(/\s+/g, ''));
  if (!m) throw new InvalidShareError();
  return fromBase64url(m[1]!);
}

/** A .txt file with the same message, which chat apps and the iPhone Files app can open. */
export function shareFileName(now = new Date()): string {
  return `trip-share-${now.toISOString().slice(0, 10)}.txt`;
}
