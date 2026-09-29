import { useLiveQuery } from 'dexie-react-hooks';
import { db, getMeta, META, setMeta, type PrepStateRow } from '../db/db';
import type { TripData } from './io';
import { Booking, Stay, TripMeta } from './schema';

/** Replaces the whole itinerary (import). Prep states for items that still exist are kept. */
export async function replaceTrip(data: TripData): Promise<void> {
  await db.transaction('rw', db.stays, db.bookings, db.days, db.meta, async () => {
    await Promise.all([db.stays.clear(), db.bookings.clear(), db.days.clear()]);
    await db.stays.bulkPut(data.stays);
    await db.bookings.bulkPut(data.bookings);
    await db.days.bulkPut(data.days);
    await db.meta.put({ key: META.trip, value: { ...data.meta, importedAt: new Date().toISOString() } });
  });
}

export async function deleteTrip(): Promise<void> {
  await db.transaction('rw', db.stays, db.bookings, db.days, db.meta, db.prepState, async () => {
    await Promise.all([db.stays.clear(), db.bookings.clear(), db.days.clear(), db.prepState.clear()]);
    await db.meta.delete(META.trip);
  });
}

export async function loadTrip(): Promise<TripData | null> {
  const raw = await getMeta(META.trip);
  if (!raw) return null;
  const meta = TripMeta.parse(raw);
  const [stays, bookings, days] = await Promise.all([
    db.stays.orderBy('from').toArray(),
    db.bookings.toArray(),
    db.days.orderBy('date').toArray(),
  ]);
  return { meta, stays, bookings, days };
}

/** undefined while loading, null when no trip has been imported. */
export function useTrip(): TripData | null | undefined {
  return useLiveQuery(loadTrip, []);
}

export async function saveStay(stay: Stay): Promise<void> {
  await db.stays.put(Stay.parse(stay));
}

export async function saveBooking(booking: Booking): Promise<void> {
  await db.bookings.put(Booking.parse(booking));
}

export async function deleteBooking(id: string): Promise<void> {
  await db.bookings.delete(id);
}

export async function updateTripMeta(patch: Partial<TripMeta>): Promise<void> {
  const current = TripMeta.parse(await getMeta(META.trip));
  await setMeta(META.trip, TripMeta.parse({ ...current, ...patch }));
}

export async function setPrepState(id: string, status: PrepStateRow['status'] | null, snoozedUntil?: string) {
  if (!status) return db.prepState.delete(id);
  await db.prepState.put({ id, status, ...(snoozedUntil ? { snoozedUntil } : {}), updatedAt: new Date().toISOString() });
}

export function usePrepStates(): Map<string, PrepStateRow> {
  const rows = useLiveQuery(() => db.prepState.toArray(), []);
  return new Map((rows ?? []).map((r) => [r.id, r]));
}
