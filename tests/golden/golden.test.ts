// Golden test from the brief (section 12, phase 2). It runs on the committed,
// date-shifted demo trip everywhere, and also on my-trip.json when that file
// exists locally. Expectations are written relative to the itinerary so that
// no real travel date ends up in the repository.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { rulesContent } from '../../src/rules/content';
import { buildContext } from '../../src/rules/context';
import { runRules } from '../../src/rules/engine';
import { addDays, addMonths, stayEnd, stayStart } from '../../src/rules/itinerary';
import type { PrepItem } from '../../src/rules/types';
import { parseTripFile } from '../../src/trip/io';

const files = ['demo/trip.demo.json', ...(existsSync('my-trip.json') ? ['my-trip.json'] : [])];

describe.each(files)('golden trip: %s', (file) => {
  const { data, rejected } = parseTripFile(JSON.parse(readFileSync(file, 'utf8')));
  const depart = data.meta.depart;
  const today = addDays(depart, -25); // the trip is imported 25 days before leaving
  const r = runRules(buildContext(data, { today }));

  const stays = r.stays.filter((s) => !s.synthetic);
  const stayOf = (cc: string, i = 0) => stays.filter((s) => s.stay.country === cc)[i]!.stay;
  const arrive = (cc: string, i = 0) => stayStart(stayOf(cc, i));
  const leave = (cc: string, i = 0) => stayEnd(stayOf(cc, i));
  const byId = (id: string): PrepItem => {
    const p = r.prep.find((x) => x.id === id);
    expect(p, `missing reminder ${id}`).toBeDefined();
    return p!;
  };
  const booking = (pred: (b: (typeof data.bookings)[number]) => boolean) => data.bookings.find(pred)!;

  it('imports everything', () => expect(rejected).toEqual([]));

  it('stays: China 2, Japan 23, Vietnam 20, Thailand 2, Laos 24, Philippines 22, China 2 — all within limits', () => {
    expect(stays.map((s) => [s.stay.country, s.days])).toEqual([
      ['CN', 2], ['JP', 23], ['VN', 20], ['TH', 2], ['LA', 24], ['PH', 22], ['CN', 2],
    ]);
    for (const s of stays) expect(s.days, s.stay.id).toBeLessThanOrEqual(s.limitDays!);
    expect(r.checks.filter((c) => c.rule === 1 && c.severity === 'critical')).toEqual([]);
  });

  it('passport valid until at least 6 months after leaving the Philippines', () => {
    expect(r.passportRequiredUntil).toBe(addMonths(leave('PH'), 6));
  });

  it('do now: IDP (1949 model) at an ANWB store; insurance; travel clinic; passport with 2 blank pages', () => {
    for (const id of ['pd-idp', 'pd-insurance', 'pd-clinic', 'pd-passport']) {
      const p = byId(id);
      expect(p.remindOn < today, id).toBe(true);
      expect(p.deadline).toBe(addDays(depart, -1));
    }
    expect(byId('pd-idp').title).toMatch(/1949 model/);
    expect(byId('pd-insurance').title).toMatch(/^Insurance: 90-day trip vs maximum days per trip; evacuation, scooter and diving cover/);
    expect(byId('pd-passport').title).toMatch(/with 2 blank pages$/);
  });

  it('by the day before leaving: Visit Japan Web, payment app for China, China arrival card, eSIM for China', () => {
    const cn = stayOf('CN', 0).id;
    for (const id of [`form-jp-vjw-${stayOf('JP').id}`, 'pd-payment-cn', `form-cn-arrival-card-${cn}`, 'pd-esim-cn']) {
      expect(byId(id).deadline, id).toBe(addDays(depart, -1));
    }
  });

  it('T−21 before Vietnam: book the Hanoi → Chiang Rai flight (the onward ticket Vietnam wants to see)', () => {
    const p = byId(`onward-${stayOf('VN').id}`);
    expect(p.remindOn).toBe(addDays(arrive('VN'), -21));
    expect(p.title).toMatch(/Hanoi.*Chiang Rai.*the onward ticket Vietnam wants to see/);
  });

  it('3 days before landing in Hanoi: Vietnam pre-arrival form', () => {
    expect(byId(`form-vn-prearrival-${stayOf('VN').id}`).remindOn).toBe(addDays(arrive('VN'), -3));
  });

  it('T−21 before Thailand and Laos: proof of leaving Thailand; Gibbon Experience and slow boat; e-visa or visa on arrival', () => {
    expect(byId(`onward-${stayOf('TH').id}`)).toMatchObject({ title: 'Proof of leaving Thailand', remindOn: addDays(arrive('TH'), -21) });
    const book = byId(`book-${stayOf('LA').id}`);
    expect(book.remindOn).toBe(addDays(arrive('LA'), -21));
    expect(book.title).toMatch(/Gibbon Experience/);
    expect(book.title).toMatch(/Huay Xai → Luang Prabang/);
    expect(byId(`evisa-decide-${stayOf('LA').id}`)).toMatchObject({
      remindOn: addDays(arrive('LA'), -21),
      title: 'Laos: e-visa or visa on arrival (US dollars + photo)',
    });
  });

  it('a week before Laos: last comfortable day for the e-visa', () => {
    expect(byId(`evisa-last-${stayOf('LA').id}`).remindOn).toBe(addDays(arrive('LA'), -7));
  });

  it('TDAC within 3 days before Thailand; LDIF within 3 days before Laos', () => {
    expect(byId(`form-th-tdac-${stayOf('TH').id}`)).toMatchObject({ remindOn: addDays(arrive('TH'), -3), deadline: arrive('TH') });
    expect(byId(`form-la-ldif-arrival-${stayOf('LA').id}`)).toMatchObject({ remindOn: addDays(arrive('LA'), -3), deadline: arrive('LA') });
  });

  it('06:30 Laos time, 7 days ahead: Laos–China Railway sales for Vang Vieng → Vientiane', () => {
    const train = booking((b) => b.from === 'Vang Vieng' && b.to === 'Vientiane');
    const p = byId(`window-la-lcr-${train.id}`);
    expect(p.at).toEqual({ date: addDays(train.depart!.date, -7), time: '06:30', tz: 'Asia/Vientiane' });
  });

  it('a week before the Thakhek Loop: IDP, licence category, scooter cover', () => {
    const loop = booking((b) => b.type === 'scooter');
    expect(byId(`driving-${loop.id}`)).toMatchObject({
      remindOn: addDays(loop.depart!.date, -7),
      title: 'Thakhek Loop by scooter: IDP, licence category, scooter cover',
    });
  });

  it('3 days before leaving Laos: LDIF departure and eTravel arrival', () => {
    expect(byId(`form-la-ldif-departure-${stayOf('LA').id}`)).toMatchObject({ remindOn: addDays(leave('LA'), -3), deadline: leave('LA') });
    expect(byId(`form-ph-etravel-arrival-${stayOf('PH').id}`)).toMatchObject({ remindOn: addDays(arrive('PH'), -3), deadline: arrive('PH') });
  });

  it('a week before Xiamen: China arrival card, and the visa-exemption re-check if it ends during the trip', () => {
    const xiamen = stayOf('CN', 1);
    expect(byId(`form-cn-arrival-card-${xiamen.id}`).remindOn).toBe(addDays(stayStart(xiamen), -7));
    const end = rulesContent.stayRegimes.find((x) => x.id === 'cn-visa-free-30')!.arrivalUntil!;
    if (end >= depart && end < stayStart(xiamen)) {
      expect(byId(`recheck-cn-visa-free-30-${xiamen.id}`).remindOn).toBe(addDays(stayStart(xiamen), -7));
    }
  });

  it('3 days before leaving the Philippines: eTravel departure', () => {
    expect(byId(`form-ph-etravel-departure-${stayOf('PH').id}`)).toMatchObject({ remindOn: addDays(leave('PH'), -3), deadline: leave('PH') });
  });
});
