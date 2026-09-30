import { Temporal } from 'temporal-polyfill';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Moves every calendar date (YYYY-MM-DD) in a JSON value by `days`, dropping the given keys. */
export function shiftDates(value: unknown, days: number, drop: ReadonlySet<string> = new Set()): unknown {
  if (typeof value === 'string' && DATE.test(value)) return Temporal.PlainDate.from(value).add({ days }).toString();
  if (Array.isArray(value)) return value.map((v) => shiftDates(v, days, drop));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([k]) => !drop.has(k))
        .map(([k, v]) => [k, shiftDates(v, days, drop)]),
    );
  }
  return value;
}
