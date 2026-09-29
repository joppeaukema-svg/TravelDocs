import { Temporal } from 'temporal-polyfill';

const dateFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** "2026-10-24" → "24 Oct 2026" (a calendar date, no time-zone shifting). */
export function formatDate(isoDate: string): string {
  const d = Temporal.PlainDate.from(isoDate);
  return dateFmt.format(new Date(Date.UTC(d.year, d.month - 1, d.day)));
}

/** An instant shown in the phone's current time zone. */
export function formatDateTime(isoInstant: string): string {
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(isoInstant));
}

export function clock(timeZone: string, at: Date): { time: string; day: string } {
  const time = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit' }).format(at);
  const day = new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short', day: 'numeric', month: 'short' }).format(at);
  return { time, day };
}

export function todayIn(timeZone: string): string {
  return Temporal.Now.plainDateISO(timeZone).toString();
}

/** Whole days from `from` to `to` (both "YYYY-MM-DD"); negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Temporal.PlainDate.from(from).until(Temporal.PlainDate.from(to), { largestUnit: 'day' }).days;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${Math.abs(n) === 1 ? one : many}`;
}
