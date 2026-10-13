import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, META } from '../../src/db/db';
import type { Holiday } from '../../src/rules/content';
import { buildContext } from '../../src/rules/context';
import { runRules } from '../../src/rules/engine';
import { Itinerary } from '../../src/rules/itinerary';
import type { Check, PrepItem } from '../../src/rules/types';
import type { TripData } from '../../src/trip/io';
import { checksByLeg, holidaysOn, tasksByDate, tripLegs } from '../../src/trip/days';
import { getShareStatus, getTombstones, loadTrip, replaceTrip, saveDay } from '../../src/trip/store';
import { hop, stay, trip } from './rules/helpers';

// Made-up dates only (see the privacy test).

function legsOf(data: TripData) {
  const it = new Itinerary(buildContext(data, { today: '2031-01-01' }));
  const days = new Map(data.days.map((d) => [d.date, d.country]));
  return { it, legs: tripLegs(data.meta, it.stays, (d) => days.get(d)) };
}

describe('day by day', () => {
  it('groups every date by stay; days outside a stay get their own leg', () => {
    const vn = stay({ id: 'vn', country: 'VN', from: '2031-03-02', to: '2031-03-06' });
    const la = stay({ id: 'la', country: 'LA', from: '2031-03-06', to: '2031-03-11' });
    const { legs } = legsOf(trip('2031-03-01', '2031-03-12', [la, vn]));
    expect(legs.map((l) => [l.key, l.kind, l.country, l.dates.length])).toEqual([
      ['departure-2031-03-01', 'departure', 'NL', 1],
      ['vn', 'stay', 'VN', 5],
      ['la', 'stay', 'LA', 6],
      ['return-2031-03-12', 'return', 'NL', 1],
    ]);
    // The travel day shows in both countries.
    expect(legs[1]!.dates.at(-1)).toBe('2031-03-06');
    expect(legs[2]!.dates[0]).toBe('2031-03-06');
  });

  it('a gap between stays is "on the way", with the country of that day', () => {
    const jp = stay({ id: 'jp', country: 'JP', from: '2031-03-01', to: '2031-03-04' });
    const ph = stay({ id: 'ph', country: 'PH', from: '2031-03-06', to: '2031-03-08' });
    const data = trip('2031-03-01', '2031-03-08', [jp, ph]);
    data.days = [{ date: '2031-03-05', country: 'TW', place: 'Night bus', note: '' }];
    const { legs } = legsOf(data);
    expect(legs.map((l) => [l.kind, l.country, l.from, l.to])).toEqual([
      ['stay', 'JP', '2031-03-01', '2031-03-04'],
      ['between', 'TW', '2031-03-05', '2031-03-05'],
      ['stay', 'PH', '2031-03-06', '2031-03-08'],
    ]);
  });

  it('holidays show on their dates, local festivals only where you stay', () => {
    const h = (id: string, placeMatch?: string): Holiday => ({
      id,
      country: 'PH',
      name: id,
      from: '2031-01-10',
      to: '2031-01-11',
      detail: '',
      sourceIds: [],
      ...(placeMatch ? { placeMatch } : {}),
    });
    const all = [h('national'), h('festival', 'cebu')];
    expect(holidaysOn(all, 'PH', ['Manila'], '2031-01-11').map((x) => x.id)).toEqual(['national']);
    expect(holidaysOn(all, 'PH', ['Manila', 'Cebu City'], '2031-01-10').map((x) => x.id)).toEqual(['national', 'festival']);
    expect(holidaysOn(all, 'PH', ['Cebu City'], '2031-01-12')).toEqual([]);
    expect(holidaysOn(all, 'VN', ['Cebu City'], '2031-01-10')).toEqual([]);
  });

  it('checks go to their country, most serious first; holidays and whole-trip checks are left out', () => {
    const vn = stay({ id: 'vn', country: 'VN', from: '2031-05-01', to: '2031-05-20' });
    const la = stay({ id: 'la', country: 'LA', from: '2031-05-20', to: '2031-06-10' });
    // A self-transfer in Thailand on the way from Vietnam to Laos.
    const leg1 = hop('VN', 'TH', '2031-05-20', { id: 'leg1', to: 'Bangkok (BKK)' });
    const leg2 = hop('TH', 'LA', '2031-05-20', { id: 'leg2', from: 'Bangkok (BKK)' });
    const data = trip('2031-05-01', '2031-06-10', [vn, la], [leg1, leg2]);
    const { it, legs } = legsOf(data);
    const result = runRules(buildContext(data, { today: '2031-01-01' }));
    const extra: Check[] = [
      { id: 'holiday-x', rule: 9, severity: 'info', title: 'A holiday', detail: '', country: 'LA', stayId: 'la', sourceIds: [] },
      { id: 'crit-la', rule: 1, severity: 'critical', title: 'Too long', detail: '', country: 'LA', stayId: 'la', sourceIds: [] },
      { id: 'whole-trip', rule: 7, severity: 'warn', title: 'Insurance', detail: '', sourceIds: [] },
    ];
    const byLeg = checksByLeg(legs, [...result.checks, ...extra], it.stays);
    const ids = (key: string) => (byLeg.get(key) ?? []).map((c) => c.id);

    expect(ids('vn')).toContain('connection-connection-leg1');
    expect(ids('la')[0]).toBe('crit-la');
    expect(ids('la')).not.toContain('connection-connection-leg1');
    const all = [...byLeg.values()].flat().map((c) => c.id);
    expect(all).not.toContain('holiday-x');
    expect(all).not.toContain('whole-trip');
  });

  it('a connection on one ticket goes to the stay you leave from', () => {
    const la = stay({ id: 'la', country: 'LA', from: '2031-03-15', to: '2031-04-03' });
    const ph = stay({ id: 'ph', country: 'PH', from: '2031-04-04', to: '2031-04-24' });
    const a = hop('LA', 'VN', '2031-04-03', { id: 'leg-a', to: 'Connecting airport' });
    const b = hop('VN', 'PH', '2031-04-03', { id: 'leg-b', from: 'Connecting airport', arriveDate: '2031-04-04', sameTicketAs: 'leg-a' });
    const data = trip('2031-03-15', '2031-04-24', [la, ph], [a, b]);
    const { it, legs } = legsOf(data);
    const byLeg = checksByLeg(legs, runRules(buildContext(data, { today: '2031-01-01' })).checks, it.stays);
    expect((byLeg.get('la') ?? []).map((c) => c.id)).toContain('through-leg-a');
  });
});

