import { z } from 'zod';
import { fromBase64, randomBytes, toBase64, utf8Encode } from './bytes';

/** OWASP 2023 recommendation for PBKDF2-HMAC-SHA256. */
export const PBKDF2_ITERATIONS = 600_000;
export const MIN_PASSPHRASE_LENGTH = 10;

const WRAP_CONTEXT = utf8Encode('travel-companion/vault-key/v1');

export const KeyMaterial = z.object({
  v: z.literal(1),
  kdf: z.literal('PBKDF2-SHA256'),
  iterations: z.number().int().positive(),
  salt: z.string().min(1),
  wrapIv: z.string().min(1),
  wrappedKey: z.string().min(1),
});
export type KeyMaterial = z.infer<typeof KeyMaterial>;

export class WrongPassphraseError extends Error {
  constructor() {
    super('Wrong passphrase.');
    this.name = 'WrongPassphraseError';
  }
}

async function deriveWrappingKey(passphrase: string, salt: Uint8Array<ArrayBuffer>, iterations: number) {
  const base = await crypto.subtle.importKey('raw', utf8Encode(passphrase.normalize('NFC')), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['wrapKey', 'unwrapKey'],
  );
}

async function wrap(dataKey: CryptoKey, passphrase: string, iterations: number): Promise<KeyMaterial> {
  const salt = randomBytes(16);
  const wrapIv = randomBytes(12);
  const kek = await deriveWrappingKey(passphrase, salt, iterations);
  const wrapped = await crypto.subtle.wrapKey('raw', dataKey, kek, {
    name: 'AES-GCM',
    iv: wrapIv,
    additionalData: WRAP_CONTEXT,
  });
  return {
    v: 1,
    kdf: 'PBKDF2-SHA256',
    iterations,
    salt: toBase64(salt),
    wrapIv: toBase64(wrapIv),
    wrappedKey: toBase64(new Uint8Array(wrapped)),
  };
}

/**
 * Unwraps the data key. Returns a non-extractable key unless `extractable` is
 * set (only needed to re-wrap it under a new passphrase).
 */
export async function unlockKeyMaterial(
  material: KeyMaterial,
  passphrase: string,
  extractable = false,
): Promise<CryptoKey> {
  const kek = await deriveWrappingKey(passphrase, fromBase64(material.salt), material.iterations);
  try {
    return await crypto.subtle.unwrapKey(
      'raw',
      fromBase64(material.wrappedKey),
      kek,
      { name: 'AES-GCM', iv: fromBase64(material.wrapIv), additionalData: WRAP_CONTEXT },
      { name: 'AES-GCM', length: 256 },
      extractable,
      ['encrypt', 'decrypt'],
    );
  } catch {
    throw new WrongPassphraseError();
  }
}

/**
 * Creates a random AES-256-GCM data key and wraps it with a key derived from the
 * passphrase. The data key never leaves memory unwrapped.
 */
export async function createKeyMaterial(
  passphrase: string,
  iterations = PBKDF2_ITERATIONS,
): Promise<{ material: KeyMaterial; key: CryptoKey }> {
  const dataKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const material = await wrap(dataKey, passphrase, iterations);
  // Hand back a non-extractable copy; the extractable one goes out of scope.
  const key = await unlockKeyMaterial(material, passphrase);
  return { material, key };
}

/** Re-wraps the same data key under a new passphrase; stored data stays as is. */
export async function rewrapKeyMaterial(
  material: KeyMaterial,
  oldPassphrase: string,
  newPassphrase: string,
  iterations = Math.max(material.iterations, PBKDF2_ITERATIONS),
): Promise<KeyMaterial> {
  const dataKey = await unlockKeyMaterial(material, oldPassphrase, true);
  return wrap(dataKey, newPassphrase, iterations);
}
