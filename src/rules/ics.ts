import { Temporal } from 'temporal-polyfill';
import { BOOKING_TYPE_LABELS, bookingLabel, type Booking } from '../trip/schema';
import { addDays } from './itinerary';
import type { PrepItem, ZonedMoment } from './types';

/**
 * iCalendar export. Times are written in UTC, computed from the local time in
 * the zone the traveller will be in, so every calendar app shows them right.
 * UIDs are stable per item: re-importing updates events in apps that match
 * on UID (Google Calendar); see the README for replacing an import on iPhone.
 */
export interface IcsOptions {
  appUrl?: string;
  now?: Date;
  countryNames?: Map<string, string>;
  defaultTime?: string;
}

const DOMAIN = 'travel-companion';
/** Moments that get one calendar event each; the rest are grouped per stay and day. */
const OWN_EVENT = new Set(['form', 'window', 'recheck', 'driving', 'stay', 't1']);

function utc(m: ZonedMoment): string {
  const instant = Temporal.PlainDateTime.from(`${m.date}T${m.time}`).toZonedDateTime(m.tz).toInstant();
  return instant.toString({ smallestUnit: 'second' }).replace(/[-:]/g, '');
}

function stamp(d: Date): string {
  return d.toISOString().replace(/\.\d{3}/, '').replace(/[-:]/g, '');
}

export function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Folds lines at 75 octets (RFC 5545), never splitting a UTF-8 character. */
export function fold(line: string): string {
  const enc = new TextEncoder();
  const out: string[] = [];
  let current = '';
  let bytes = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    const limit = out.length ? 74 : 75;
    if (bytes + n > limit) {
      out.push(current);
      current = '';
      bytes = 0;
    }
    current += ch;
    bytes += n;
  }
  out.push(current);
  return out.join('\r\n ');
}

/** Relative alarm trigger, e.g. -PT9H30M. */
function trigger(at: ZonedMoment, alarm: ZonedMoment): string {
  const toInstant = (m: ZonedMoment) => Temporal.PlainDateTime.from(`${m.date}T${m.time}`).toZonedDateTime(m.tz).toInstant();
  const minutes = toInstant(at).until(toInstant(alarm), { largestUnit: 'minute' }).minutes;
  if (minutes === 0) return 'PT0M';
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${minutes < 0 ? '-' : ''}PT${h ? `${h}H` : ''}${m ? `${m}M` : ''}`;
}

interface Event {
  uid: string;
  start: ZonedMoment;
  alarm: ZonedMoment;
  summary: string;
  description: string;
  url?: string;
}

function eventLines(e: Event, now: Date): string[] {
  return [
    'BEGIN:VEVENT',
    `UID:${e.uid}@${DOMAIN}`,
    `DTSTAMP:${stamp(now)}`,
    `DTSTART:${utc(e.start)}`,
    'DURATION:PT15M',
    `SUMMARY:${escapeText(e.summary)}`,
    `DESCRIPTION:${escapeText(e.description)}`,
    ...(e.url ? [`URL:${e.url}`] : []),
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escapeText(e.summary)}`,
    `TRIGGER:${trigger(e.start, e.alarm)}`,
    'END:VALARM',
    'END:VEVENT',
  ];
}

export function prepEvents(prep: PrepItem[], opts: IcsOptions = {}): Event[] {
  const name = (c: string, group: string) =>
    group === 'predeparture' ? 'Before you leave' : (opts.countryNames?.get(c) ?? c);
  const link = (group: string) => (opts.appUrl ? `${opts.appUrl}#/checklists/${group}` : undefined);
  const events: Event[] = [];
  const groups = new Map<string, PrepItem[]>();

  for (const p of prep) {
    if (OWN_EVENT.has(p.moment)) {
      events.push({
        uid: p.id,
        start: p.at,
        alarm: p.alarm,
        summary: p.title,
        description: [p.detail, p.deadline ? `Deadline: ${p.deadline}` : '', p.url ?? ''].filter(Boolean).join('\n'),
        ...(link(p.group) ? { url: link(p.group)! } : {}),
      });
    } else {
      const key = `${p.group}|${p.moment}|${p.remindOn}|${p.at.time}`;
      groups.set(key, [...(groups.get(key) ?? []), p]);
    }
    // A reminder the day before the deadline, for tasks that matter.
    if (p.severity !== 'info' && p.deadline && addDays(p.deadline, -1) > p.remindOn) {
      const at: ZonedMoment = { date: addDays(p.deadline, -1), time: opts.defaultTime ?? '09:00', tz: p.at.tz };
      events.push({
        uid: `${p.id}-due`,
        start: at,
        alarm: at,
        summary: `Due tomorrow: ${p.title}`,
        description: p.detail ?? '',
        ...(link(p.group) ? { url: link(p.group)! } : {}),
      });
    }
  }

  for (const items of groups.values()) {
    const first = items[0]!;
    const label = name(first.country, first.group);
    events.push({
      uid: `prep-${first.group}-${first.moment}-${first.remindOn}`,
      start: first.at,
      alarm: first.alarm,
      summary: items.length === 1 ? first.title : `${label} prep: ${items.length} tasks`,
      description: items.map((p) => `• ${p.title}${p.deadline ? ` (by ${p.deadline})` : ''}`).join('\n'),
      ...(link(first.group) ? { url: link(first.group)! } : {}),
    });
  }
  return events;
}

function bookingLines(b: Booking, now: Date): string[] {
  if (!b.depart || b.status === 'idea') return [];
  const summary = `${BOOKING_TYPE_LABELS[b.type]}: ${bookingLabel(b)}${b.status === 'planned' ? ' (planned)' : ''}`;
  const description = [b.provider, b.confirmation ? `Confirmation: ${b.confirmation}` : '', b.addressLocal ?? b.address ?? '']
    .filter(Boolean)
    .join('\n');
  const head = ['BEGIN:VEVENT', `UID:booking-${b.id}@${DOMAIN}`, `DTSTAMP:${stamp(now)}`];
  let when: string[];
  if (b.depart.time) {
    const start = { date: b.depart.date, time: b.depart.time, tz: b.depart.tz };
    const end = b.arrive?.time ? { date: b.arrive.date, time: b.arrive.time, tz: b.arrive.tz } : null;
    when = [`DTSTART:${utc(start)}`, end ? `DTEND:${utc(end)}` : 'DURATION:PT1H'];
  } else {
    const last = b.arrive?.date && b.arrive.date > b.depart.date ? b.arrive.date : b.depart.date;
    when = [`DTSTART;VALUE=DATE:${b.depart.date.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${addDays(last, 1).replace(/-/g, '')}`];
  }
  return [...head, ...when, `SUMMARY:${escapeText(summary)}`, ...(description ? [`DESCRIPTION:${escapeText(description)}`] : []), 'TRANSP:TRANSPARENT', 'END:VEVENT'];
}

export function buildIcs(prep: PrepItem[], bookings: Booking[], opts: IcsOptions = {}): string {
  const now = opts.now ?? new Date();
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Travel Companion//Trip prep//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Trip prep',
    ...prepEvents(prep, opts).flatMap((e) => eventLines(e, now)),
    ...bookings.flatMap((b) => bookingLines(b, now)),
    'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}
