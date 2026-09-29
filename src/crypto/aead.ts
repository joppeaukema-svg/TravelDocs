import { randomBytes, utf8Encode, type Bytes } from './bytes';

export const IV_BYTES = 12;

export class DecryptionError extends Error {
  constructor() {
    super('Data could not be decrypted: wrong key or damaged data.');
    this.name = 'DecryptionError';
  }
}

export interface Sealed {
  iv: Bytes;
  ct: Bytes;
}

/**
 * AES-GCM with a fresh random IV per message. `context` is bound as additional
 * authenticated data, so a ciphertext only decrypts in the slot it was written for.
 */
export async function seal(key: CryptoKey, plaintext: Bytes, context: string): Promise<Sealed> {
  const iv = randomBytes(IV_BYTES);
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: utf8Encode(context) },
    key,
    plaintext,
  );
  return { iv, ct: new Uint8Array(ct) };
}

export async function unseal(key: CryptoKey, sealed: Sealed, context: string): Promise<Bytes> {
  try {
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: sealed.iv, additionalData: utf8Encode(context) },
      key,
      sealed.ct,
    );
    return new Uint8Array(pt);
  } catch {
    throw new DecryptionError();
  }
}
