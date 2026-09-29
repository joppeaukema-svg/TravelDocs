import type { z } from 'zod';
import { seal, unseal } from '../crypto/aead';
import { toBytes, utf8Decode, utf8Encode, type Bytes } from '../crypto/bytes';
import {
  createKeyMaterial,
  KeyMaterial,
  MIN_PASSPHRASE_LENGTH,
  PBKDF2_ITERATIONS,
  rewrapKeyMaterial,
  unlockKeyMaterial,
} from '../crypto/keys';
import { db, getMeta, META, setMeta, type BlobRow, type VaultRow } from '../db/db';
import { vaultSession } from './session';

export async function getKeyMaterial(): Promise<KeyMaterial | undefined> {
  const raw = await getMeta(META.vaultKeys);
  return raw === undefined ? undefined : KeyMaterial.parse(raw);
}

export async function isVaultSetUp(): Promise<boolean> {
  return (await getKeyMaterial()) !== undefined;
}

export function passphraseProblem(passphrase: string): string | null {
  if (passphrase.trim().length < MIN_PASSPHRASE_LENGTH) {
    return `Use at least ${MIN_PASSPHRASE_LENGTH} characters — four random words work well.`;
  }
  return null;
}

export async function setUpVault(passphrase: string, iterations = PBKDF2_ITERATIONS): Promise<void> {
  if (await isVaultSetUp()) throw new Error('The vault already exists.');
  const problem = passphraseProblem(passphrase);
  if (problem) throw new Error(problem);
  const { material, key } = await createKeyMaterial(passphrase, iterations);
  await setMeta(META.vaultKeys, material);
  vaultSession.open(key);
}

/** Throws WrongPassphraseError when the passphrase doesn't match. */
export async function unlockVault(passphrase: string): Promise<void> {
  const material = await getKeyMaterial();
  if (!material) throw new Error('There is no vault on this phone yet.');
  vaultSession.open(await unlockKeyMaterial(material, passphrase));
}

export function lockVault(): void {
  vaultSession.lock();
}

export async function changePassphrase(oldPassphrase: string, newPassphrase: string, iterations?: number) {
  const problem = passphraseProblem(newPassphrase);
  if (problem) throw new Error(problem);
  const material = await getKeyMaterial();
  if (!material) throw new Error('There is no vault on this phone yet.');
  await setMeta(META.vaultKeys, await rewrapKeyMaterial(material, oldPassphrase, newPassphrase, iterations));
}

// --- Encrypted JSON records -------------------------------------------------
// seal* functions do the (async) crypto up front so callers can write several
// rows in one IndexedDB transaction without awaiting Web Crypto inside it.

export async function sealSecret(id: string, value: unknown): Promise<VaultRow> {
  const sealed = await seal(vaultSession.requireKey(), utf8Encode(JSON.stringify(value)), `vault:${id}`);
  return { id, ...sealed };
}

export async function putSecret(id: string, value: unknown): Promise<void> {
  await db.vault.put(await sealSecret(id, value));
}

export async function getSecret<S extends z.ZodType>(id: string, schema: S): Promise<z.infer<S> | undefined> {
  const row = await db.vault.get(id);
  if (!row) return undefined;
  const plaintext = await unseal(vaultSession.requireKey(), row, `vault:${id}`);
  return schema.parse(JSON.parse(utf8Decode(plaintext)));
}

export async function deleteSecret(id: string): Promise<void> {
  await db.vault.delete(id);
}

// --- Encrypted files --------------------------------------------------------

export interface VaultFile {
  name: string;
  type: string;
  bytes: Bytes;
}

export interface FileMeta {
  name: string;
  type: string;
}

export async function sealFile(owner: string, file: VaultFile): Promise<BlobRow> {
  const key = vaultSession.requireKey();
  const id = crypto.randomUUID();
  const meta: FileMeta = { name: file.name, type: file.type };
  const body = await seal(key, toBytes(file.bytes), `blob:${id}`);
  const head = await seal(key, utf8Encode(JSON.stringify(meta)), `blobmeta:${id}`);
  return { id, owner, size: file.bytes.length, iv: body.iv, ct: body.ct, metaIv: head.iv, metaCt: head.ct };
}

export async function getFileMeta(id: string): Promise<FileMeta | undefined> {
  const row = await db.blobs.get(id);
  if (!row) return undefined;
  const head = await unseal(vaultSession.requireKey(), { iv: row.metaIv, ct: row.metaCt }, `blobmeta:${id}`);
  return JSON.parse(utf8Decode(head)) as FileMeta;
}

export async function getFile(id: string): Promise<VaultFile | undefined> {
  const row = await db.blobs.get(id);
  if (!row) return undefined;
  const key = vaultSession.requireKey();
  const head = await unseal(key, { iv: row.metaIv, ct: row.metaCt }, `blobmeta:${id}`);
  const bytes = await unseal(key, row, `blob:${id}`);
  return { ...(JSON.parse(utf8Decode(head)) as FileMeta), bytes };
}

export async function deleteFile(id: string): Promise<void> {
  await db.blobs.delete(id);
}
