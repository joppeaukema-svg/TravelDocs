import { beforeEach, describe, expect, it } from 'vitest';
import { DecryptionError } from '../../src/crypto/aead';
import { WrongPassphraseError } from '../../src/crypto/keys';
import {
  backupIsDue,
  createBackup,
  InvalidBackupError,
  parseBackup,
  restoreBackup,
} from '../../src/backup/backup';
import { db, eraseAllData, META, setMeta } from '../../src/db/db';
import { addDocumentFiles, createDocument, readDocument } from '../../src/docs/docs';
import { refreshEmergencyCard } from '../../src/emergency/card';
import { Insurance, saveInsurance } from '../../src/profile/insurance';
import { Personal, savePersonal } from '../../src/profile/personal';
import { vaultSession } from '../../src/vault/session';
import { getFile, lockVault } from '../../src/vault/vault';
import { dumpDatabase, freshVault, PASSPHRASE, pseudoRandomBytes } from './helpers';

async function populate() {
  await savePersonal(
    Personal.parse({
      fullName: 'Demo Traveller',
      bloodType: 'O+',
      iceContacts: [{ name: 'Demo Contact', relation: 'sister', phone: '+31 6 0000 0000' }],
    }),
  );
  await saveInsurance(Insurance.parse({ insurer: 'Demo Insurer', policyNumber: 'P-1', maxDaysPerTrip: 180 }));
  await refreshEmergencyCard();
  await setMeta(META.settings, { autoLockMinutes: 10 });
  const id = await createDocument({
    type: 'passport',
    expiresAt: '2030-01-01',
    secret: { title: 'Passport', number: 'X1', issuer: '', issuedAt: '', notes: '' },
  });
  const scan = pseudoRandomBytes(300_000, 5);
  const pdf = pseudoRandomBytes(50_000, 9);
  await addDocumentFiles(id, [
    { name: 'scan.jpg', type: 'image/jpeg', bytes: scan },
    { name: 'copy.pdf', type: 'application/pdf', bytes: pdf },
  ]);
  return { id, scan, pdf };
}

async function toBytes(blob: Blob) {
  return new Uint8Array(await blob.arrayBuffer());
}

beforeEach(freshVault);

describe('backup', () => {
  it('export → wipe → import restores everything', async () => {
    const { id, scan, pdf } = await populate();
    const before = await dumpDatabase();
    const file = await toBytes(await createBackup(new Date('2026-01-02T03:04:05Z')));

    await eraseAllData();
    lockVault();
    expect(await db.docs.count()).toBe(0);

    const header = await restoreBackup(file, PASSPHRASE);
    expect(header.createdAt).toBe('2026-01-02T03:04:05.000Z');
    expect(vaultSession.isUnlocked()).toBe(true);

    const after = await dumpDatabase();
    const withoutBackupStamp = (d: Record<string, unknown[]>) => ({
      ...d,
      meta: d.meta!.filter((r) => (r as { key: string }).key !== META.lastBackupAt),
    });
    expect(withoutBackupStamp(after)).toEqual(withoutBackupStamp(before));

    const doc = await readDocument(id);
    const [scanId, pdfId] = doc!.index.fileIds;
    expect((await getFile(scanId!))?.bytes).toEqual(scan);
    expect((await getFile(pdfId!))?.bytes).toEqual(pdf);
  });

  it('holds no readable personal data', async () => {
    await populate();
    const file = await toBytes(await createBackup());
    const text = new TextDecoder('latin1').decode(file);
    for (const needle of ['Demo Traveller', 'Demo Insurer', 'Demo Contact', 'scan.jpg', 'Passport']) {
      expect(text).not.toContain(needle);
    }
  });

  it('rejects a wrong passphrase without touching current data', async () => {
    await populate();
    const file = await toBytes(await createBackup());
    const before = await dumpDatabase();
    await expect(restoreBackup(file, 'not the passphrase')).rejects.toBeInstanceOf(WrongPassphraseError);
    expect(await dumpDatabase()).toEqual(before);
  });

  it('rejects damaged or foreign files', async () => {
    await populate();
    const file = await toBytes(await createBackup());

    const damaged = file.slice();
    damaged[damaged.length - 10]! ^= 0xff;
    await expect(restoreBackup(damaged, PASSPHRASE)).rejects.toBeInstanceOf(DecryptionError);

    // Editing the plaintext header (here: its date) breaks authentication too.
    const { header } = parseBackup(file);
    const edited = new TextDecoder('latin1').decode(file).replace(header.createdAt, header.createdAt.replace(/\d$/, 'x'));
    const editedBytes = Uint8Array.from(edited, (c) => c.charCodeAt(0));
    await expect(restoreBackup(editedBytes, PASSPHRASE)).rejects.toThrow();

    await expect(restoreBackup(new TextEncoder().encode('hello'), PASSPHRASE)).rejects.toBeInstanceOf(
      InvalidBackupError,
    );
  });

  it('reminds after 7 days', () => {
    const now = new Date('2026-10-10T12:00:00Z');
    expect(backupIsDue(undefined, now)).toBe(true);
    expect(backupIsDue('2026-10-04T12:00:00Z', now)).toBe(false);
    expect(backupIsDue('2026-10-03T11:00:00Z', now)).toBe(true);
  });
});
