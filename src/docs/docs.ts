import { z } from 'zod';
import { db, type DocIndexRow } from '../db/db';
import { getSecret, sealFile, sealSecret, type VaultFile } from '../vault/vault';

export const DocType = z.enum([
  'passport',
  'evisa',
  'insurance-policy',
  'insurance-card',
  'idp',
  'vaccination',
  'ticket',
  'booking',
  'other',
]);
export type DocType = z.infer<typeof DocType>;

export const DOC_TYPE_LABELS: Record<DocType, string> = {
  passport: 'Passport',
  evisa: 'E-visa / approval letter',
  'insurance-policy': 'Insurance policy',
  'insurance-card': 'Insurance card',
  idp: 'International driving permit',
  vaccination: 'Vaccination record',
  ticket: 'Ticket',
  booking: 'Booking confirmation',
  other: 'Other',
};

/** The encrypted part of a document. */
export const DocSecret = z.object({
  title: z.string(),
  number: z.string().default(''),
  issuer: z.string().default(''),
  issuedAt: z.string().default(''),
  notes: z.string().default(''),
});
export type DocSecret = z.infer<typeof DocSecret>;

export interface DocInput {
  type: DocType;
  expiresAt?: string | undefined;
  secret: DocSecret;
}

const secretId = (id: string) => `doc:${id}`;
export const fileOwner = (id: string) => `doc:${id}`;

function withoutEmpty<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '')) as T;
}

export async function createDocument(input: DocInput): Promise<string> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const sealed = await sealSecret(secretId(id), input.secret);
  const row: DocIndexRow = withoutEmpty({
    id,
    type: input.type,
    expiresAt: input.expiresAt,
    fileIds: [],
    createdAt: now,
    updatedAt: now,
  });
  await db.transaction('rw', db.docs, db.vault, async () => {
    await db.vault.put(sealed);
    await db.docs.put(row);
  });
  return id;
}

export async function updateDocument(id: string, input: DocInput): Promise<void> {
  const sealed = await sealSecret(secretId(id), input.secret);
  await db.transaction('rw', db.docs, db.vault, async () => {
    const existing = await db.docs.get(id);
    if (!existing) throw new Error('Document not found.');
    const { expiresAt: _drop, ...rest } = existing;
    await db.vault.put(sealed);
    await db.docs.put(
      withoutEmpty({ ...rest, type: input.type, expiresAt: input.expiresAt, updatedAt: new Date().toISOString() }),
    );
  });
}

export async function readDocument(id: string): Promise<{ index: DocIndexRow; secret: DocSecret } | undefined> {
  const index = await db.docs.get(id);
  if (!index) return undefined;
  const secret = await getSecret(secretId(id), DocSecret);
  return { index, secret: secret ?? { title: '', number: '', issuer: '', issuedAt: '', notes: '' } };
}

export async function deleteDocument(id: string): Promise<void> {
  await db.transaction('rw', db.docs, db.vault, db.blobs, async () => {
    await db.blobs.where('owner').equals(fileOwner(id)).delete();
    await db.vault.delete(secretId(id));
    await db.docs.delete(id);
  });
}

export async function addDocumentFiles(id: string, files: VaultFile[]): Promise<void> {
  const rows = await Promise.all(files.map((f) => sealFile(fileOwner(id), f)));
  await db.transaction('rw', db.docs, db.blobs, async () => {
    const doc = await db.docs.get(id);
    if (!doc) throw new Error('Document not found.');
    await db.blobs.bulkPut(rows);
    await db.docs.update(id, {
      fileIds: [...doc.fileIds, ...rows.map((r) => r.id)],
      updatedAt: new Date().toISOString(),
    });
  });
}

export async function removeDocumentFile(id: string, fileId: string): Promise<void> {
  await db.transaction('rw', db.docs, db.blobs, async () => {
    const doc = await db.docs.get(id);
    if (!doc) return;
    await db.blobs.delete(fileId);
    await db.docs.update(id, {
      fileIds: doc.fileIds.filter((f) => f !== fileId),
      updatedAt: new Date().toISOString(),
    });
  });
}
