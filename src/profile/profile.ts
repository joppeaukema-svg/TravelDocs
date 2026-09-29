import { useLiveQuery } from 'dexie-react-hooks';
import { z } from 'zod';
import { isoDate } from '../content/schema';
import { db, getMeta, META, setMeta } from '../db/db';
import { ProfileFlag } from '../rules/content';

/**
 * The plaintext profile the rules engine reads while the vault is locked:
 * what's in your bag, passport expiry and blank pages, coverage limits.
 * No names or document numbers.
 */
export const ProfileData = z.object({
  flags: z.partialRecord(ProfileFlag, z.boolean()).default({}),
  blankPages: z.number().int().nonnegative().optional(),
  /** Manual expiry, used when no passport document with an expiry date exists. */
  passportExpiry: isoDate.optional(),
});
export type ProfileData = z.infer<typeof ProfileData>;

export const FLAG_LABELS: Record<ProfileFlag, { label: string; hint: string }> = {
  vape: { label: 'Vape or e-cigarette', hint: 'Banned in Vietnam, Thailand and Laos' },
  prescriptionMeds: { label: 'Prescription medicines', hint: 'Limits and paperwork, e.g. for Japan' },
  drone: { label: 'Drone', hint: 'Often needs a permit' },
  diving: { label: 'Diving', hint: 'Needs extra insurance cover' },
  scooter: { label: 'Riding a scooter or motorbike', hint: 'IDP, licence category and cover' },
};

export function parseProfile(raw: unknown): { profile: ProfileData; raw: Record<string, unknown> } {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const parsed = ProfileData.safeParse(obj);
  return { profile: parsed.success ? parsed.data : ProfileData.parse({}), raw: obj };
}

export async function updateProfile(patch: Partial<ProfileData>): Promise<void> {
  const { raw } = parseProfile(await getMeta(META.profile));
  const next: Record<string, unknown> = { ...raw, ...patch };
  for (const [k, v] of Object.entries(next)) if (v === undefined) delete next[k];
  await setMeta(META.profile, next);
}

export function useProfileRaw(): unknown {
  return useLiveQuery(async () => (await db.meta.get(META.profile))?.value ?? {}, []);
}

/** The passport expiry: the latest passport document's, else the manual date. */
export function usePassportExpiry(manual?: string): string | undefined {
  const docs = useLiveQuery(() => db.docs.where('type').equals('passport').toArray(), []);
  const fromDocs = (docs ?? []).map((d) => d.expiresAt).filter((x): x is string => !!x).sort().pop();
  return fromDocs ?? manual;
}
