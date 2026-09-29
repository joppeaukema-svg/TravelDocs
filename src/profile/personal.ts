import { z } from 'zod';
import { getSecret, putSecret } from '../vault/vault';

export const IceContact = z.object({
  name: z.string(),
  relation: z.string().default(''),
  phone: z.string(),
});
export type IceContact = z.infer<typeof IceContact>;

/** Personal and medical details. Stored encrypted in the vault. */
export const Personal = z.object({
  fullName: z.string().default(''),
  dateOfBirth: z.string().default(''),
  nationality: z.string().default(''),
  bloodType: z.string().default(''),
  allergies: z.string().default(''),
  medication: z.string().default(''),
  medicalNotes: z.string().default(''),
  iceContacts: z.array(IceContact).default([]),
});
export type Personal = z.infer<typeof Personal>;

const ID = 'personal';

export async function readPersonal(): Promise<Personal> {
  return (await getSecret(ID, Personal)) ?? Personal.parse({});
}

export async function savePersonal(value: Personal): Promise<void> {
  await putSecret(ID, Personal.parse(value));
}
