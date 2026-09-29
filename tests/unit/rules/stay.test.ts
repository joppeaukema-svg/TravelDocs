import { describe, expect, it } from 'vitest';
import { check, hop, item, run, stay, trip } from './helpers';

// Round trips from the Netherlands with one stay, flights in and out booked.
function single(country: string, from: string, to: string, extra: Parameters<typeof stay>[0] | object = {}) {
  const s = stay({ country, from, to, ...extra });
  return trip(from, to, [s], [hop('NL', country, from), hop(country, 'NL', to)]);
}

describe('rule 1 — stay limits', () => {
  it('Vietnam visa-free allows 45 days and suggests an e-visa beyond that', () => {
    const ok = run(single('VN', '2026-11-01', '2026-12-15')); // 45 days
    expect(ok.stays[0]).toMatchObject({ days: 45, limitDays: 45, mustLeaveBy: '2026-12-15' });
    expect(ok.checks.filter((c) => c.severity === 'critical')).toEqual([]);

    const tooLong = run(single('VN', '2026-11-01', '2026-12-16', { id: 'vn' }));
    const c = check(tooLong, 'stay-over-vn');
    expect(c?.severity).toBe('critical');
    expect(c?.detail).toMatch(/e-visa/);
    expect(item(tooLong, 'stay-too-long-vn')?.remindOn).toBe('2026-10-11');

    const evisa = run(single('VN', '2026-11-01', '2026-12-30', { entryType: 'e-visa' }));
    expect(evisa.stays[0]?.limitDays).toBe(90);
    expect(evisa.checks.some((x) => x.id.startsWith('stay-over'))).toBe(false);
  });

  it('Philippines allows 30 days and reminds to extend before day 30 when staying longer', () => {
    expect(run(single('PH', '2026-12-30', '2027-01-28')).checks.some((c) => c.id.startsWith('stay-extend'))).toBe(false);
    const r = run(single('PH', '2026-12-30', '2027-02-10', { id: 'ph' }));
    expect(check(r, 'stay-extend-ph')?.severity).toBe('warn');
    expect(item(r, 'stay-extend-ph')).toMatchObject({ remindOn: '2027-01-21', deadline: '2027-01-28' });
  });

  it('Japan allows 90 days', () => {
    expect(run(single('JP', '2026-10-26', '2027-01-23')).stays[0]).toMatchObject({ days: 90, mustLeaveBy: '2027-01-23' });
  });

  it('Thailand: 60 days for arrivals before 15 Sep 2026, 30 days from then', () => {
    expect(run(single('TH', '2026-09-14', '2026-09-20')).stays[0]?.limitDays).toBe(60);
    expect(run(single('TH', '2026-09-15', '2026-09-20')).stays[0]?.limitDays).toBe(30);
  });

  it('Laos: an undecided entry uses the shortest option (30 days)', () => {
    const r = run(single('LA', '2026-12-07', '2026-12-30', { entryType: 'undecided' }));
    expect(r.stays[0]).toMatchObject({ days: 24, limitDays: 30, mustLeaveBy: '2027-01-05' });
  });

  it('the stamped date always wins', () => {
    const r = run(single('VN', '2026-11-01', '2026-11-20', { id: 'vn', stampedUntil: '2026-11-15' }));
    expect(r.stays[0]?.mustLeaveBy).toBe('2026-11-15');
    expect(check(r, 'stay-over-vn')?.severity).toBe('critical');
  });

  it('counts down while you are there', () => {
    const data = single('PH', '2027-01-01', '2027-01-30', { id: 'ph' });
    expect(check(run(data, { today: '2027-01-10' }), 'stay-left-ph')).toBeUndefined();
    expect(run(data, { today: '2027-01-17' }).stays[0]).toMatchObject({ daysUsed: 17, daysLeft: 13 });
    expect(check(run(data, { today: '2027-01-17' }), 'stay-left-ph')?.severity).toBe('info');
    expect(check(run(data, { today: '2027-01-25' }), 'stay-left-ph')?.severity).toBe('warn');
    expect(check(run(data, { today: '2027-01-29' }), 'stay-left-ph')?.severity).toBe('critical');
  });
});

describe('rule 1 + 14 — China after 31 Dec 2026', () => {
  it('uses the 30-day exemption for arrivals up to 31 Dec 2026', () => {
    const r = run(single('CN', '2026-12-31', '2027-01-02'));
    expect(r.stays[0]?.regime?.id).toBe('cn-visa-free-30');
  });

  it('falls back to 240-hour transit (with a warning) for later visa-free arrivals', () => {
    const r = run(single('CN', '2027-01-20', '2027-01-21', { id: 'cn' }));
    expect(r.stays[0]).toMatchObject({ fallback: true, limitDays: 10 });
    expect(r.stays[0]?.regime?.id).toBe('cn-transit-240h');
    expect(check(r, 'stay-fallback-cn')?.severity).toBe('warn');
  });

  it('240-hour transit needs an onward ticket to a third country', () => {
    const cn = stay({ id: 'cn', country: 'CN', from: '2027-01-20', to: '2027-01-21', entryType: 'visa-free-transit', entry: { point: 'Xiamen (XMN)' } });
    const ph = stay({ country: 'PH', from: '2027-01-01', to: '2027-01-20' });
    const ok = trip('2027-01-01', '2027-01-21', [ph, cn], [hop('NL', 'PH', '2027-01-01'), hop('PH', 'CN', '2027-01-20'), hop('CN', 'NL', '2027-01-21')]);
    expect(check(run(ok), 'stay-third-country-cn')).toBeUndefined();

    const back = trip('2027-01-01', '2027-01-25', [ph, { ...cn }, stay({ country: 'PH', from: '2027-01-21', to: '2027-01-25' })], [
      hop('PH', 'CN', '2027-01-20'),
      hop('CN', 'PH', '2027-01-21'),
    ]);
    expect(check(run(back), 'stay-third-country-cn')?.severity).toBe('critical');
  });

  it('a stay after the exemption ends gets a re-check a week before', () => {
    const fuzhou = stay({ id: 'foc', country: 'CN', from: '2026-10-25', to: '2026-10-26' });
    const xiamen = stay({ id: 'xmn', country: 'CN', from: '2027-01-20', to: '2027-01-21', entryType: 'visa-free-transit', places: ['Xiamen'] });
    const r = run(trip('2026-10-24', '2027-01-21', [fuzhou, xiamen]));
    const recheck = item(r, 'recheck-cn-visa-free-30-xmn');
    expect(recheck?.remindOn).toBe('2027-01-13');
    expect(recheck?.title).toMatch(/Xiamen: has China extended/);
    expect(recheck?.detail).toMatch(/If it wasn't extended: 240-hour visa-free transit/);
    expect(item(r, 'recheck-cn-visa-free-30-foc')).toBeUndefined();
  });
});
