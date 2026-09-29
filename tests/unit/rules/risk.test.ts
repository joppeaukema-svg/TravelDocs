import { describe, expect, it } from 'vitest';
import { rulesContent } from '../../../src/rules/content';
import { buildContext } from '../../../src/rules/context';
import { runRules } from '../../../src/rules/engine';
import { check, hop, item, run, stay, trip } from './helpers';

const route = () => [
  stay({ id: 'jp', country: 'JP', from: '2026-10-26', to: '2026-11-17', places: ['Okinawa'] }),
  stay({ id: 'la', country: 'LA', from: '2026-12-07', to: '2026-12-30', places: ['Huay Xai', 'Thakhek'], entry: { point: 'Friendship Bridge IV — Huay Xai', mode: 'land' } }),
  stay({ id: 'ph', country: 'PH', from: '2026-12-30', to: '2027-01-20', places: ['Manila', 'Cebu'] }),
];

describe('rule 7 — insurance', () => {
  it('compares the trip length with the maximum days per trip', () => {
    const data = trip('2026-10-24', '2027-01-21', route());
    expect(check(run(data), 'ins-max-days')?.severity).toBe('warn');
    expect(check(run(data, { coverage: { entered: true, maxDaysPerTrip: 60 } }), 'ins-max-days')?.severity).toBe('critical');
    expect(check(run(data, { coverage: { entered: true, maxDaysPerTrip: 90 } }), 'ins-max-days')).toBeUndefined();
  });

  it('checks scooter and diving plans against the cover', () => {
    const scooter = hop('LA', 'LA', '2026-12-22', { type: 'scooter', status: 'planned', title: 'Thakhek Loop' });
    const data = trip('2026-10-24', '2027-01-21', route(), [scooter]);
    expect(check(run(data), 'ins-scooter')?.severity).toBe('warn');
    expect(check(run(data, { coverage: { entered: true, scooter: 'no' } }), 'ins-scooter')?.severity).toBe('critical');
    expect(check(run(data, { coverage: { entered: true, scooter: 'yes' } }), 'ins-scooter')).toBeUndefined();
    expect(check(run(data, { profile: { flags: { diving: true } } }), 'ins-diving')?.severity).toBe('warn');
  });

  it('flags stops in or near orange/red advice areas', () => {
    expect(check(run(trip('2026-10-24', '2027-01-21', route())), 'ins-area-la-bokeo-border')?.title).toMatch(/^Huay Xai/);
  });
});

describe('rule 8 — things in the bag', () => {
  it('vapes are critical for Vietnam, Thailand and Laos; e-liquid limit for Japan', () => {
    const r = run(trip('2026-10-24', '2027-01-21', route()), { profile: { flags: { vape: true } } });
    expect(check(r, 'bag-bag-vape-banned')).toMatchObject({ severity: 'critical', title: 'Vapes are banned: Laos' });
    expect(check(r, 'bag-bag-vape-jp')?.severity).toBe('info');
    expect(run(trip('2026-10-24', '2027-01-21', route())).checks.some((c) => c.id.startsWith('bag-'))).toBe(false);
  });

  it('prescription medicines trigger Japan rules and the medicine statement', () => {
    const r = run(trip('2026-10-24', '2027-01-21', route()), { profile: { flags: { prescriptionMeds: true } } });
    expect(check(r, 'bag-bag-meds-jp')?.severity).toBe('warn');
    expect(item(r, 'pd-meds')).toBeDefined();
  });
});

describe('rule 9 — holidays', () => {
  it('warns about holidays during a stay', () => {
    const r = run(trip('2026-10-24', '2027-01-21', route()));
    expect(check(r, 'holiday-jp-culture-day-2026')?.title).toBe('Culture Day, 3 Nov 2026');
    expect(check(r, 'holiday-ph-rizal-new-year-2026')).toBeDefined();
    expect(check(r, 'holiday-ph-sinulog-2027')).toBeDefined();
  });

  it('only for the matching place and dates', () => {
    const ph = stay({ country: 'PH', from: '2027-01-10', to: '2027-01-20', places: ['Coron'] });
    expect(check(run(trip('2027-01-10', '2027-01-20', [ph])), 'holiday-ph-sinulog-2027')).toBeUndefined();
  });
});

describe('rule 10 — content freshness', () => {
  it('asks to re-verify sources older than 30 days', () => {
    const data = trip('2027-01-01', '2027-01-10', []);
    expect(check(run(data, { today: '2026-10-29' }), 'freshness')).toBeUndefined();
    const stale = check(run(data, { today: '2026-10-30' }), 'freshness');
    expect(stale?.severity).toBe('warn');
    expect(stale?.title).toMatch(/Re-verify \d+ rule sources/);
  });

  it('also looks at entry, forms and laws facts in the country content', () => {
    const ctx = buildContext(trip('2027-01-01', '2027-01-10', []), { today: '2026-10-01' });
    ctx.facts = [{ id: 'x', title: 'Old entry fact', topic: 'entry', verifiedAt: '2026-01-01' }];
    expect(runRules(ctx).checks.find((c) => c.id === 'freshness')?.detail).toMatch(/Old entry fact/);
  });
});

describe('rule 12 — land crossings', () => {
  it('shows how to cross Friendship Bridge IV, and warns about unknown crossings', () => {
    const r = run(trip('2026-12-07', '2026-12-30', [route()[1]!]));
    expect(check(r, 'crossing-la')?.title).toBe('Crossing: Friendship Bridge IV (Chiang Khong ↔ Huay Xai)');
    const unknown = stay({ id: 'x', country: 'LA', from: '2026-12-07', to: '2026-12-30', entry: { point: 'Nam Phao', mode: 'land' } });
    expect(check(run(trip('2026-12-07', '2026-12-30', [unknown])), 'crossing-unknown-x')?.severity).toBe('warn');
  });
});

describe('rule 13 — driving', () => {
  it('car and scooter plans need an IDP (1949 model for Japan) before leaving, and a check a week before', () => {
    const car = hop('JP', 'JP', '2026-11-13', { id: 'car', type: 'car', status: 'idea', title: 'Rental car Okinawa' });
    const scooter = hop('LA', 'LA', '2026-12-22', { id: 'scooter', type: 'scooter', status: 'planned', title: 'Thakhek Loop' });
    const r = run(trip('2026-10-24', '2027-01-21', route(), [car, scooter]), { today: '2026-09-29' });
    expect(item(r, 'pd-idp')?.title).toBe('International driving permit (1949 model for Japan) at an ANWB store');
    expect(item(r, 'pd-idp')?.remindOn).toBe('2026-08-29');
    expect(item(r, 'driving-scooter')).toMatchObject({ remindOn: '2026-12-15', title: 'Thakhek Loop: IDP, licence category, scooter cover' });
    expect(check(r, 'driving-idp')?.severity).toBe('warn');
  });

  it('no driving, no IDP task', () => {
    expect(item(run(trip('2026-10-24', '2027-01-21', route())), 'pd-idp')).toBeUndefined();
  });
});

describe('rules content', () => {
  it('every rule has a source that exists', async () => {
    const { missingSourceIds } = await import('../../../src/rules/content');
    expect(missingSourceIds(rulesContent)).toEqual([]);
  });
});
