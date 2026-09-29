import { beforeEach, describe, expect, it } from 'vitest';
import { concatBytes, utf8Encode } from '../../src/crypto/bytes';
import { WrongPassphraseError } from '../../src/crypto/keys';
import { db } from '../../src/db/db';
import { addDocumentFiles, createDocument, deleteDocument, readDocument } from '../../src/docs/docs';
import { readPersonal, savePersonal, Personal } from '../../src/profile/personal';
import { VaultLockedError, vaultSession } from '../../src/vault/session';
import { changePassphrase, getFile, lockVault, passphraseProblem, setUpVault, unlockVault } from '../../src/vault/vault';
import { containsBytes, dumpDatabase, FAST_ITERATIONS, freshVault, PASSPHRASE, pseudoRandomBytes } from './helpers';

beforeEach(freshVault);

describe('vault', () => {
  it('refuses short passphrases and a second setup', async () => {
    expect(passphraseProblem('short')).not.toBeNull();
    expect(passphraseProblem('four random words here')).toBeNull();
    await expect(setUpVault(PASSPHRASE, FAST_ITERATIONS)).rejects.toThrow(/already exists/);
  });

  it('locks and unlocks', async () => {
    await savePersonal(Personal.parse({ fullName: 'Demo Traveller' }));
    lockVault();
    await expect(readPersonal()).rejects.toBeInstanceOf(VaultLockedError);
    await expect(unlockVault('wrong passphrase')).rejects.toBeInstanceOf(WrongPassphraseError);
    expect(vaultSession.isUnlocked()).toBe(false);
    await unlockVault(PASSPHRASE);
    expect((await readPersonal()).fullName).toBe('Demo Traveller');
  });

  it('stores nothing readable without the passphrase', async () => {
    const marker = 'NLX-PASSPORT-9Z8Y7X';
    const scan = pseudoRandomBytes(64 * 1024, 7);
    await savePersonal(Personal.parse({ fullName: marker, allergies: marker }));
    const id = await createDocument({
      type: 'passport',
      expiresAt: '2031-05-01',
      secret: { title: marker, number: marker, issuer: '', issuedAt: '', notes: marker },
    });
    await addDocumentFiles(id, [{ name: `${marker}.jpg`, type: 'image/jpeg', bytes: scan }]);
    lockVault();

    // Everything IndexedDB holds, as raw bytes: JSON for structure plus every binary field.
    const rows = await dumpDatabase();
    const binaries: Uint8Array[] = [];
    const json = JSON.stringify(rows, (_k, v) => {
      if (ArrayBuffer.isView(v)) {
        binaries.push(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
        return '[bytes]';
      }
      return v;
    });
    const everything = concatBytes(utf8Encode(json), ...binaries);

    expect(containsBytes(everything, utf8Encode(marker))).toBe(false);
    expect(containsBytes(everything, scan.subarray(1000, 1064))).toBe(false);
    // Only the plaintext index needed while locked is visible.
    expect(json).toContain('2031-05-01');
  });

  it('keeps data readable after changing the passphrase', async () => {
    await savePersonal(Personal.parse({ fullName: 'Kept' }));
    await changePassphrase(PASSPHRASE, 'a brand new passphrase', FAST_ITERATIONS);
    lockVault();
    await expect(unlockVault(PASSPHRASE)).rejects.toBeInstanceOf(WrongPassphraseError);
    await unlockVault('a brand new passphrase');
    expect((await readPersonal()).fullName).toBe('Kept');
  });
});

describe('documents', () => {
  it('round-trips metadata and files, and deletes everything', async () => {
    const bytes = pseudoRandomBytes(10_000, 3);
    const id = await createDocument({
      type: 'evisa',
      expiresAt: '2027-01-01',
      secret: { title: 'Laos e-visa', number: 'A123', issuer: '', issuedAt: '', notes: '' },
    });
    await addDocumentFiles(id, [{ name: 'approval.pdf', type: 'application/pdf', bytes }]);

    const doc = await readDocument(id);
    expect(doc?.secret.title).toBe('Laos e-visa');
    expect(doc?.index.fileIds).toHaveLength(1);
    const file = await getFile(doc!.index.fileIds[0]!);
    expect(file?.name).toBe('approval.pdf');
    expect(file?.bytes).toEqual(bytes);

    await deleteDocument(id);
    expect(await db.docs.count()).toBe(0);
    expect(await db.blobs.count()).toBe(0);
    expect(await db.vault.get(`doc:${id}`)).toBeUndefined();
  });
});
