import { describe, expect, it } from 'vitest';
import { check, hop, item, run, stay, trip } from './helpers';

describe('rule 2 — passport validity', () => {
  const route = [
    stay({ country: 'JP', from: '2026-10-26', to: '2026-11-17' }),
    stay({ country: 'VN', from: '2026-11-17', to: '2026-12-06' }),
    stay({ country: 'TH', from: '2026-12-06', to: '2026-12-07' }),
    stay({ country: 'LA', from: '2026-12-07', to: '2026-12-30' }),
    stay({ country: 'PH', from: '2026-12-30', to: '2027-01-20' }),
  ];
  const data = trip('2026-10-24', '2027-01-21', route);

  it('takes the latest requirement on the route: 6 months after leaving the Philippines', () => {
    expect(run(data).passportRequiredUntil).toBe('2027-07-20');
  });

  it('per country: Japan whole stay, Vietnam and Thailand 6 months after arrival, Laos 6 months after departure', () => {
    expect(run(trip('2026-10-26', '2026-11-17', [route[0]!])).passportRequiredUntil).toBe('2026-11-17');
    expect(run(trip('2026-11-17', '2026-12-06', [route[1]!])).passportRequiredUntil).toBe('2027-05-17');
    expect(run(trip('2026-12-06', '2026-12-07', [route[2]!])).passportRequiredUntil).toBe('2027-06-06');
    expect(run(trip('2026-12-07', '2026-12-30', [route[3]!])).passportRequiredUntil).toBe('2027-06-30');
  });

  it('warns when the expiry is unknown and is critical when it is too early', () => {
    expect(check(run(data), 'passport-unknown')?.severity).toBe('warn');
    expect(check(run(data, { profile: { flags: {}, passportExpiry: '2027-07-19' } }), 'passport-too-short')?.severity).toBe('critical');
    expect(run(data, { profile: { flags: {}, passportExpiry: '2027-07-20' } }).checks.some((c) => c.id.startsWith('passport'))).toBe(false);
  });

  it('Laos needs 2 blank pages', () => {
    const r = run(data, { profile: { flags: {}, passportExpiry: '2030-01-01', blankPages: 1 } });
    expect(check(r, 'passport-pages')?.severity).toBe('critical');
    expect(item(r, 'pd-passport')?.title).toBe('Passport valid until at least 20 Jul 2027 with 2 blank pages');
  });
});

describe('rule 3 — onward ticket', () => {
  const ph = stay({ id: 'ph', country: 'PH', from: '2026-12-30', to: '2027-01-20' });

  it('is critical when nothing leaves the Philippines', () => {
    expect(check(run(trip('2026-12-30', '2027-01-21', [ph])), 'onward-none-ph')?.severity).toBe('critical');
  });

  it('turns a planned onward flight into a "book this" task three weeks before arrival', () => {
    const r = run(trip('2026-12-30', '2027-01-21', [ph], [hop('PH', 'CN', '2027-01-20', { status: 'planned' })]));
    expect(item(r, 'onward-ph')).toMatchObject({ remindOn: '2026-12-09', deadline: '2026-12-29' });
    expect(item(r, 'onward-ph')?.title).toMatch(/^Book .* the onward ticket Philippines wants to see on 30 Dec 2026$/);
  });

  it('is satisfied by a booked flight', () => {
    const r = run(trip('2026-12-30', '2027-01-21', [ph], [hop('PH', 'CN', '2027-01-20')]));
    expect(r.checks.some((c) => c.id.includes('onward'))).toBe(false);
  });

  it('Vietnam only asks on visa-free entry', () => {
    const vn = stay({ id: 'vn', country: 'VN', from: '2026-11-17', to: '2026-12-06', entryType: 'e-visa' });
    expect(check(run(trip('2026-11-17', '2026-12-06', [vn])), 'onward-none-vn')).toBeUndefined();
  });

  it('Thailand: a bus paid on board is weak proof', () => {
    const th = stay({ id: 'th', country: 'TH', from: '2026-12-06', to: '2026-12-07', exit: { point: 'Chiang Khong — Friendship Bridge IV', mode: 'land' } });
    const la = stay({ country: 'LA', from: '2026-12-07', to: '2026-12-30', entry: { point: 'Friendship Bridge IV — Huay Xai', mode: 'land' } });
    const bus = hop('TH', 'LA', '2026-12-07', { type: 'bus', status: 'planned' });
    delete (bus as { arrive?: unknown }).arrive;
    const r = run(trip('2026-12-06', '2026-12-30', [th, la], [bus]));
    const proof = item(r, 'onward-th');
    expect(proof?.title).toBe('Proof of leaving Thailand');
    expect(proof?.detail).toMatch(/paid on board/);
    expect(proof?.remindOn).toBe('2026-11-15');
  });
});

describe('rule 4 — Laos e-visa ports', () => {
  const at = (point: string, entryType: 'e-visa' | 'undecided', mode: 'land' | 'air' = 'land') =>
    run(trip('2026-12-07', '2026-12-30', [stay({ id: 'la', country: 'LA', from: '2026-12-07', to: '2026-12-30', entryType, entry: { point, mode } })]));

  it('is critical when the e-visa is used at a port not on the list', () => {
    expect(check(at('Nam Phao (Vietnam border)', 'e-visa'), 'evisa-port-la')?.severity).toBe('critical');
    expect(check(at('Nam Phao (Vietnam border)', 'e-visa'), 'evisa-port-la')?.detail).toMatch(/immigration\.gov\.la\/en\/checkpoint/);
  });

  it('accepts the listed ports, and tells Friendship Bridge I from IV', () => {
    expect(check(at('Friendship Bridge IV — Huay Xai (Bokeo)', 'e-visa'), 'evisa-port-la')).toBeUndefined();
    expect(check(at('Wattay International Airport (VTE)', 'e-visa', 'air'), 'evisa-port-la')).toBeUndefined();
    expect(check(at('Friendship Bridge III (Thakhek)', 'e-visa'), 'evisa-port-la')?.severity).toBe('critical');
  });

  it('an undecided entry at an e-visa port gets "decide" (T−21) and "last comfortable day" (T−7) tasks', () => {
    const r = at('Friendship Bridge IV — Huay Xai (Bokeo)', 'undecided');
    expect(item(r, 'evisa-decide-la')).toMatchObject({ remindOn: '2026-11-16', title: 'Laos: e-visa or visa on arrival (US dollars + photo)' });
    expect(item(r, 'evisa-last-la')?.remindOn).toBe('2026-11-30');
  });
});
