import { Temporal } from 'temporal-polyfill';
import type { LocalMoment } from './schema';

/** The instant of a local date + time in its zone; null when the time is unknown. */
export function toInstant(m: LocalMoment): Temporal.Instant | null {
  if (!m.time) return null;
  return Temporal.PlainDateTime.from(`${m.date}T${m.time}`).toZonedDateTime(m.tz).toInstant();
}

/** Minutes between two local moments in (possibly) different zones. */
export function durationMinutes(depart: LocalMoment, arrive: LocalMoment): number | null {
  const a = toInstant(depart);
  const b = toInstant(arrive);
  if (!a || !b) return null;
  return a.until(b, { largestUnit: 'minute' }).minutes;
}

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h} h${m ? ` ${m} min` : ''}` : `${m} min`;
}

/** "Asia/Ho_Chi_Minh" → "Ho Chi Minh". */
export function zoneCity(tz: string): string {
  return (tz.split('/').pop() ?? tz).replace(/_/g, ' ');
}

/** UTC offset of a zone at a local moment, e.g. "UTC+9". */
export function utcOffset(m: LocalMoment): string {
  const zdt = Temporal.PlainDateTime.from(`${m.date}T${m.time ?? '12:00'}`).toZonedDateTime(m.tz);
  const [sign, hh, mm] = [zdt.offset[0], Number(zdt.offset.slice(1, 3)), zdt.offset.slice(4, 6)];
  return `UTC${sign}${hh}${mm !== '00' ? `:${mm}` : ''}`;
}

const dayFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

/** "Tue 17 Nov, 08:55" — the local wall-clock time where it happens. */
export function formatLocal(m: LocalMoment): string {
  const d = Temporal.PlainDate.from(m.date);
  const day = dayFmt.format(new Date(Date.UTC(d.year, d.month - 1, d.day))).replace(',', '');
  return m.time ? `${day}, ${m.time}` : day;
}
