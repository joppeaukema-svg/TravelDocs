import { describe, expect, it } from 'vitest';
import { check, hop, item, run, stay, trip } from './helpers';

describe('rule 2 — passport validity', () => {
  const route = [
    stay({ country: 'JP', from: '2026-11-30', to: '2026-12-22' }),
    stay({ country: 'VN', from: '2026-12-22', to: '2027-01-10' }),
    stay({ country: 'TH', from: '2027-01-10', to: '2027-01-11' }),
    stay({ country: 'LA', from: '2027-01-11', to: '2027-02-03' }),
    stay({ country: 'PH', from: '2027-02-03', to: '2027-02-24' }),
  ];
  const data = trip('2026-11-28', '2027-02-25', route);

  it('takes the latest requirement on the route: 6 months after leaving the Philippines', () => {
    expect(run(data).passportRequiredUntil).toBe('2027-08-24');
  });

  it('per country: Japan whole stay, Vietnam and Thailand 6 months after arrival, Laos 6 months after departure', () => {
    expect(run(trip('2026-11-30', '2026-12-22', [route[0]!])).passportRequiredUntil).toBe('2026-12-22');
    expect(run(trip('2026-12-22', '2027-01-10', [route[1]!])).passportRequiredUntil).toBe('2027-06-22');
    expect(run(trip('2027-01-10', '2027-01-11', [route[2]!])).passportRequiredUntil).toBe('2027-07-10');
    expect(run(trip('2027-01-11', '2027-02-03', [route[3]!])).passportRequiredUntil).toBe('2027-08-03');
  });

  it('warns when the expiry is unknown and is critical when it is too early', () => {
    expect(check(run(data), 'passport-unknown')?.severity).toBe('warn');
    expect(check(run(data, { profile: { flags: {}, passportExpiry: '2027-08-23' } }), 'passport-too-short')?.severity).toBe('critical');
    expect(run(data, { profile: { flags: {}, passportExpiry: '2027-08-24' } }).checks.some((c) => c.id.startsWith('passport'))).toBe(false);
  });

  it('Laos needs 2 blank pages', () => {
    const r = run(data, { profile: { flags: {}, passportExpiry: '2030-02-05', blankPages: 1 } });
    expect(check(r, 'passport-pages')?.severity).toBe('critical');
    expect(item(r, 'pd-passport')?.title).toBe('Passport valid until at least 24 Aug 2027 with 2 blank pages');
  });
});

describe('rule 3 — onward ticket', () => {
  const ph = stay({ id: 'ph', country: 'PH', from: '2027-02-03', to: '2027-02-24' });

  it('is critical when nothing leaves the Philippines', () => {
    expect(check(run(trip('2027-02-03', '2027-02-25', [ph])), 'onward-none-ph')?.severity).toBe('critical');
  });

  it('turns a planned onward flight into a "book this" task three weeks before arrival', () => {
    const r = run(trip('2027-02-03', '2027-02-25', [ph], [hop('PH', 'CN', '2027-02-24', { status: 'planned' })]));
    expect(item(r, 'onward-ph')).toMatchObject({ remindOn: '2027-01-13', deadline: '2027-02-02' });
    expect(item(r, 'onward-ph')?.title).toMatch(/^Book .* the onward ticket Philippines wants to see on 3 Feb 2027$/);
  });

  it('is satisfied by a booked flight', () => {
    const r = run(trip('2027-02-03', '2027-02-25', [ph], [hop('PH', 'CN', '2027-02-24')]));
    expect(r.checks.some((c) => c.id.includes('onward'))).toBe(false);
  });

  it('Vietnam only asks on visa-free entry', () => {
    const vn = stay({ id: 'vn', country: 'VN', from: '2026-12-22', to: '2027-01-10', entryType: 'e-visa' });
    expect(check(run(trip('2026-12-22', '2027-01-10', [vn])), 'onward-none-vn')).toBeUndefined();
  });

  it('Thailand: a bus paid on board is weak proof', () => {
    const th = stay({ id: 'th', country: 'TH', from: '2027-01-10', to: '2027-01-11', exit: { point: 'Chiang Khong — Friendship Bridge IV', mode: 'land' } });
    const la = stay({ country: 'LA', from: '2027-01-11', to: '2027-02-03', entry: { point: 'Friendship Bridge IV — Huay Xai', mode: 'land' } });
    const bus = hop('TH', 'LA', '2027-01-11', { type: 'bus', status: 'planned' });
    delete (bus as { arrive?: unknown }).arrive;
    const r = run(trip('2027-01-10', '2027-02-03', [th, la], [bus]));
    const proof = item(r, 'onward-th');
    expect(proof?.title).toBe('Proof of leaving Thailand');
    expect(proof?.detail).toMatch(/paid on board/);
    expect(proof?.remindOn).toBe('2026-12-20');
  });
});

describe('rule 4 — Laos e-visa ports', () => {
  const at = (point: string, entryType: 'e-visa' | 'undecided', mode: 'land' | 'air' = 'land') =>
    run(trip('2027-01-11', '2027-02-03', [stay({ id: 'la', country: 'LA', from: '2027-01-11', to: '2027-02-03', entryType, entry: { point, mode } })]));

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
    expect(item(r, 'evisa-decide-la')).toMatchObject({ remindOn: '2026-12-21', title: 'Laos: e-visa or visa on arrival (US dollars + photo)' });
    expect(item(r, 'evisa-last-la')?.remindOn).toBe('2027-01-04');
  });
});
