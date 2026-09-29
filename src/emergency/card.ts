import { z } from 'zod';
import { getMeta, META, setMeta } from '../db/db';
import { IceContact, readPersonal } from '../profile/personal';
import { readInsurance } from '../profile/insurance';

/** Which vault fields appear on the emergency card. */
export const CardChoices = z.object({
  fullName: z.boolean().default(false),
  insurer: z.boolean().default(true),
  policyNumber: z.boolean().default(true),
  assistancePhone: z.boolean().default(true),
  iceContacts: z.boolean().default(true),
  bloodType: z.boolean().default(false),
  allergies: z.boolean().default(false),
  medication: z.boolean().default(false),
  medicalNotes: z.boolean().default(false),
});
export type CardChoices = z.infer<typeof CardChoices>;

export const CARD_FIELD_LABELS: Record<keyof CardChoices, string> = {
  fullName: 'My full name',
  insurer: 'Insurer',
  policyNumber: 'Policy number',
  assistancePhone: "Insurer's 24/7 assistance number",
  iceContacts: 'ICE contacts',
  bloodType: 'Blood type',
  allergies: 'Allergies',
  medication: 'Medication',
  medicalNotes: 'Other medical notes',
};

/**
 * Plaintext copy of the chosen fields, so the card stays readable while the
 * vault is locked. Only what the user switched on is ever written here.
 */
export const CardSnapshot = z.object({
  choices: CardChoices,
  fullName: z.string().optional(),
  insurer: z.string().optional(),
  policyNumber: z.string().optional(),
  assistancePhone: z.string().optional(),
  iceContacts: z.array(IceContact).optional(),
  bloodType: z.string().optional(),
  allergies: z.string().optional(),
  medication: z.string().optional(),
  medicalNotes: z.string().optional(),
  updatedAt: z.string().optional(),
});
export type CardSnapshot = z.infer<typeof CardSnapshot>;

export function parseCard(raw: unknown): CardSnapshot {
  const parsed = CardSnapshot.safeParse(raw ?? {});
  return parsed.success ? parsed.data : { choices: CardChoices.parse({}) };
}

export async function readCardChoices(): Promise<CardChoices> {
  return parseCard(await getMeta(META.emergencyCard)).choices;
}

/** Rebuilds the snapshot from the vault. Needs the vault to be unlocked. */
export async function refreshEmergencyCard(choices?: CardChoices): Promise<void> {
  const c = choices ?? (await readCardChoices());
  const [personal, insurance] = await Promise.all([readPersonal(), readInsurance()]);
  const pick = (on: boolean, value: string) => (on && value.trim() ? value.trim() : undefined);
  const snapshot: CardSnapshot = {
    choices: c,
    fullName: pick(c.fullName, personal.fullName),
    insurer: pick(c.insurer, insurance.insurer),
    policyNumber: pick(c.policyNumber, insurance.policyNumber),
    assistancePhone: pick(c.assistancePhone, insurance.assistancePhone),
    iceContacts: c.iceContacts ? personal.iceContacts.filter((x) => x.phone.trim()) : undefined,
    bloodType: pick(c.bloodType, personal.bloodType),
    allergies: pick(c.allergies, personal.allergies),
    medication: pick(c.medication, personal.medication),
    medicalNotes: pick(c.medicalNotes, personal.medicalNotes),
    updatedAt: new Date().toISOString(),
  };
  await setMeta(META.emergencyCard, JSON.parse(JSON.stringify(snapshot)));
}

/** "+31 247 247 247" → "tel:+31247247247" */
export function telHref(number: string): string {
  return `tel:${number.replace(/[^+\d]/g, '')}`;
}

export function whatsappHref(number: string): string {
  return `https://wa.me/${number.replace(/\D/g, '')}`;
}
