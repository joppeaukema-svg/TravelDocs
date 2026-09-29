import { describe, expect, it } from 'vitest';
import { check, hop, item, run, stay, trip } from './helpers';

describe('rule 5 — arrival and departure forms', () => {
  it('Visit Japan Web: before leaving home when Japan follows right after', () => {
    const cn = stay({ country: 'CN', from: '2026-11-08', to: '2026-11-09' });
    const jp = stay({ id: 'jp', country: 'JP', from: '2026-11-09', to: '2026-12-01' });
    const r = run(trip('2026-11-07', '2026-12-01', [cn, jp], [hop('NL', 'CN', '2026-11-07', { arriveDate: '2026-11-08' }), hop('CN', 'JP', '2026-11-09')]));
    expect(item(r, 'form-jp-vjw-jp')?.deadline).toBe('2026-11-06');
  });

  it('China arrival card: opens a week before, due the day before the flight', () => {
    const cn = stay({ id: 'cn', country: 'CN', from: '2026-11-08', to: '2026-11-09' });
    const r = run(trip('2026-11-07', '2026-11-09', [cn], [hop('NL', 'CN', '2026-11-07', { arriveDate: '2026-11-08' })]));
    expect(item(r, 'form-cn-arrival-card-cn')).toMatchObject({ remindOn: '2026-11-01', deadline: '2026-11-06' });
  });

  it('Vietnam pre-arrival form only when landing at Hanoi, HCMC, Da Nang or Phu Quoc', () => {
    const at = (point: string) =>
      run(trip('2026-12-01', '2026-12-20', [stay({ id: 'vn', country: 'VN', from: '2026-12-01', to: '2026-12-20', entry: { point } })], [hop('JP', 'VN', '2026-12-01')]));
    expect(item(at('Hanoi Noi Bai International Airport (HAN)'), 'form-vn-prearrival-vn')).toMatchObject({ remindOn: '2026-11-28', deadline: '2026-11-30' });
    expect(item(at('Hai Phong Cat Bi (HPH)'), 'form-vn-prearrival-vn')).toBeUndefined();
  });

  it('TDAC and LDIF: within 3 days before arrival, by air and by land', () => {
    const th = stay({ id: 'th', country: 'TH', from: '2026-12-20', to: '2026-12-21' });
    const la = stay({ id: 'la', country: 'LA', from: '2026-12-21', to: '2027-01-13', entry: { point: 'Friendship Bridge IV', mode: 'land' } });
    const r = run(trip('2026-12-20', '2027-01-13', [th, la]));
    expect(item(r, 'form-th-tdac-th')).toMatchObject({ remindOn: '2026-12-17', deadline: '2026-12-20' });
    expect(item(r, 'form-la-ldif-arrival-la')).toMatchObject({ remindOn: '2026-12-18', deadline: '2026-12-21' });
    expect(item(r, 'form-la-ldif-departure-la')).toMatchObject({ remindOn: '2027-01-10', deadline: '2027-01-13' });
  });

  it('eTravel: 72 hours before arrival and before departure', () => {
    const ph = stay({ id: 'ph', country: 'PH', from: '2027-01-13', to: '2027-02-03' });
    const r = run(trip('2027-01-13', '2027-02-04', [ph, stay({ country: 'CN', from: '2027-02-03', to: '2027-02-04' })]));
    expect(item(r, 'form-ph-etravel-arrival-ph')).toMatchObject({ remindOn: '2027-01-10', deadline: '2027-01-13' });
    expect(item(r, 'form-ph-etravel-departure-ph')).toMatchObject({ remindOn: '2027-01-31', deadline: '2027-02-03' });
  });
});

describe('rule 6 — booking windows', () => {
  const la = stay({ id: 'la', country: 'LA', from: '2026-12-21', to: '2027-01-13' });
  const train = (date: string) =>
    hop('LA', 'LA', date, { id: 'train', type: 'transport', status: 'planned', from: 'Vang Vieng', to: 'Vientiane' });

  it('Laos–China Railway: on sale 7 days ahead at 06:30 Laos time, warning in Dec–Feb', () => {
    const r = run(trip('2026-12-21', '2027-01-13', [la], [train('2027-01-03')]));
    const w = item(r, 'window-la-lcr-train');
    expect(w).toMatchObject({ remindOn: '2026-12-27', severity: 'warn', at: { date: '2026-12-27', time: '06:30', tz: 'Asia/Vientiane' } });
    // No alarms between 22:00 and 08:00: it rings the evening before.
    expect(w?.alarm).toEqual({ date: '2026-12-26', time: '21:00', tz: 'Asia/Vientiane' });
  });

  it('no warning outside the busy months, nothing for places off the line', () => {
    const r = run(trip('2026-11-01', '2026-11-30', [stay({ country: 'LA', from: '2026-11-01', to: '2026-11-30' })], [train('2026-11-20')]));
    expect(item(r, 'window-la-lcr-train')?.severity).toBe('info');
    const off = hop('LA', 'LA', '2027-01-03', { id: 'bus', type: 'transport', status: 'planned', from: 'Nong Khiaw', to: 'Vang Vieng' });
    expect(run(trip('2026-12-21', '2027-01-13', [la], [off])).prep.some((p) => p.id.startsWith('window-'))).toBe(false);
  });
});

describe('rule 11 — self-transfer connections', () => {
  it('two flights through a country without a stay there count as an entry', () => {
    const vn = stay({ country: 'VN', from: '2026-12-01', to: '2026-12-20' });
    const la = stay({ country: 'LA', from: '2026-12-20', to: '2027-01-13' });
    const leg1 = hop('VN', 'TH', '2026-12-20', { id: 'leg1', to: 'Bangkok (BKK)' });
    const leg2 = hop('TH', 'LA', '2026-12-20', { id: 'leg2', from: 'Bangkok (BKK)' });
    const r = run(trip('2026-12-01', '2027-01-13', [vn, la], [leg1, leg2]));
    expect(check(r, 'connection-connection-leg1')?.title).toMatch(/Self-transfer in Thailand/);
    // …so Thailand's entry form applies to it.
    expect(item(r, 'form-th-tdac-connection-leg1')).toBeDefined();
  });
});
