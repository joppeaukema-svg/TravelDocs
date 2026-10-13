import { useLiveQuery } from 'dexie-react-hooks';
import { db, getMeta, META, setMeta, type PrepStateRow } from '../db/db';
import type { TripData } from './io';
import { Booking, Day, Stay, TripMeta } from './schema';
import { MONEY_META, Travellers } from '../money/schema';
import { mergeTrip, type MergeStats, type PhoneData, type SharePayload, type Tombstones } from './share';
import type { UpdatePlan } from './update';

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

/** Shared edits happened on this phone: they count until the next send. */
export async function markUnsent(count = 1): Promise<void> {
  const s = await getShareStatus();
  await updateShareStatus({ unsent: s.unsent + count });
}

/** Everything was sent; or, with `count`, the edits counted before an automatic sync started (later ones still wait). */
export async function markSent(at = now(), count?: number): Promise<void> {
  const unsent = count === undefined ? 0 : Math.max(0, (await getShareStatus()).unsent - count);
  await updateShareStatus({ lastSentAt: at, unsent });
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

export async function addTombstones(keys: string[]): Promise<void> {
  if (!keys.length) return;
  const t = await getTombstones();
  const at = now();
  for (const k of keys) t[k] = at;
  await setMeta(META.tripDeleted, t);
}

/** The existing item's time when the new version is the same, else `at`. */
function keepTime<T extends { updatedAt?: string | undefined }>(before: T | undefined, next: T, at: string): string {
  if (!before?.updatedAt) return at;
  const strip = ({ updatedAt: _u, ...rest }: T) => stable(rest);
  return strip(before) === strip(next) ? before.updatedAt : at;
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
    // Items the file doesn't change keep their time, so an import never beats a companion's newer edit of them.
    await db.stays.bulkPut(data.stays.map((s) => ({ ...s, updatedAt: keepTime(before?.stays.find((x) => x.id === s.id), s, at) })));
    await db.bookings.bulkPut(data.bookings.map((b) => ({ ...b, updatedAt: keepTime(before?.bookings.find((x) => x.id === b.id), b, at) })));
    await db.days.bulkPut(data.days.map((d) => ({ ...d, updatedAt: keepTime(before?.days.find((x) => x.date === d.date), d, at) })));
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

/**
 * Applies an update file's changes (see planTripUpdate). Only the changed
 * items are written; they count as edits, so the next share carries them to a
 * travel companion.
 */
export async function applyTripUpdate(plan: UpdatePlan): Promise<number> {
  const at = now();
  const { stays, bookings, days } = plan.write;
  const count = stays.length + bookings.length + days.length;
  if (!count) return 0;
  await db.transaction('rw', db.stays, db.bookings, db.days, db.meta, async () => {
    await db.stays.bulkPut(stays.map((s) => ({ ...s, updatedAt: at })));
    await db.bookings.bulkPut(bookings.map((b) => ({ ...b, updatedAt: at })));
    await db.days.bulkPut(days.map((d) => ({ ...d, updatedAt: at })));
    // Something deleted earlier and now back in the update is no longer deleted.
    const t = await getTombstones();
    for (const k of [...stays.map((s) => `stay:${s.id}`), ...bookings.map((b) => `booking:${b.id}`), ...days.map((d) => `day:${d.date}`)]) delete t[k];
    await db.meta.put({ key: META.tripDeleted, value: t });
  });
  await markUnsent(count);
  return count;
}

/** Merges a travel companion's shared trip into this phone's. */
// --- Small shared settings ---------------------------------------------------

/** Settings that travel with the trip, each with when it was last changed (kept in SHARED_TIMES). */
export const SHARED_META = ['rateOverrides', 'showCardAddress'] as const;
const SHARED_TIMES = 'sharedMetaTimes';
// Set before sharing included them: they go along, but lose to any later change.
const LONG_AGO = '1970-01-01T00:00:00.000Z';

/** Saves one of SHARED_META and counts it as an edit to send. */
export async function setSharedMeta(key: (typeof SHARED_META)[number], value: unknown): Promise<void> {
  const times = ((await getMeta(SHARED_TIMES)) as Record<string, string> | undefined) ?? {};
  await setMeta(key, value);
  await setMeta(SHARED_TIMES, { ...times, [key]: now() });
  await markUnsent();
}

/** Everything on this phone that travels with the trip besides the itinerary. */
export async function loadPhoneData(): Promise<PhoneData> {
  const [expenses, values, budgetsAt, travellers, prep, times, ...extraValues] = await Promise.all([
    db.expenses.toArray(),
    getMeta(MONEY_META.budgets),
    getMeta(MONEY_META.budgetsUpdatedAt),
    getMeta(MONEY_META.travellers),
    db.prepState.toArray(),
    getMeta(SHARED_TIMES),
    ...SHARED_META.map((k) => getMeta(k)),
  ]);
  const t = Travellers.safeParse(travellers);
  const extras: PhoneData['extras'] = {};
  SHARED_META.forEach((k, i) => {
    if (extraValues[i] !== undefined) extras[k] = { value: extraValues[i], updatedAt: (times as Record<string, string> | undefined)?.[k] ?? LONG_AGO };
  });
  return {
    expenses,
    ...(values ? { budgets: { values: values as Record<string, number>, updatedAt: typeof budgetsAt === 'string' ? budgetsAt : LONG_AGO } } : {}),
    ...(t.success ? { travellers: { ...t.data, updatedAt: t.data.updatedAt ?? LONG_AGO } } : {}),
    prep,
    extras,
  };
}

/** Merges a travel companion's shared trip (with everything else they filled in) into this phone's. */
export async function applySharedTrip(payload: SharePayload): Promise<MergeStats> {
  const { data, deleted, stats, phone } = mergeTrip(await loadTrip(), await getTombstones(), payload, await loadPhoneData());
  await db.transaction('rw', [db.stays, db.bookings, db.days, db.expenses, db.prepState, db.meta], async () => {
    await Promise.all([db.stays.clear(), db.bookings.clear(), db.days.clear(), db.expenses.clear(), db.prepState.clear()]);
    await db.stays.bulkPut(data.stays);
    await db.bookings.bulkPut(data.bookings);
    await db.days.bulkPut(data.days);
    await db.expenses.bulkPut(phone.expenses);
    await db.prepState.bulkPut(phone.prep ?? []);
    await db.meta.put({ key: META.trip, value: data.meta });
    await db.meta.put({ key: META.tripDeleted, value: deleted });
    if (phone.budgets) {
      await db.meta.put({ key: MONEY_META.budgets, value: phone.budgets.values });
      await db.meta.put({ key: MONEY_META.budgetsUpdatedAt, value: phone.budgets.updatedAt });
    }
    if (phone.travellers) await db.meta.put({ key: MONEY_META.travellers, value: phone.travellers });
    const times: Record<string, string> = {};
    for (const [k, v] of Object.entries(phone.extras ?? {})) {
      if (!(SHARED_META as readonly string[]).includes(k)) continue;
      await db.meta.put({ key: k, value: v.value });
      times[k] = v.updatedAt;
    }
    await db.meta.put({ key: SHARED_TIMES, value: times });
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

/** Saves a stay (passport stamp included: it travels with the trip). */
export async function saveStay(stay: Stay): Promise<void> {
  const before = await db.stays.get(stay.id);
  const { updatedAt: _b, ...next } = stay;
  const { updatedAt: _d, ...prev } = before ?? ({} as Stay);
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

/**
 * Saves the place and notes of one day. Days are shared, so the next send
 * carries the change to a travel companion. A day that isn't in the trip yet
 * is added for `country`.
 */
export async function saveDay(date: string, country: string, patch: { place?: string | null; note?: string }): Promise<void> {
  const before = await db.days.get(date);
  const next = Day.parse({ date, country, place: null, note: '', ...before, ...patch, updatedAt: now() });
  if (before ? before.place === next.place && before.note === next.note : !next.place && !next.note) return;
  await db.transaction('rw', db.days, db.meta, async () => {
    await db.days.put(next);
    const t = await getTombstones();
    if (t[`day:${date}`]) {
      delete t[`day:${date}`];
      await db.meta.put({ key: META.tripDeleted, value: t });
    }
  });
  await markUnsent();
}

export async function updateTripMeta(patch: Partial<TripMeta>): Promise<void> {
  const current = TripMeta.parse(await getMeta(META.trip));
  await setMeta(META.trip, TripMeta.parse({ ...current, ...patch, updatedAt: now() }));
  await markUnsent();
}

/** Ticks (or unticks) a checklist or packing item. Ticks travel with the trip. */
export async function setPrepState(id: string, status: PrepStateRow['status'] | null, snoozedUntil?: string) {
  if (!status) {
    if (await db.prepState.get(id)) {
      await db.prepState.delete(id);
      await addTombstones([`prep:${id}`]);
      await markUnsent();
    }
    return;
  }
  await db.prepState.put({ id, status, ...(snoozedUntil ? { snoozedUntil } : {}), updatedAt: new Date().toISOString() });
  await markUnsent();
}

export function usePrepStates(): Map<string, PrepStateRow> {
  const rows = useLiveQuery(() => db.prepState.toArray(), []);
  return new Map((rows ?? []).map((r) => [r.id, r]));
}
