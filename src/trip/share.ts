import { z } from 'zod';
import { concatBytes, fromBase64, randomBytes, toBase64, toBytes, utf8Decode, utf8Encode, type Bytes } from '../crypto/bytes';
import { PBKDF2_ITERATIONS } from '../crypto/keys';
import type { TripData } from './io';
import { Booking, Day, Stay, TripMeta } from './schema';

/**
 * Sharing the trip with a travel companion, without a server:
 * - only the shared part travels: stays, bookings marked "both of us", days, trip dates;
 *   never the vault, profile, checklist ticks, passport stamps, linked documents or private notes
 * - the file is encrypted with a trip code both phones know (typed in, never sent with the file)
 * - importing merges: newer edits win, deletions carry over, personal fields stay put
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

/** Deletions, keyed "stay:<id>", "booking:<id>" or "day:<date>", with the time of deletion. */
export type Tombstones = Record<string, string>;

export const SharePayload = z.object({
  meta: TripMeta,
  stays: z.array(Stay),
  bookings: z.array(Booking),
  days: z.array(Day),
  deleted: z.record(z.string(), z.string()).default({}),
});
export type SharePayload = z.infer<typeof SharePayload>;

function sharedStay(s: Stay): Stay {
  const { stampedUntil: _personal, ...rest } = s;
  return rest;
}

function sharedBooking(b: Booking): Booking {
  const { myNote: _note, documentIds: _docs, ...rest } = b;
  return { ...rest, documentIds: [] };
}

export function sharePayload(data: TripData, deleted: Tombstones): SharePayload {
  const { importedAt: _i, ...meta } = data.meta;
  return {
    meta: TripMeta.parse(meta),
    stays: data.stays.map(sharedStay),
    bookings: data.bookings.filter((b) => b.who !== 'me').map(sharedBooking),
    days: data.days,
    deleted,
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
): { data: TripData; deleted: Tombstones; stats: MergeStats } {
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
    (m, t) => ({ ...t, ...(m.stampedUntil ? { stampedUntil: m.stampedUntil } : {}) }),
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

  return { data: { meta, stays, bookings, days }, deleted, stats };
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

export function shareText(encrypted: Uint8Array): string {
  return [
    'Travel Companion — our trip (encrypted).',
    'Open the app → Trip → Receive a shared trip → paste this whole message.',
    '',
    TOKEN + base64url(encrypted) + '.',
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
