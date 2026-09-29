import { useLiveQuery } from 'dexie-react-hooks';
import { db, getMeta, META, setMeta, type PrepStateRow } from '../db/db';
import type { TripData } from './io';
import { Booking, Stay, TripMeta } from './schema';
import { mergeTrip, type MergeStats, type SharePayload, type Tombstones } from './share';

const now = () => new Date().toISOString();

/** JSON with sorted keys, so field order doesn't make two equal objects look different. */
function stable(v: unknown): string {
  return JSON.stringify(v, (_k, x: unknown) =>
    x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x).filter(([, y]) => y !== undefined).sort(([a], [b]) => a.localeCompare(b)))
      : x,
  );
}

// --- Share status -----------------------------------------------------------

export interface ShareStatus {
  lastSentAt?: string;
  lastReceivedAt?: string;
  /** When the companion made the share that was last received. */
  receivedShareAt?: string;
  /** Edits on this phone since the last send. */
  unsent: number;
}

export async function getShareStatus(): Promise<ShareStatus> {
  return { unsent: 0, ...((await getMeta(META.shareStatus)) as Partial<ShareStatus> | undefined) };
}

async function updateShareStatus(patch: Partial<ShareStatus>): Promise<void> {
  await setMeta(META.shareStatus, { ...(await getShareStatus()), ...patch });
}

/** A shared edit happened on this phone: counts until the next send. */
async function markUnsent(): Promise<void> {
  const s = await getShareStatus();
  await updateShareStatus({ unsent: s.unsent + 1 });
}

export async function markSent(at = now()): Promise<void> {
  await updateShareStatus({ lastSentAt: at, unsent: 0 });
}

export async function markReceived(shareCreatedAt: string): Promise<void> {
  await updateShareStatus({ lastReceivedAt: now(), receivedShareAt: shareCreatedAt });
}

export function useShareStatus(): ShareStatus | undefined {
  return useLiveQuery(getShareStatus, []);
}

/** Forget the trip code and the share history (the trip itself stays). */
export async function unlinkShare(): Promise<void> {
  await Promise.all([db.meta.delete(META.shareCode), db.meta.delete(META.shareStatus)]);
}

export async function getTombstones(): Promise<Tombstones> {
  return ((await getMeta(META.tripDeleted)) as Tombstones | undefined) ?? {};
}

async function addTombstones(keys: string[]): Promise<void> {
  if (!keys.length) return;
  const t = await getTombstones();
  const at = now();
  for (const k of keys) t[k] = at;
  await setMeta(META.tripDeleted, t);
}

/**
 * Replaces the whole itinerary (import of a trip file). Counts as an edit of
 * everything in it, and items no longer in the file are recorded as deleted,
 * so a later share carries the new version to a travel companion.
 */
export async function replaceTrip(data: TripData): Promise<void> {
  const at = now();
  const before = await loadTrip();
  await db.transaction('rw', db.stays, db.bookings, db.days, db.meta, async () => {
    await Promise.all([db.stays.clear(), db.bookings.clear(), db.days.clear()]);
    await db.stays.bulkPut(data.stays.map((s) => ({ ...s, updatedAt: at })));
    await db.bookings.bulkPut(data.bookings.map((b) => ({ ...b, updatedAt: at })));
    await db.days.bulkPut(data.days.map((d) => ({ ...d, updatedAt: at })));
    await db.meta.put({ key: META.trip, value: { ...data.meta, importedAt: at, updatedAt: at } });
  });
  if (before) {
    const ids = (xs: { id: string }[]) => new Set(xs.map((x) => x.id));
    const stays = ids(data.stays);
    const bookings = ids(data.bookings);
    const days = new Set(data.days.map((d) => d.date));
    await addTombstones([
      ...before.stays.filter((s) => !stays.has(s.id)).map((s) => `stay:${s.id}`),
      ...before.bookings.filter((b) => !bookings.has(b.id) && b.who !== 'me').map((b) => `booking:${b.id}`),
      ...before.days.filter((d) => !days.has(d.date)).map((d) => `day:${d.date}`),
    ]);
  }
  await markUnsent();
}

/** Merges a travel companion's shared trip into this phone's. */
export async function applySharedTrip(payload: SharePayload): Promise<MergeStats> {
  const { data, deleted, stats } = mergeTrip(await loadTrip(), await getTombstones(), payload);
  await db.transaction('rw', db.stays, db.bookings, db.days, db.meta, async () => {
    await Promise.all([db.stays.clear(), db.bookings.clear(), db.days.clear()]);
    await db.stays.bulkPut(data.stays);
    await db.bookings.bulkPut(data.bookings);
    await db.days.bulkPut(data.days);
    await db.meta.put({ key: META.trip, value: data.meta });
    await db.meta.put({ key: META.tripDeleted, value: deleted });
  });
  return stats;
}

export async function deleteTrip(): Promise<void> {
  await db.transaction('rw', db.stays, db.bookings, db.days, db.meta, db.prepState, async () => {
    await Promise.all([db.stays.clear(), db.bookings.clear(), db.days.clear(), db.prepState.clear()]);
    await Promise.all([META.trip, META.tripDeleted, META.shareStatus].map((k) => db.meta.delete(k)));
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

/** Saves a stay. Only a change to the passport stamp alone is personal and doesn't count as a shared edit. */
export async function saveStay(stay: Stay): Promise<void> {
  const before = await db.stays.get(stay.id);
  const { stampedUntil: _a, updatedAt: _b, ...next } = stay;
  const { stampedUntil: _c, updatedAt: _d, ...prev } = before ?? ({} as Stay);
  const sharedChange = !before || stable(Stay.parse({ ...next })) !== stable(Stay.parse({ ...prev }));
  await db.stays.put(Stay.parse({ ...stay, updatedAt: sharedChange ? now() : before?.updatedAt }));
  if (sharedChange) await markUnsent();
}

/** Saves a booking. Changing only linked documents or the private note doesn't count as a shared edit. */
export async function saveBooking(booking: Booking): Promise<void> {
  const before = await db.bookings.get(booking.id);
  const strip = (b: Booking) => {
    const { documentIds: _a, myNote: _b, updatedAt: _c, ...rest } = b;
    return stable(rest);
  };
  const sharedChange = !before || strip(Booking.parse(booking)) !== strip(before);
  await db.bookings.put(Booking.parse({ ...booking, updatedAt: sharedChange ? now() : before?.updatedAt }));
  // Edits to a "just me" booking that stays "just me" aren't shared.
  if (sharedChange && !(booking.who === 'me' && (!before || before.who === 'me'))) await markUnsent();
}

export async function deleteBooking(id: string): Promise<void> {
  const b = await db.bookings.get(id);
  await db.bookings.delete(id);
  if (b && b.who !== 'me') {
    await addTombstones([`booking:${id}`]);
    await markUnsent();
  }
}

export async function updateTripMeta(patch: Partial<TripMeta>): Promise<void> {
  const current = TripMeta.parse(await getMeta(META.trip));
  await setMeta(META.trip, TripMeta.parse({ ...current, ...patch, updatedAt: now() }));
  await markUnsent();
}

export async function setPrepState(id: string, status: PrepStateRow['status'] | null, snoozedUntil?: string) {
  if (!status) return db.prepState.delete(id);
  await db.prepState.put({ id, status, ...(snoozedUntil ? { snoozedUntil } : {}), updatedAt: new Date().toISOString() });
}

export function usePrepStates(): Map<string, PrepStateRow> {
  const rows = useLiveQuery(() => db.prepState.toArray(), []);
  return new Map((rows ?? []).map((r) => [r.id, r]));
}
