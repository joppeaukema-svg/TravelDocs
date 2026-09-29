import { describe, expect, it } from 'vitest';
import { DecryptionError, seal, unseal } from '../../src/crypto/aead';
import { utf8Decode, utf8Encode } from '../../src/crypto/bytes';
import {
  createKeyMaterial,
  PBKDF2_ITERATIONS,
  rewrapKeyMaterial,
  unlockKeyMaterial,
  WrongPassphraseError,
} from '../../src/crypto/keys';

const FAST = 1_000; // tests use few iterations; production uses PBKDF2_ITERATIONS

describe('vault keys', () => {
  it('uses at least 600,000 PBKDF2 iterations by default', () => {
    expect(PBKDF2_ITERATIONS).toBeGreaterThanOrEqual(600_000);
  });

  it('unlocks with the right passphrase and rejects a wrong one', async () => {
    const { material, key } = await createKeyMaterial('correct horse battery', FAST);
    const sealed = await seal(key, utf8Encode('secret'), 'ctx');

    const again = await unlockKeyMaterial(material, 'correct horse battery');
    expect(utf8Decode(await unseal(again, sealed, 'ctx'))).toBe('secret');
    await expect(unlockKeyMaterial(material, 'correct horse batterY')).rejects.toBeInstanceOf(WrongPassphraseError);
  });

  it('gives a non-extractable key', async () => {
    const { key } = await createKeyMaterial('correct horse battery', FAST);
    expect(key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('raw', key)).rejects.toThrow();
  });

  it('re-wraps the same data key under a new passphrase', async () => {
    const { material, key } = await createKeyMaterial('old passphrase!', FAST);
    const sealed = await seal(key, utf8Encode('kept'), 'ctx');
    const next = await rewrapKeyMaterial(material, 'old passphrase!', 'new passphrase!', FAST);

    const newKey = await unlockKeyMaterial(next, 'new passphrase!');
    expect(utf8Decode(await unseal(newKey, sealed, 'ctx'))).toBe('kept');
    await expect(unlockKeyMaterial(next, 'old passphrase!')).rejects.toBeInstanceOf(WrongPassphraseError);
    await expect(rewrapKeyMaterial(material, 'wrong', 'x'.repeat(12), FAST)).rejects.toBeInstanceOf(
      WrongPassphraseError,
    );
  });
});

describe('seal / unseal', () => {
  it('binds ciphertext to its context', async () => {
    const { key } = await createKeyMaterial('correct horse battery', FAST);
    const sealed = await seal(key, utf8Encode('passport'), 'vault:doc:1');
    await expect(unseal(key, sealed, 'vault:doc:2')).rejects.toBeInstanceOf(DecryptionError);
  });

  it('detects tampering', async () => {
    const { key } = await createKeyMaterial('correct horse battery', FAST);
    const sealed = await seal(key, utf8Encode('passport'), 'ctx');
    sealed.ct[0] = (sealed.ct[0] ?? 0) ^ 1;
    await expect(unseal(key, sealed, 'ctx')).rejects.toBeInstanceOf(DecryptionError);
  });

  it('uses a fresh IV every time', async () => {
    const { key } = await createKeyMaterial('correct horse battery', FAST);
    const a = await seal(key, utf8Encode('same'), 'ctx');
    const b = await seal(key, utf8Encode('same'), 'ctx');
    expect(a.iv).not.toEqual(b.iv);
    expect(a.ct).not.toEqual(b.ct);
  });
});
