import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { PrepStateRow } from '../../src/db/db';
import { allCountries } from '../../src/content';
import { buildPushSchedule } from '../../src/push/schedule';
import { buildContext } from '../../src/rules/context';
import { runRules } from '../../src/rules/engine';
import type { PrepItem } from '../../src/rules/types';
import { parseTripFile } from '../../src/trip/io';

const item = (id: string, x: Partial<PrepItem> = {}): PrepItem => ({
  id,
  group: 'la',
  country: 'LA',
  moment: 't7',
  title: `Private title ${id} — Huay Xai guesthouse`,
  severity: 'warn',
  remindOn: '2026-10-20',
  at: { date: '2026-10-20', time: '09:00', tz: 'Asia/Bangkok' },
  alarm: { date: '2026-10-20', time: '09:00', tz: 'Asia/Bangkok' },
  sourceIds: [],
  ...x,
});
const names = (c: string) => ({ LA: 'Laos', TH: 'Thailand' })[c] ?? c;
const now = new Date('2026-10-01T00:00:00Z');

describe('push schedule', () => {
  it('groups per checklist and alarm time, counting open items only', () => {
    const states = new Map<string, PrepStateRow>([
      ['c', { id: 'c', status: 'done', updatedAt: '' }],
      ['d', { id: 'd', status: 'snoozed', snoozedUntil: '2026-10-22', updatedAt: '' }],
    ]);
    const s = buildPushSchedule(
      [
        item('a'),
        item('b'),
        item('c'),
        item('d'),
        item('e', { moment: 'exit', alarm: { date: '2026-10-25', time: '21:00', tz: 'Asia/Vientiane' } }),
        item('f', { group: 'predeparture', country: 'NL', alarm: { date: '2026-10-10', time: '09:00', tz: 'Europe/Amsterdam' } }),
        item('past', { alarm: { date: '2026-09-01', time: '09:00', tz: 'Asia/Bangkok' } }),
      ],
      states,
      ['th', 'la'],
      names,
      now,
    );
    expect(s).toEqual([
      { at: '2026-10-10T07:00:00Z', title: 'Before you leave: 1 task due', url: '#/checklists/predeparture' },
      { at: '2026-10-20T02:00:00Z', title: 'Laos prep: 2 tasks due', url: '#/checklists/n/1' },
      { at: '2026-10-22T02:00:00Z', title: 'Laos prep: 1 task due', url: '#/checklists/n/1' },
      { at: '2026-10-25T14:00:00Z', title: 'Leaving Laos: 1 task', url: '#/checklists/n/1' },
    ]);
  });

  it('never sends booking titles, places or stay ids for the demo trip', () => {
    const data = parseTripFile(JSON.parse(readFileSync('demo/trip.demo.json', 'utf8'))).data;
    const r = runRules(buildContext(data, { today: data.meta.depart }));
    const s = buildPushSchedule(r.prep, new Map(), r.stays.map((x) => x.stay.id), (c) => allCountries().find((x) => x.country === c)?.name ?? c, new Date(`${data.meta.depart}T00:00:00Z`));
    expect(s.length).toBeGreaterThan(5);
    const places = [...data.stays.flatMap((x) => x.places), ...data.bookings.flatMap((b) => [b.title, b.from, b.to, b.provider])].filter(
      (x): x is string => !!x && x.length > 3,
    );
    const country = allCountries().map((c) => c.name).join('|');
    const shape = new RegExp(`^(Before you leave: \\d+ tasks? due|Leaving (${country}): \\d+ tasks?|(${country}) prep: \\d+ tasks? due)$`);
    for (const e of s) {
      expect(e.title).toMatch(shape);
      expect(e.url).toMatch(/^#\/checklists\/(predeparture|n\/\d+)$/);
      for (const p of places) expect(e.title).not.toContain(p);
    }
    // Quiet hours: nothing between 22:00 and 08:00 where the traveller will be.
    for (const p of r.prep) {
      const local = Number(p.alarm.time.slice(0, 2));
      expect(local >= 8 && local < 22, `${p.id} ${p.alarm.time}`).toBe(true);
    }
  });
});
