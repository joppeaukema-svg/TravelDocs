import { useLiveQuery } from 'dexie-react-hooks';
import { z } from 'zod';
import { getMeta, setMeta } from '../db/db';
import type { TripData } from '../trip/io';

/**
 * 7-day forecasts from Open-Meteo (free, no key, no account). Only the place
 * name and country are sent — never dates or anything else from the trip.
 * Results are kept so the last forecast still shows offline.
 */
const GEO = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST = 'https://api.open-meteo.com/v1/forecast';
const KEY = 'weather';

export interface Stop {
  place: string;
  country: string;
  from: string;
  to: string;
}

/** The trip as a list of stops (consecutive days in the same place). */
export function stops(trip: TripData): Stop[] {
  const out: Stop[] = [];
  const days = [...trip.days].filter((d) => d.place).sort((a, b) => a.date.localeCompare(b.date));
  if (days.length) {
    for (const d of days) {
      const last = out[out.length - 1];
      if (last && last.place === d.place && last.country === d.country) last.to = d.date;
      else out.push({ place: d.place!, country: d.country, from: d.date, to: d.date });
    }
    return out;
  }
  return [...trip.stays]
    .filter((s) => s.places[0])
    .sort((a, b) => a.from.localeCompare(b.from))
    .map((s) => ({ place: s.places[0]!, country: s.country, from: s.from, to: s.to }));
}

/** Where you are today (or the first stop before the trip) and the stop after it. */
export function currentAndNext(all: Stop[], today: string): Stop[] {
  const i = all.findIndex((s) => s.to >= today);
  if (i < 0) return [];
  return all.slice(i, i + 2);
}

export const Forecast = z.object({
  place: z.string(),
  country: z.string(),
  /** The name the geocoder matched, e.g. "Luang Prabang, Laos". */
  matched: z.string(),
  fetchedAt: z.string(),
  days: z.array(
    z.object({ date: z.string(), code: z.number(), max: z.number(), min: z.number(), rain: z.number().nullable() }),
  ),
});
export type Forecast = z.infer<typeof Forecast>;
const Store = z.record(z.string(), Forecast);

const keyOf = (s: { place: string; country: string }) => `${s.country}:${s.place.toLowerCase()}`;

async function fetchJson(url: string): Promise<Record<string, unknown>> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

export async function fetchForecast(stop: Stop): Promise<Forecast> {
  // Place names in trips are often "Hanoi (Old Quarter)" or "Vang Vieng / Kasi": use the first part.
  const name = stop.place.split(/[(/,]/)[0]!.trim();
  const geo = await fetchJson(`${GEO}?${new URLSearchParams({ name, count: '1', language: 'en', format: 'json', countryCode: stop.country })}`);
  const hit = (geo.results as { latitude: number; longitude: number; name: string; country?: string }[] | undefined)?.[0];
  if (!hit) throw new Error(`No weather location found for “${name}”`);
  const f = await fetchJson(
    `${FORECAST}?${new URLSearchParams({
      latitude: String(hit.latitude),
      longitude: String(hit.longitude),
      daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
      timezone: 'auto',
      forecast_days: '7',
    })}`,
  );
  const d = f.daily as { time: string[]; weather_code: number[]; temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_probability_max: (number | null)[] };
  return {
    place: stop.place,
    country: stop.country,
    matched: [hit.name, hit.country].filter(Boolean).join(', '),
    fetchedAt: new Date().toISOString(),
    days: d.time.map((date, i) => ({
      date,
      code: d.weather_code[i]!,
      max: Math.round(d.temperature_2m_max[i]!),
      min: Math.round(d.temperature_2m_min[i]!),
      rain: d.precipitation_probability_max[i] ?? null,
    })),
  };
}

async function readStore(): Promise<Record<string, Forecast>> {
  const parsed = Store.safeParse(await getMeta(KEY));
  return parsed.success ? parsed.data : {};
}

/** Refreshes the forecasts for these stops; keeps the old ones when offline. Returns errors per place. */
export async function refreshForecasts(list: Stop[]): Promise<string[]> {
  const errors: string[] = [];
  const current = await readStore();
  for (const s of list) {
    try {
      current[keyOf(s)] = await fetchForecast(s);
    } catch (e) {
      errors.push(`${s.place}: ${(e as Error).message}`);
    }
  }
  await setMeta(KEY, current);
  return errors;
}

export function useForecasts(list: Stop[]): (Forecast | undefined)[] | undefined {
  const key = list.map(keyOf).join('|');
  return useLiveQuery(async () => {
    const store = await readStore();
    return list.map((s) => store[keyOf(s)]);
  }, [key]);
}

export async function clearForecasts(): Promise<void> {
  await setMeta(KEY, {});
}

/** WMO weather codes as used by Open-Meteo. */
export function describe(code: number): { icon: string; label: string } {
  if (code === 0) return { icon: '☀️', label: 'Clear' };
  if (code <= 2) return { icon: '🌤️', label: 'Partly cloudy' };
  if (code === 3) return { icon: '☁️', label: 'Overcast' };
  if (code === 45 || code === 48) return { icon: '🌫️', label: 'Fog' };
  if (code >= 51 && code <= 57) return { icon: '🌦️', label: 'Drizzle' };
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return { icon: '🌧️', label: [65, 67, 82].includes(code) ? 'Heavy rain' : 'Rain' };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { icon: '🌨️', label: 'Snow' };
  if (code >= 95) return { icon: '⛈️', label: 'Thunderstorm' };
  return { icon: '🌡️', label: 'Unknown' };
}
