import { z } from 'zod';
import { getMeta, META, setMeta } from '../db/db';
import { getSecret, putSecret } from '../vault/vault';

export const Cover = z.enum(['unknown', 'yes', 'no']);
export type Cover = z.infer<typeof Cover>;

/** Insurance details as entered from the policy. Stored encrypted in the vault. */
export const Insurance = z.object({
  insurer: z.string().default(''),
  policyNumber: z.string().default(''),
  assistancePhone: z.string().default(''),
  claimProcedure: z.string().default(''),
  claimDeadline: z.string().default(''),
  excess: z.string().default(''),
  medicalCosts: z.string().default(''),
  evacuation: Cover.default('unknown'),
  evacuationNotes: z.string().default(''),
  maxDaysPerTrip: z.number().int().positive().nullable().default(null),
  scooter: Cover.default('unknown'),
  scooterConditions: z.string().default(''),
  diving: Cover.default('unknown'),
  divingMaxDepthM: z.number().positive().nullable().default(null),
  trekking: Cover.default('unknown'),
  trekkingNotes: z.string().default(''),
  valuablesLimit: z.string().default(''),
  orangeRedAreas: z.string().default(''),
});
export type Insurance = z.infer<typeof Insurance>;

/**
 * The coverage facts the rules engine needs, mirrored in plaintext so checks
 * run while the vault is locked. No names or numbers.
 */
export const CoverageSummary = Insurance.pick({
  evacuation: true,
  maxDaysPerTrip: true,
  scooter: true,
  diving: true,
  divingMaxDepthM: true,
  trekking: true,
}).extend({ entered: z.boolean().default(false) });
export type CoverageSummary = z.infer<typeof CoverageSummary>;

const ID = 'insurance';
const SUMMARY_KEY = 'insuranceCoverage';

export async function readInsurance(): Promise<Insurance> {
  return (await getSecret(ID, Insurance)) ?? Insurance.parse({});
}

export async function saveInsurance(value: Insurance): Promise<void> {
  const parsed = Insurance.parse(value);
  await putSecret(ID, parsed);
  const { evacuation, maxDaysPerTrip, scooter, diving, divingMaxDepthM, trekking } = parsed;
  const profile = ((await getMeta(META.profile)) ?? {}) as Record<string, unknown>;
  await setMeta(META.profile, {
    ...profile,
    [SUMMARY_KEY]: { evacuation, maxDaysPerTrip, scooter, diving, divingMaxDepthM, trekking, entered: true },
  });
}

export function readCoverageSummary(profile: unknown): CoverageSummary {
  const raw = (profile as Record<string, unknown> | undefined)?.[SUMMARY_KEY];
  return CoverageSummary.parse(raw ?? {});
}
