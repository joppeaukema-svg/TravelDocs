import { z } from 'zod';
import type { Rejected, TripData } from './io';
import { Booking, bookingLabel, Day, Stay } from './schema';

/**
 * An update file changes part of a trip that's already on the phone — new
 * flight times, a booking that's now confirmed — without replacing the rest.
 * Each item names an existing booking or stay by `id` (a day by `date`) and
 * lists only the fields that change; `null` clears a field. A booking that
 * doesn't exist yet is added, so it must be complete.
 *
 *   { "format": "travel-companion-update/1", "title": "Flights",
 *     "bookings": [{ "id": "flight-1", "status": "booked", "provider": "Some Air" }],
 *     "stays": [{ "id": "stay-2", "entry": { "point": "Some airport (XXX)", "mode": "air" } }],
 *     "days": [{ "date": "2030-01-01", "place": "A → B" }] }
 */
export const TRIP_UPDATE_FORMAT = 'travel-companion-update/1';

const Patch = z.record(z.string(), z.unknown());

const UpdateFile = z.object({
  format: z.literal(TRIP_UPDATE_FORMAT),
  title: z.string().optional(),
  bookings: z.array(Patch.and(z.object({ id: z.string().min(1) }))).default([]),
  stays: z.array(Patch.and(z.object({ id: z.string().min(1) }))).default([]),
  days: z.array(Patch.and(z.object({ date: z.string().min(1) }))).default([]),
});
export type TripUpdate = z.infer<typeof UpdateFile>;

export function isTripUpdate(json: unknown): boolean {
  return !!json && typeof json === 'object' && (json as { format?: unknown }).format === TRIP_UPDATE_FORMAT;
}

export function parseTripUpdate(json: unknown): TripUpdate {
  const parsed = UpdateFile.safeParse(json);
  if (!parsed.success) throw new Error(`The update file is incomplete: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
  return parsed.data;
}

export interface UpdateChange {
  kind: 'booking' | 'stay' | 'day';
  key: string;
  label: string;
  action: 'add' | 'update';
  /** The fields that change. */
  fields: string[];
}

export interface UpdatePlan {
  title?: string | undefined;
  changes: UpdateChange[];
  /** Items left out, with the reason. */
  problems: Rejected[];
  /** Unchanged items (already up to date). */
  unchanged: number;
  /** The records to write. */
  write: { stays: Stay[]; bookings: Booking[]; days: Day[] };
}

/** JSON with sorted keys, so field order doesn't make equal values look different. */
function stable(v: unknown): string {
  return JSON.stringify(v ?? null, (_k, x: unknown) =>
    x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x).filter(([, y]) => y !== undefined).sort(([a], [b]) => a.localeCompare(b)))
      : x,
  );
}

const IGNORED = new Set(['updatedAt']);

function patch<T extends object>(base: T | undefined, p: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(base ?? {}) };
  for (const [k, v] of Object.entries(p)) {
    if (IGNORED.has(k)) continue;
    if (v === null) delete out[k];
    else out[k] = v;
  }
  return out;
}

function changedFields(before: object | undefined, after: object): string[] {
  const b = (before ?? {}) as Record<string, unknown>;
  const a = after as Record<string, unknown>;
  return [...new Set([...Object.keys(b), ...Object.keys(a)])].filter((k) => !IGNORED.has(k) && stable(b[k]) !== stable(a[k])).sort();
}

const issue = (e: z.ZodError) => e.issues.slice(0, 2).map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message)).join('; ');

/** Works out what an update file would change in a trip. Pure: nothing is written. */
export function planTripUpdate(trip: TripData, update: TripUpdate): UpdatePlan {
  const plan: UpdatePlan = { title: update.title, changes: [], problems: [], unchanged: 0, write: { stays: [], bookings: [], days: [] } };

  for (const p of update.bookings) {
    const existing = trip.bookings.find((b) => b.id === p.id);
    const parsed = Booking.safeParse(patch(existing, p));
    if (!parsed.success) {
      plan.problems.push({ where: `Booking ${p.id}`, reason: existing ? issue(parsed.error) : `not in your trip, and not complete enough to add (${issue(parsed.error)})` });
      continue;
    }
    const fields = changedFields(existing, parsed.data);
    if (!fields.length) {
      plan.unchanged++;
      continue;
    }
    plan.changes.push({ kind: 'booking', key: p.id, label: bookingLabel(parsed.data), action: existing ? 'update' : 'add', fields });
    plan.write.bookings.push(parsed.data);
  }

  for (const p of update.stays) {
    const existing = trip.stays.find((s) => s.id === p.id);
    const parsed = Stay.safeParse(patch(existing, p));
    if (!parsed.success) {
      plan.problems.push({ where: `Stay ${p.id}`, reason: existing ? issue(parsed.error) : 'not in your trip' });
      continue;
    }
    const fields = changedFields(existing, parsed.data);
    if (!fields.length) {
      plan.unchanged++;
      continue;
    }
    const label = parsed.data.places[0] ? `${parsed.data.country} · ${parsed.data.places[0]}` : parsed.data.country;
    plan.changes.push({ kind: 'stay', key: p.id, label, action: existing ? 'update' : 'add', fields });
    plan.write.stays.push(parsed.data);
  }

  for (const p of update.days) {
    const existing = trip.days.find((d) => d.date === p.date);
    const parsed = Day.safeParse(patch(existing, p));
    if (!parsed.success) {
      plan.problems.push({ where: `Day ${p.date}`, reason: issue(parsed.error) });
      continue;
    }
    const fields = changedFields(existing, parsed.data);
    if (!fields.length) {
      plan.unchanged++;
      continue;
    }
    plan.changes.push({ kind: 'day', key: p.date, label: parsed.data.place ?? p.date, action: existing ? 'update' : 'add', fields });
    plan.write.days.push(parsed.data);
  }
  return plan;
}

/** The trip as it would be after the update (for checks and tests). */
export function withUpdate(trip: TripData, plan: UpdatePlan): TripData {
  const replace = <T>(list: T[], next: T[], key: (t: T) => string) => {
    const m = new Map(list.map((t) => [key(t), t]));
    for (const t of next) m.set(key(t), t);
    return [...m.values()];
  };
  return {
    meta: trip.meta,
    stays: replace(trip.stays, plan.write.stays, (s) => s.id).sort((a, b) => a.from.localeCompare(b.from)),
    bookings: replace(trip.bookings, plan.write.bookings, (b) => b.id),
    days: replace(trip.days, plan.write.days, (d) => d.date).sort((a, b) => a.date.localeCompare(b.date)),
  };
}
