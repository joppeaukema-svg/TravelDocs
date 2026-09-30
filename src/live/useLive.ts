import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect } from 'react';
import { getMeta, setMeta } from '../db/db';
import { AdviceFile, RatesFile, type Advice } from './schema';

/**
 * Live data (travel advice, embassies, rates) is published with the site and
 * refreshed daily. The app keeps the last copy it fetched in IndexedDB, so it
 * works offline and can tell what changed since you last read the advice.
 */
const KEYS = { advice: 'liveAdvice', rates: 'liveRates', seen: 'adviceSeen', rateOverrides: 'rateOverrides' } as const;

const base = () => import.meta.env.BASE_URL;

async function refresh<T>(file: string, key: string, schema: { safeParse: (x: unknown) => { success: boolean; data?: T } }): Promise<void> {
  try {
    const res = await fetch(`${base()}live/${file}`, { cache: 'no-cache' });
    if (!res.ok) return;
    const parsed = schema.safeParse(await res.json());
    if (!parsed.success) return;
    const current = (await getMeta(key)) as { fetchedAt?: string } | undefined;
    const next = parsed.data as { fetchedAt: string };
    if (!current?.fetchedAt || next.fetchedAt >= current.fetchedAt) await setMeta(key, next);
  } catch {
    // Offline or unreachable: keep the stored copy.
  }
}

let started = false;

/** Fetches fresh live data once per app start (and whenever the phone comes back online). */
export function useLiveRefresh(routeCountries: string[]): void {
  const key = routeCountries.join();
  useEffect(() => {
    const run = async () => {
      await Promise.all([refresh('advice.json', KEYS.advice, AdviceFile), refresh('rates.json', KEYS.rates, RatesFile)]);
      // Warm the offline cache with the advice maps for the countries on the route.
      const advice = AdviceFile.safeParse(await getMeta(KEYS.advice));
      if (advice.success) {
        for (const a of advice.data.countries.filter((c) => !key || key.includes(c.country))) {
          for (const m of a.maps) void fetch(`${base()}live/${m.file}`).catch(() => undefined);
        }
      }
    };
    if (!started) {
      started = true;
      void run();
    }
    window.addEventListener('online', run);
    return () => window.removeEventListener('online', run);
  }, [key]);
}

export function useAdvice(): { fetchedAt: string; countries: Advice[] } | null | undefined {
  return useLiveQuery(async () => {
    const parsed = AdviceFile.safeParse(await getMeta(KEYS.advice));
    return parsed.success ? parsed.data : null;
  }, []);
}

export function useRates(): RatesFile | null | undefined {
  return useLiveQuery(async () => {
    const parsed = RatesFile.safeParse(await getMeta(KEYS.rates));
    return parsed.success ? parsed.data : null;
  }, []);
}

// --- What you've read ---------------------------------------------------------

export type Seen = Record<string, { hash: string; lastModified: string; at: string }>;

export function useAdviceSeen(): Seen | undefined {
  return useLiveQuery(async () => ((await getMeta(KEYS.seen)) as Seen | undefined) ?? {}, []);
}

export async function markAdviceSeen(a: Advice): Promise<void> {
  const seen = ((await getMeta(KEYS.seen)) as Seen | undefined) ?? {};
  if (seen[a.country]?.hash === a.hash) return;
  await setMeta(KEYS.seen, { ...seen, [a.country]: { hash: a.hash, lastModified: a.lastModified, at: new Date().toISOString() } });
}

/** changed: read before, and it changed since. unread: never opened. */
export function adviceState(a: Advice, seen: Seen | undefined): 'current' | 'changed' | 'unread' {
  const s = seen?.[a.country];
  if (!s) return 'unread';
  return s.hash === a.hash ? 'current' : 'changed';
}

// --- Manual rates ---------------------------------------------------------------

export type RateOverrides = Record<string, number>;

export function useRateOverrides(): RateOverrides | undefined {
  return useLiveQuery(async () => ((await getMeta(KEYS.rateOverrides)) as RateOverrides | undefined) ?? {}, []);
}

export async function setRateOverride(currency: string, perEur: number | null): Promise<void> {
  const current = ((await getMeta(KEYS.rateOverrides)) as RateOverrides | undefined) ?? {};
  const next = { ...current };
  if (perEur === null) delete next[currency];
  else next[currency] = perEur;
  await setMeta(KEYS.rateOverrides, next);
}