describe('must-dos on their day', () => {
  it('puts the mandatory forms for the next country in the days before you go there', () => {
    // Japan, then Vietnam (landing at Hanoi): the pre-arrival form is mandatory, Visit Japan Web is not.
    const jp = stay({ id: 'jp', country: 'JP', from: '2031-03-02', to: '2031-03-20' });
    const vn = stay({ id: 'vn', country: 'VN', from: '2031-03-20', to: '2031-04-05', entry: { point: 'Hanoi Noi Bai International Airport (HAN)' } });
    const data = trip('2031-03-01', '2031-04-05', [jp, vn], [hop('NL', 'JP', '2031-03-01', { arriveDate: '2031-03-02' }), hop('JP', 'VN', '2031-03-20')]);
    const result = runRules(buildContext(data, { today: '2031-01-01' }));
    const tasks = tasksByDate(result.prep, data.meta.depart, data.meta.return);
    const all = [...tasks.entries()].flatMap(([date, list]) => list.map((p) => [date, p.id]));
    expect(all).toContainEqual(['2031-03-17', 'form-vn-prearrival-vn']);
    expect(all.some(([, id]) => id!.startsWith('form-jp-vjw'))).toBe(false);
    expect([...tasks.values()].flat().every((p) => p.severity !== 'info')).toBe(true);
  });

  it('still-open tasks from before the trip go on the first day; ones due before leaving do not', () => {
    const item = (id: string, remindOn: string, deadline?: string): PrepItem => ({
      id,
      group: 'x',
      country: 'VN',
      moment: 't21',
      title: id,
      severity: 'warn',
      remindOn,
      ...(deadline ? { deadline } : {}),
      at: { date: remindOn, time: '09:00', tz: 'UTC' },
      alarm: { date: remindOn, time: '09:00', tz: 'UTC' },
      sourceIds: [],
    });
    const tasks = tasksByDate([item('open', '2031-02-01', '2031-03-05'), item('before', '2031-02-01', '2031-02-27'), item('after', '2031-05-01')], '2031-03-01', '2031-04-01');
    expect([...tasks.entries()]).toEqual([['2031-03-01', [expect.objectContaining({ id: 'open' })]]]);
  });
});

describe('editing a day', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
    await replaceTrip(trip('2031-03-01', '2031-03-05', [stay({ id: 'jp', country: 'JP', from: '2031-03-01', to: '2031-03-05' })]));
    await db.meta.put({ key: META.shareStatus, value: { unsent: 0 } });
  });

  it('adds a note to a day that had none, stamped and counted for the next share', async () => {
    await db.meta.put({ key: META.tripDeleted, value: { 'day:2031-03-02': '2020-01-01T00:00:00Z' } });
    await saveDay('2031-03-02', 'JP', { place: 'Kyoto', note: 'Book the train ticket today' });
    const day = (await loadTrip())!.days.find((d) => d.date === '2031-03-02')!;
    expect(day).toMatchObject({ country: 'JP', place: 'Kyoto', note: 'Book the train ticket today' });
    expect(day.updatedAt).toBeTruthy();
    expect((await getShareStatus()).unsent).toBe(1);
    // It was deleted before; now it's back.
    expect(await getTombstones()).toEqual({});
  });

  it('keeps the country of an existing day, and saving without a change does nothing', async () => {
    await db.days.put({ date: '2031-03-03', country: 'JP', place: 'Osaka', note: 'Parkrun', updatedAt: 'x' });
    await saveDay('2031-03-03', 'PH', { place: 'Osaka', note: 'Parkrun' });
    expect(await db.days.get('2031-03-03')).toMatchObject({ updatedAt: 'x' });
    expect((await getShareStatus()).unsent).toBe(0);

    await saveDay('2031-03-03', 'PH', { place: 'Osaka', note: '' });
    expect(await db.days.get('2031-03-03')).toMatchObject({ country: 'JP', place: 'Osaka', note: '' });
    expect((await getShareStatus()).unsent).toBe(1);
  });

  it('an empty note on a day that does not exist yet is not saved', async () => {
    await saveDay('2031-03-04', 'JP', { place: null, note: '' });
    expect(await db.days.get('2031-03-04')).toBeUndefined();
  });
});
