import 'fake-indexeddb/auto';
import { Temporal } from 'temporal-polyfill';
import { describe, expect, it } from 'vitest';
import { demoTrip } from '../../src/demo/demo';
import { daysInCountry } from '../../src/features/money/MoneyScreen';
import { Expense, expensesCsv, eurOf, spentByCategoryOn, spentOn, summarise, whoLabel } from '../../src/money/expenses';
import { shiftDates } from '../../src/trip/shift';
import type { TripData } from '../../src/trip/io';

const rates: Record<string, number> = { EUR: 1, THB: 40, LAK: 25_000 };
const rate = (c: string) => rates[c];
const e = (x: Partial<Expense>): Expense =>
  Expense.parse({ id: crypto.randomUUID(), date: '2026-11-03', amount: 100, currency: 'THB', category: 'food', country: 'TH', createdAt: '', updatedAt: '', ...x });

describe('expenses', () => {
  it('uses the EUR value fixed at entry, else today’s rate', () => {
    expect(eurOf(e({ amount: 400, eur: 12 }), rate)).toBe(12);
    expect(eurOf(e({ amount: 400 }), rate)).toBe(10);
    expect(eurOf(e({ currency: 'XXX' }), rate)).toBeUndefined();
  });

  it('totals per country and compares the daily average with the budget', () => {
    const list = [
      e({ amount: 400, category: 'food' }),
      e({ amount: 800, category: 'stay', date: '2026-10-27' }),
      e({ amount: 250_000, currency: 'LAK', country: 'LA', category: 'transport' }),
      e({ amount: 5, currency: 'XXX', country: 'LA' }),
    ];
    const s = summarise(list, rate, (c) => (c === 'TH' ? 2 : 5), { TH: 20, VN: 30 });
    expect(s.total).toBe(40);
    expect(s.unknown).toBe(1);
    const th = s.countries.find((c) => c.country === 'TH')!;
    expect(th).toMatchObject({ total: 30, days: 2, perDay: 15, budget: 20, byCategory: { food: 10, stay: 20 } });
    expect(s.countries.find((c) => c.country === 'VN')).toMatchObject({ total: 0, budget: 30 });
    expect(s.countries.find((c) => c.country === 'LA')!.unknown).toBe(1);
    expect(spentOn(list, '2026-11-03', rate)).toBe(20);
    // The same day per category, largest first; without a rate it isn't counted.
    expect(spentByCategoryOn([...list, e({ amount: 200 })], '2026-11-03', rate)).toEqual([
      ['food', 15],
      ['transport', 10],
    ]);
  });

  it('exports CSV with quoting and who it was for', () => {
    const csv = expensesCsv([e({ amount: 400, note: 'Pad thai, "extra" spicy' }), e({ amount: 40, category: 'esim', forWhom: 'b' })], rate, {
      a: 'Alex',
      b: 'Robin',
    });
    expect(csv).toBe(
      'date,country,category,for,amount,currency,eur,note\n' +
        '2026-11-03,TH,Food & drink,Samen,400,THB,10.00,"Pad thai, ""extra"" spicy"\n' +
        '2026-11-03,TH,E-sims,Robin,40,THB,1.00,\n',
    );
  });

  it('totals per person; older entries without "for" count as Samen', () => {
    const list = [e({ amount: 400 }), e({ amount: 800, forWhom: 'both' }), e({ amount: 200, forWhom: 'a' }), e({ amount: 120, forWhom: 'b' })];
    expect(summarise(list, rate, () => 1, {}).byWho).toEqual({ both: 30, a: 5, b: 3 });
    expect(whoLabel('both', { a: 'Alex', b: 'Robin' })).toBe('Samen');
    expect(whoLabel('a', { a: 'Alex', b: 'Robin' })).toBe('Alex');
    // Before the names are set.
    expect(whoLabel('b', { a: '', b: '' })).toBe('Traveller 2');
  });

  it('counts days in a country so far, or the planned days before arrival', () => {
    const trip = { stays: [{ country: 'TH', from: '2026-11-02', to: '2026-11-07' }, { country: 'TH', from: '2026-11-18', to: '2026-11-19' }] } as unknown as TripData;
    expect(daysInCountry(trip, 'TH', '2026-11-04')).toBe(3);
    expect(daysInCountry(trip, 'TH', '2026-11-27')).toBe(8);
    expect(daysInCountry(trip, 'TH', '2026-10-01')).toBe(8);
    expect(daysInCountry(trip, 'VN', '2026-10-01')).toBe(1);
  });
});

describe('demo data', () => {
  it('shifts every date and drops private keys', () => {
    expect(shiftDates({ a: '2026-03-14', b: ['2026-12-31'], note: 'x', t: '2026-03-14T10:00:00Z' }, 7, new Set(['note']))).toEqual({
      a: '2026-03-21',
      b: ['2027-01-07'],
      t: '2026-03-14T10:00:00Z',
    });
  });

  it('puts today about three weeks into the demo trip, keeping weekdays', async () => {
    const raw = (await import('../../demo/trip.demo.json')).default as { trip: { depart: string } };
    const trip = await demoTrip();
    const today = Temporal.Now.plainDateISO();
    const into = Temporal.PlainDate.from(trip.meta.depart).until(today).days;
    expect(into).toBeGreaterThanOrEqual(18);
    expect(into).toBeLessThanOrEqual(24);
    expect(Temporal.PlainDate.from(trip.meta.depart).dayOfWeek).toBe(Temporal.PlainDate.from(raw.trip.depart).dayOfWeek);
    expect(trip.meta.demo).toBe(true);
  });
});
