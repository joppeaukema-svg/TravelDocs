import { z } from 'zod';
import { Booking, Day, Stay, TRIP_FORMAT, TripMeta } from './schema';

export interface TripData {
  meta: TripMeta;
  stays: Stay[];
  bookings: Booking[];
  days: Day[];
}

export interface Rejected {
  where: string;
  reason: string;
}

export interface ImportResult {
  data: TripData;
  rejected: Rejected[];
}

export class TripFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TripFileError';
  }
}

const Envelope = z.object({
  format: z.literal(TRIP_FORMAT),
  traveller: z
    .object({
      passport: z.string().optional(),
      homeCountry: z.string().optional(),
      homeTimeZone: z.string().optional(),
    })
    .default({}),
  trip: z.object({ title: z.string().optional(), depart: z.string(), return: z.string() }),
  demo: z.boolean().optional(),
  stays: z.array(z.unknown()).default([]),
  bookings: z.array(z.unknown()).default([]),
  days: z.array(z.unknown()).default([]),
});

function describe(error: z.ZodError): string {
  return error.issues
    .slice(0, 3)
    .map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message))
    .join('; ');
}

function label(raw: unknown, index: number, key: 'id' | 'date'): string {
  const v = raw && typeof raw === 'object' ? (raw as Record<string, unknown>)[key] : undefined;
  return typeof v === 'string' ? v : `#${index + 1}`;
}

/**
 * Parses a `travel-companion-trip/1` file. Items that don't validate are left
 * out and listed in `rejected`; only a broken envelope throws.
 */
export function parseTripFile(json: unknown): ImportResult {
  if (json && typeof json === 'object' && (json as { format?: unknown }).format !== TRIP_FORMAT) {
    throw new TripFileError(`Not a trip file: "format" must be "${TRIP_FORMAT}".`);
  }
  const env = Envelope.safeParse(json);
  if (!env.success) throw new TripFileError(`The trip file is incomplete: ${describe(env.error)}`);
  const e = env.data;

  const metaParsed = TripMeta.safeParse({
    title: e.trip.title,
    depart: e.trip.depart,
    return: e.trip.return,
    passport: e.traveller.passport,
    homeCountry: e.traveller.homeCountry ?? e.traveller.passport,
    homeTimeZone: e.traveller.homeTimeZone,
    demo: e.demo ?? false,
  });
  if (!metaParsed.success) throw new TripFileError(`Trip details: ${describe(metaParsed.error)}`);
  if (metaParsed.data.return < metaParsed.data.depart) throw new TripFileError('The trip returns before it departs.');

  const rejected: Rejected[] = [];
  function items<T>(list: unknown[], schema: z.ZodType<T>, kind: string, key: 'id' | 'date', idOf: (t: T) => string) {
    const out: T[] = [];
    const seen = new Set<string>();
    list.forEach((raw, i) => {
      const where = `${kind} ${label(raw, i, key)}`;
      const parsed = schema.safeParse(raw);
      if (!parsed.success) return rejected.push({ where, reason: describe(parsed.error) });
      const id = idOf(parsed.data);
      if (seen.has(id)) return rejected.push({ where, reason: `duplicate ${key}` });
      seen.add(id);
      out.push(parsed.data);
    });
    return out;
  }

  const stays = items(e.stays, Stay, 'Stay', 'id', (s) => s.id).sort((a, b) => a.from.localeCompare(b.from));
  const bookings = items(e.bookings, Booking, 'Booking', 'id', (b) => b.id);
  const days = items(e.days, Day, 'Day', 'date', (d) => d.date).sort((a, b) => a.date.localeCompare(b.date));

  return { data: { meta: metaParsed.data, stays, bookings, days }, rejected };
}

/** Writes the same format back (the app is the source of truth after import). */
export function exportTripFile(data: TripData): Record<string, unknown> {
  const { meta } = data;
  return {
    format: TRIP_FORMAT,
    traveller: { passport: meta.passport, homeCountry: meta.homeCountry, homeTimeZone: meta.homeTimeZone },
    trip: { title: meta.title, depart: meta.depart, return: meta.return },
    ...(meta.demo ? { demo: true } : {}),
    stays: data.stays,
    bookings: data.bookings,
    days: data.days,
  };
}
