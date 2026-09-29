import { describe, expect, it } from 'vitest';
import { buildIcs, escapeText, fold } from '../../../src/rules/ics';
import { hop, run, stay, trip } from './helpers';

function sample() {
  const la = stay({ id: 'la', country: 'LA', from: '2026-12-07', to: '2026-12-30', entry: { point: 'Friendship Bridge IV', mode: 'land' } });
  const train = hop('LA', 'LA', '2026-12-20', { id: 'train', type: 'transport', status: 'planned', from: 'Vang Vieng', to: 'Vientiane' });
  const flight = hop('LA', 'PH', '2026-12-30', { id: 'out' });
  flight.depart!.time = '10:00';
  flight.arrive!.time = '14:30';
  const data = trip('2026-12-07', '2026-12-30', [la], [train, flight]);
  return { data, result: run(data) };
}

const events = (ics: string) => ics.split('BEGIN:VEVENT').slice(1);

describe('calendar export', () => {
  it('writes times in UTC from the local time where you will be, with alarms out of quiet hours', () => {
    const { data, result } = sample();
    const ics = buildIcs(result.prep, data.bookings, { now: new Date('2026-10-01T00:00:00Z') });
    const lcr = events(ics).find((e) => e.includes('UID:window-la-lcr-train@'))!;
    // 06:30 in Vientiane (UTC+7) is 23:30 UTC the day before; the alarm rings at 21:00 the evening before.
    expect(lcr).toContain('DTSTART:20261212T233000Z');
    expect(lcr).toContain('TRIGGER:-PT9H30M');
    const flight = events(ics).find((e) => e.includes('UID:booking-out@'))!;
    expect(flight).toContain('DTSTART:20261230T030000Z');
    expect(flight).toContain('DTEND:20261230T063000Z');
  });

  it('uses stable UIDs, so a new export replaces the old events', () => {
    const { data, result } = sample();
    const uids = (ics: string) => [...ics.matchAll(/^UID:(.+)$/gm)].map((m) => m[1]).sort();
    const a = buildIcs(result.prep, data.bookings, { now: new Date('2026-10-01T00:00:00Z') });
    const b = buildIcs(sample().result.prep, data.bookings, { now: new Date('2026-11-01T00:00:00Z') });
    expect(uids(a)).toEqual(uids(b));
    expect(new Set(uids(a)).size).toBe(uids(a).length);
  });

  it('adds a "due tomorrow" reminder before important deadlines, and links to the checklist', () => {
    const { data, result } = sample();
    const ics = buildIcs(result.prep, data.bookings, { appUrl: 'https://example.org/app/' });
    expect(ics).toContain('UID:form-la-ldif-arrival-la-due@');
    expect(ics).toMatch(/URL:https:\/\/example.org\/app\/#\/checklists\/la/);
  });

  it('follows the format: CRLF, folded lines of at most 75 octets, escaped text', () => {
    const { data, result } = sample();
    const ics = buildIcs(result.prep, data.bookings);
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    for (const line of ics.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(escapeText('a, b; c\\d\ne')).toBe('a\\, b\\; c\\\\d\\ne');
    expect(fold('x'.repeat(80))).toBe(`${'x'.repeat(75)}\r\n ${'x'.repeat(5)}`);
    expect(fold('é'.repeat(40)).split('\r\n')[0]).toBe('é'.repeat(37));
  });
});
