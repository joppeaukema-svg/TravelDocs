import { db, eraseAllData } from '../../src/db/db';
import { vaultSession } from '../../src/vault/session';
import { setUpVault } from '../../src/vault/vault';

export const PASSPHRASE = 'orange lantern river piano';
export const FAST_ITERATIONS = 1_000;

export async function freshVault(): Promise<void> {
  vaultSession.lock();
  await eraseAllData();
  await setUpVault(PASSPHRASE, FAST_ITERATIONS);
}

/** Every row of every table, for before/after comparisons. */
export async function dumpDatabase(): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {};
  for (const table of db.tables) out[table.name] = await table.toArray();
  return out;
}

export function pseudoRandomBytes(length: number, seed = 1): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(length);
  let x = seed;
  for (let i = 0; i < length; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    out[i] = x & 0xff;
  }
  return out;
}

/** True if `needle` occurs anywhere in `haystack`. */
export function containsBytes(haystack: Uint8Array, needle: Uint8Array): boolean {
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}
