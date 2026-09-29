import { describe, expect, it } from 'vitest';
import { check, hop, item, run, stay, trip } from './helpers';

describe('rule 5 — arrival and departure forms', () => {
  it('Visit Japan Web: before leaving home when Japan follows right after', () => {
    const cn = stay({ country: 'CN', from: '2026-10-25', to: '2026-10-26' });
    const jp = stay({ id: 'jp', country: 'JP', from: '2026-10-26', to: '2026-11-17' });
    const r = run(trip('2026-10-24', '2026-11-17', [cn, jp], [hop('NL', 'CN', '2026-10-24', { arriveDate: '2026-10-25' }), hop('CN', 'JP', '2026-10-26')]));
    expect(item(r, 'form-jp-vjw-jp')?.deadline).toBe('2026-10-23');
  });

  it('China arrival card: opens a week before, due the day before the flight', () => {
    const cn = stay({ id: 'cn', country: 'CN', from: '2026-10-25', to: '2026-10-26' });
    const r = run(trip('2026-10-24', '2026-10-26', [cn], [hop('NL', 'CN', '2026-10-24', { arriveDate: '2026-10-25' })]));
    expect(item(r, 'form-cn-arrival-card-cn')).toMatchObject({ remindOn: '2026-10-18', deadline: '2026-10-23' });
  });

  it('Vietnam pre-arrival form only when landing at Hanoi, HCMC, Da Nang or Phu Quoc', () => {
    const at = (point: string) =>
      run(trip('2026-11-17', '2026-12-06', [stay({ id: 'vn', country: 'VN', from: '2026-11-17', to: '2026-12-06', entry: { point } })], [hop('JP', 'VN', '2026-11-17')]));
    expect(item(at('Hanoi Noi Bai International Airport (HAN)'), 'form-vn-prearrival-vn')).toMatchObject({ remindOn: '2026-11-14', deadline: '2026-11-16' });
    expect(item(at('Hai Phong Cat Bi (HPH)'), 'form-vn-prearrival-vn')).toBeUndefined();
  });

  it('TDAC and LDIF: within 3 days before arrival, by air and by land', () => {
    const th = stay({ id: 'th', country: 'TH', from: '2026-12-06', to: '2026-12-07' });
    const la = stay({ id: 'la', country: 'LA', from: '2026-12-07', to: '2026-12-30', entry: { point: 'Friendship Bridge IV', mode: 'land' } });
    const r = run(trip('2026-12-06', '2026-12-30', [th, la]));
    expect(item(r, 'form-th-tdac-th')).toMatchObject({ remindOn: '2026-12-03', deadline: '2026-12-06' });
    expect(item(r, 'form-la-ldif-arrival-la')).toMatchObject({ remindOn: '2026-12-04', deadline: '2026-12-07' });
    expect(item(r, 'form-la-ldif-departure-la')).toMatchObject({ remindOn: '2026-12-27', deadline: '2026-12-30' });
  });

  it('eTravel: 72 hours before arrival and before departure', () => {
    const ph = stay({ id: 'ph', country: 'PH', from: '2026-12-30', to: '2027-01-20' });
    const r = run(trip('2026-12-30', '2027-01-21', [ph, stay({ country: 'CN', from: '2027-01-20', to: '2027-01-21' })]));
    expect(item(r, 'form-ph-etravel-arrival-ph')).toMatchObject({ remindOn: '2026-12-27', deadline: '2026-12-30' });
    expect(item(r, 'form-ph-etravel-departure-ph')).toMatchObject({ remindOn: '2027-01-17', deadline: '2027-01-20' });
  });
});

describe('rule 6 — booking windows', () => {
  const la = stay({ id: 'la', country: 'LA', from: '2026-12-07', to: '2026-12-30' });
  const train = (date: string) =>
    hop('LA', 'LA', date, { id: 'train', type: 'transport', status: 'planned', from: 'Vang Vieng', to: 'Vientiane' });

  it('Laos–China Railway: on sale 7 days ahead at 06:30 Laos time, warning in Dec–Feb', () => {
    const r = run(trip('2026-12-07', '2026-12-30', [la], [train('2026-12-20')]));
    const w = item(r, 'window-la-lcr-train');
    expect(w).toMatchObject({ remindOn: '2026-12-13', severity: 'warn', at: { date: '2026-12-13', time: '06:30', tz: 'Asia/Vientiane' } });
    // No alarms between 22:00 and 08:00: it rings the evening before.
    expect(w?.alarm).toEqual({ date: '2026-12-12', time: '21:00', tz: 'Asia/Vientiane' });
  });

  it('no warning outside the busy months, nothing for places off the line', () => {
    const r = run(trip('2026-11-01', '2026-11-30', [stay({ country: 'LA', from: '2026-11-01', to: '2026-11-30' })], [train('2026-11-20')]));
    expect(item(r, 'window-la-lcr-train')?.severity).toBe('info');
    const off = hop('LA', 'LA', '2026-12-20', { id: 'bus', type: 'transport', status: 'planned', from: 'Nong Khiaw', to: 'Vang Vieng' });
    expect(run(trip('2026-12-07', '2026-12-30', [la], [off])).prep.some((p) => p.id.startsWith('window-'))).toBe(false);
  });
});

describe('rule 11 — self-transfer connections', () => {
  it('two flights through a country without a stay there count as an entry', () => {
    const vn = stay({ country: 'VN', from: '2026-11-17', to: '2026-12-06' });
    const la = stay({ country: 'LA', from: '2026-12-06', to: '2026-12-30' });
    const leg1 = hop('VN', 'TH', '2026-12-06', { id: 'leg1', to: 'Bangkok (BKK)' });
    const leg2 = hop('TH', 'LA', '2026-12-06', { id: 'leg2', from: 'Bangkok (BKK)' });
    const r = run(trip('2026-11-17', '2026-12-30', [vn, la], [leg1, leg2]));
    expect(check(r, 'connection-connection-leg1')?.title).toMatch(/Self-transfer in Thailand/);
    // …so Thailand's entry form applies to it.
    expect(item(r, 'form-th-tdac-connection-leg1')).toBeDefined();
  });
});
