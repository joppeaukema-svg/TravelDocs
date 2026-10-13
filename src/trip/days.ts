import type { Holiday } from '../rules/content';
import { addDays, isSynthetic, stayEnd, stayStart } from '../rules/itinerary';
import type { Check, PrepItem } from '../rules/types';
import type { TripMeta, Stay } from './schema';

/**
 * One part of the trip on the Trip screen: a stay in a country, or the days
 * outside any stay (leaving home, coming back, a night in transit).
 */
export interface TripLeg {
  key: string;
  kind: 'stay' | 'departure' | 'return' | 'between';
  country: string;
  stay?: Stay;
  from: string;
  to: string;
  dates: string[];
}

function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/**
 * Every date of the trip, grouped by stay. A travel day belongs to both the
 * stay you leave and the one you arrive in. Dates outside every stay (the
 * flight out, the way home) get a leg of their own, so nothing goes missing.
 */
export function tripLegs(meta: TripMeta, stays: Stay[], countryOn: (date: string) => string | undefined): TripLeg[] {
  const real = stays.filter((s) => !isSynthetic(s)).sort((a, b) => stayStart(a).localeCompare(stayStart(b)));
  const legs: TripLeg[] = real.map((s) => ({
    key: s.id,
    kind: 'stay',
    country: s.country,
    stay: s,
    from: stayStart(s),
    to: stayEnd(s),
    dates: datesBetween(stayStart(s), stayEnd(s)),
  }));

  const first = real[0] ? stayStart(real[0]) : undefined;
  const last = real.length ? real.map(stayEnd).sort().at(-1) : undefined;
  let run: string[] = [];
  const flush = () => {
    if (!run.length) return;
    const from = run[0]!;
    const to = run.at(-1)!;
    const kind = !first || to < first ? 'departure' : last && from > last ? 'return' : 'between';
    legs.push({ key: `${kind}-${from}`, kind, country: countryOn(from) ?? meta.homeCountry, from, to, dates: run });
    run = [];
  };
  for (const d of datesBetween(meta.depart, meta.return)) {
    if (real.some((s) => stayStart(s) <= d && d <= stayEnd(s))) flush();
    else run.push(d);
  }
  flush();
  return legs.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
}

/** Holidays and festivals on a date in a country (and, for local festivals, in a place you stay). */
export function holidaysOn(holidays: Holiday[], country: string, places: string[], date: string): Holiday[] {
  return holidays.filter(
    (h) =>
      h.country === country &&
      h.from <= date &&
      date <= h.to &&
      (!h.placeMatch || places.some((p) => new RegExp(h.placeMatch!, 'i').test(p))),
  );
}

/**
 * The checks that belong to each leg, for the Trip screen. A check on a stay
 * goes to that stay; one on a connection (a self-transfer, or a connection on
 * one ticket) goes to the stay you leave from. Holidays show on their days
 * instead, and checks about the whole trip stay in Checklists.
 */
export function checksByLeg(legs: TripLeg[], checks: Check[], stays: Stay[]): Map<string, Check[]> {
  const out = new Map<string, Check[]>();
  const legOn = (date: string) => legs.find((l) => l.from <= date && date <= l.to);
  for (const c of checks) {
    if (c.rule === 9) continue;
    let leg = c.stayId ? legs.find((l) => l.key === c.stayId) : undefined;
    if (!leg && c.country) {
      const s = c.stayId ? stays.find((x) => x.id === c.stayId) : undefined;
      const date = s ? stayStart(s) : c.dueDate;
      if (date) leg = legOn(date);
    }
    if (!leg) continue;
    out.set(leg.key, [...(out.get(leg.key) ?? []), c]);
  }
  const rank = { critical: 0, warn: 1, info: 2 };
  for (const list of out.values()) list.sort((a, b) => rank[a.severity] - rank[b.severity]);
  return out;
}

/**
 * The must-dos (warnings and critical items from the checklists: mandatory
 * forms, visa steps, onward tickets, ticket sales) on the day to act. Items
 * whose moment came before the trip but are still open then go on the first
 * day; anything due before leaving stays in "Before you leave".
 */
export function tasksByDate(prep: PrepItem[], depart: string, ret: string): Map<string, PrepItem[]> {
  const out = new Map<string, PrepItem[]>();
  for (const p of prep) {
    if (p.severity === 'info') continue;
    if ((p.deadline ?? p.remindOn) < depart) continue;
    const date = p.remindOn < depart ? depart : p.remindOn;
    if (date > ret) continue;
    out.set(date, [...(out.get(date) ?? []), p]);
  }
  return out;
}
