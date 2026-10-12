import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../src/db/db';
import { parseTripFile } from '../../src/trip/io';
import { applyTripUpdate, getShareStatus, getTombstones, loadTrip, replaceTrip } from '../../src/trip/store';
import { isTripUpdate, parseTripUpdate, planTripUpdate, TRIP_UPDATE_FORMAT, withUpdate } from '../../src/trip/update';

const demo = () => parseTripFile(JSON.parse(readFileSync('demo/trip.demo.json', 'utf8'))).data;

describe('trip update files', () => {
  const trip = demo();
  const first = trip.bookings.find((b) => b.type === 'flight')!;
  const stay = trip.stays[1]!;
  const day = trip.days[3]!;

  it('patches only the fields it lists, adds complete new bookings and reports the rest', () => {
    const update = parseTripUpdate({
      format: TRIP_UPDATE_FORMAT,
      title: 'Flights',
      bookings: [
        { id: first.id, status: 'booked', provider: 'Test Air', note: null },
        { id: 'new-leg', type: 'flight', status: 'booked', from: 'A (AAA)', to: 'B (BBB)', depart: { date: trip.meta.depart, time: '10:00', tz: 'Asia/Tokyo' } },
        { id: 'half', status: 'booked' },
        { id: trip.bookings.find((b) => b.id !== first.id)!.id }, // nothing to change
      ],
      stays: [{ id: stay.id, entry: { point: 'Tokyo Narita (NRT)', mode: 'air' } }, { id: 'nope', from: '2030-01-01' }],
      days: [{ date: day.date, place: 'Somewhere else' }],
    });
    const plan = planTripUpdate({ ...trip, bookings: trip.bookings.map((b) => (b.id === first.id ? { ...b, note: 'old' } : b)) }, update);

    expect(plan.changes.map((c) => [c.kind, c.key, c.action, c.fields])).toEqual([
      ['booking', first.id, 'update', first.status === 'booked' ? ['note', 'provider'] : ['note', 'provider', 'status']],
      ['booking', 'new-leg', 'add', expect.arrayContaining(['from', 'to', 'depart'])],
      ['stay', stay.id, 'update', ['entry']],
      ['day', day.date, 'update', ['place']],
    ]);
    expect(plan.unchanged).toBe(1);
    expect(plan.problems.map((p) => p.where)).toEqual(['Booking half', 'Stay nope']);
    expect(plan.problems[0]!.reason).toMatch(/not in your trip/);

    const changed = plan.write.bookings.find((b) => b.id === first.id)!;
    expect(changed).toMatchObject({ provider: 'Test Air', status: 'booked', from: first.from, depart: first.depart });
    expect(changed.note).toBeUndefined();

    const after = withUpdate(trip, plan);
    expect(after.bookings).toHaveLength(trip.bookings.length + 1);
    expect(after.stays.find((s) => s.id === stay.id)!.entry.point).toBe('Tokyo Narita (NRT)');
    expect(after.stays.find((s) => s.id === stay.id)!.from).toBe(stay.from);
  });

  it('recognises update files and rejects broken ones', () => {
    expect(isTripUpdate({ format: TRIP_UPDATE_FORMAT })).toBe(true);
    expect(isTripUpdate({ format: 'travel-companion-trip/1' })).toBe(false);
    expect(() => parseTripUpdate({ format: TRIP_UPDATE_FORMAT, bookings: [{ status: 'booked' }] })).toThrow(/incomplete/);
  });

  it('refuses a stay change that would break the stay', () => {
    const plan = planTripUpdate(trip, parseTripUpdate({ format: TRIP_UPDATE_FORMAT, stays: [{ id: stay.id, from: '2099-01-01' }] }));
    expect(plan.changes).toEqual([]);
    expect(plan.problems[0]!.reason).toMatch(/before "from"/);
  });
});

describe('applying an update', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  it('writes only the changes, stamps them and counts them for the next share', async () => {
    const trip = demo();
    await replaceTrip(trip);
    const before = await loadTrip();
    const unsentBefore = (await getShareStatus()).unsent;
    const first = before!.bookings.find((b) => b.type === 'flight')!;
    const untouched = before!.bookings.find((b) => b.id !== first.id)!;
    await db.meta.put({ key: 'tripDeleted', value: { 'booking:came-back': '2020-01-01T00:00:00Z' } });

    const plan = planTripUpdate(
      before!,
      parseTripUpdate({
        format: TRIP_UPDATE_FORMAT,
        bookings: [
          { id: first.id, provider: 'Test Air' },
          { id: 'came-back', type: 'ferry', status: 'planned', from: 'X', to: 'Y' },
        ],
      }),
    );
    expect(await applyTripUpdate(plan)).toBe(2);

    const after = await loadTrip();
    const changed = after!.bookings.find((b) => b.id === first.id)!;
    expect(changed.provider).toBe('Test Air');
    expect(changed.updatedAt! > first.updatedAt!).toBe(true);
    expect(after!.bookings.find((b) => b.id === untouched.id)).toEqual(untouched);
    expect(after!.bookings.find((b) => b.id === 'came-back')).toBeDefined();
    expect(await getTombstones()).toEqual({});
    expect((await getShareStatus()).unsent).toBe(unsentBefore + 1);
  });
});
