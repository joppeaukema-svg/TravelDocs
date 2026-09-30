import { useLiveQuery } from 'dexie-react-hooks';
import { z } from 'zod';
import { countryCode } from '../content/schema';
import { db, getMeta, META, setMeta } from '../db/db';

export const Settings = z.object({
  autoLockMinutes: z.number().int().min(1).max(60).default(5),
  backgroundGraceSeconds: z.number().int().min(0).max(600).default(30),
  theme: z.enum(['system', 'light', 'dark']).default('system'),
  /** Manual override for "where am I now"; null follows the itinerary. */
  countryOverride: countryCode.nullable().default(null),
  /** Weather forecasts: sends the names of your stops (no dates) to Open-Meteo. Off until you turn it on. */
  weather: z.boolean().default(false),
});
export type Settings = z.infer<typeof Settings>;

export const DEFAULT_SETTINGS: Settings = Settings.parse({});

export function parseSettings(raw: unknown): Settings {
  const parsed = Settings.safeParse(raw ?? {});
  return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}

export function useSettings(): Settings {
  const raw = useLiveQuery(() => db.meta.get(META.settings), []);
  return parseSettings(raw?.value);
}

export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  const current = parseSettings(await getMeta(META.settings));
  await setMeta(META.settings, Settings.parse({ ...current, ...patch }));
}
