import { z } from 'zod';
import { DecryptionError } from '../crypto/aead';
import { concatBytes, fromBase64, randomBytes, toBase64, toBytes, utf8Decode, utf8Encode, type Bytes } from '../crypto/bytes';
import { KeyMaterial, unlockKeyMaterial } from '../crypto/keys';
import { db, META, setMeta } from '../db/db';
import { vaultSession } from '../vault/session';
import { getKeyMaterial } from '../vault/vault';

/**
 * Backup file layout:
 *   MAGIC | u32 header length | header JSON | AES-GCM ciphertext
 * The header holds the wrapped vault key (same as on the phone), so the file
 * opens with the passphrase that was in use when it was made. The header bytes
 * are the ciphertext's additional data, so neither can be swapped or edited.
 *
 * Plaintext payload:
 *   u32 manifest length | manifest JSON | binary section
 * Binary values in table rows are replaced by {"$bin":[offset,length]}.
 */
const MAGIC = utf8Encode('TCBACKUP');
export const BACKUP_FORMAT = 'travel-companion-backup/1';
export const BACKUP_EXTENSION = '.tcbackup';

export const BackupHeader = z.object({
  format: z.literal(BACKUP_FORMAT),
  createdAt: z.string(),
  dbVersion: z.number(),
  keys: KeyMaterial,
  iv: z.string(),
});
export type BackupHeader = z.infer<typeof BackupHeader>;

export class InvalidBackupError extends Error {
  constructor(message = 'This is not a Travel Companion backup file.') {
    super(message);
    this.name = 'InvalidBackupError';
  }
}

function u32(n: number): Bytes {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, n);
  return out;
}

function readU32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset);
}

type BinRef = { $bin: [number, number] };

function isBinRef(v: unknown): v is BinRef {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const bin = (v as Record<string, unknown>).$bin;
  return Object.keys(v).length === 1 && Array.isArray(bin) && bin.length === 2 && bin.every(Number.isInteger);
}

function serialise(tables: Record<string, unknown[]>): Bytes {
  const bins: Uint8Array[] = [];
  let offset = 0;
  const encode = (v: unknown): unknown => {
    if (v instanceof ArrayBuffer || ArrayBuffer.isView(v)) {
      const bytes = toBytes(v);
      bins.push(bytes);
      const ref: BinRef = { $bin: [offset, bytes.length] };
      offset += bytes.length;
      return ref;
    }
    if (Array.isArray(v)) return v.map(encode);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encode(x)]));
    return v;
  };
  const manifest = utf8Encode(JSON.stringify({ tables: encode(tables) }));
  return concatBytes(u32(manifest.length), manifest, ...bins);
}

function deserialise(payload: Bytes): Record<string, unknown[]> {
  const manifestLength = readU32(payload, 0);
  const binStart = 4 + manifestLength;
  const manifest = JSON.parse(utf8Decode(payload.subarray(4, binStart))) as { tables: Record<string, unknown[]> };
  const decode = (v: unknown): unknown => {
    if (isBinRef(v)) {
      const [off, len] = v.$bin;
      return payload.slice(binStart + off, binStart + off + len);
    }
    if (Array.isArray(v)) return v.map(decode);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, decode(x)]));
    return v;
  };
  return decode(manifest.tables) as Record<string, unknown[]>;
}

/** Everything on this phone, encrypted with the vault key. Needs the vault unlocked. */
export async function createBackup(now = new Date()): Promise<Blob> {
  const key = vaultSession.requireKey();
  const keys = await getKeyMaterial();
  if (!keys) throw new Error('Set up the vault before making a backup.');

  const tables: Record<string, unknown[]> = {};
  await db.transaction('r', db.tables, async () => {
    for (const table of db.tables) tables[table.name] = await table.toArray();
  });

  const iv = randomBytes(12);
  const header: BackupHeader = {
    format: BACKUP_FORMAT,
    createdAt: now.toISOString(),
    dbVersion: db.verno,
    keys,
    iv: toBase64(iv),
  };
  const headerBytes = utf8Encode(JSON.stringify(header));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: headerBytes }, key, serialise(tables));
  return new Blob([MAGIC, u32(headerBytes.length), headerBytes, new Uint8Array(ct)], {
    type: 'application/octet-stream',
  });
}

export function backupFileName(now = new Date()): string {
  return `travel-companion-${now.toISOString().slice(0, 10)}${BACKUP_EXTENSION}`;
}

interface ParsedBackup {
  header: BackupHeader;
  headerBytes: Bytes;
  ciphertext: Bytes;
}

export function parseBackup(file: Uint8Array): ParsedBackup {
  const bytes = toBytes(file);
  if (bytes.length < MAGIC.length + 4 || !MAGIC.every((b, i) => bytes[i] === b)) throw new InvalidBackupError();
  const headerLength = readU32(bytes, MAGIC.length);
  const headerStart = MAGIC.length + 4;
  const headerBytes = bytes.slice(headerStart, headerStart + headerLength);
  let header: BackupHeader;
  try {
    header = BackupHeader.parse(JSON.parse(utf8Decode(headerBytes)));
  } catch {
    throw new InvalidBackupError();
  }
  return { header, headerBytes, ciphertext: bytes.slice(headerStart + headerLength) };
}

/**
 * Replaces everything on this phone with the backup's contents and unlocks the
 * vault. Throws WrongPassphraseError, DecryptionError (damaged file) or
 * InvalidBackupError; nothing is changed in those cases.
 */
export async function restoreBackup(file: Uint8Array, passphrase: string): Promise<BackupHeader> {
  const { header, headerBytes, ciphertext } = parseBackup(file);
  if (header.dbVersion > db.verno) {
    throw new InvalidBackupError('This backup was made by a newer version of the app. Update the app first.');
  }
  const key = await unlockKeyMaterial(header.keys, passphrase);
  let payload: Bytes;
  try {
    payload = new Uint8Array(
      await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(header.iv), additionalData: headerBytes }, key, ciphertext),
    );
  } catch {
    throw new DecryptionError();
  }
  const tables = deserialise(payload);

  vaultSession.lock();
  await db.transaction('rw', db.tables, async () => {
    for (const table of db.tables) {
      await table.clear();
      const rows = tables[table.name];
      if (rows?.length) await table.bulkPut(rows);
    }
  });
  await setMeta(META.lastBackupAt, header.createdAt);
  vaultSession.open(key);
  return header;
}

export async function markBackedUp(at: Date): Promise<void> {
  await setMeta(META.lastBackupAt, at.toISOString());
}

export const BACKUP_REMINDER_DAYS = 7;

export function backupIsDue(lastBackupAt: string | undefined, now = new Date()): boolean {
  if (!lastBackupAt) return true;
  return now.getTime() - new Date(lastBackupAt).getTime() > BACKUP_REMINDER_DAYS * 86_400_000;
}
