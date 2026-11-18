import type { Stay } from './schema';

/** Where a country is on the trip, seen from today. */
export type RouteStatus = 'here' | 'upcoming' | 'past';

export interface Route {
  /** The countries of the stays: where you are, then the ones to come, then the ones you've been to (both in trip order). */
  order: string[];
  status: (country: string) => RouteStatus | undefined;
}

const start = (s: Stay) => s.actualFrom ?? s.from;
const end = (s: Stay) => s.actualTo ?? s.to;
const RANK: Record<RouteStatus, number> = { here: 0, upcoming: 1, past: 2 };

/**
 * The countries of a trip in the order to show them: the one you're in first, the past ones last.
 * A country you'll be back in counts as to come. On a travel day the country you left is past once
 * `here` is the next one.
 */
export function routeOrder(stays: Stay[], today: string, here: string | null): Route {
  const next = new Map<string, string>();
  const last = new Map<string, string>();
  for (const s of stays) {
    if (end(s) > today || start(s) >= today) {
      const n = next.get(s.country);
      if (!n || start(s) < n) next.set(s.country, start(s));
    }
    const l = last.get(s.country);
    if (!l || end(s) > l) last.set(s.country, end(s));
  }
  const status = new Map<string, RouteStatus>();
  if (here) status.set(here, 'here');
  for (const c of last.keys()) if (c !== here) status.set(c, next.has(c) ? 'upcoming' : 'past');
  const when = (c: string) => (status.get(c) === 'upcoming' ? next.get(c)! : (last.get(c) ?? ''));
  const order = [...status.keys()].sort((a, b) => RANK[status.get(a)!] - RANK[status.get(b)!] || when(a).localeCompare(when(b)));
  return { order, status: (c) => status.get(c) };
}

/**
 * Splits things that belong to one or more countries into the ones ahead (where you are, then
 * to come, then off the route, as they were) and the past ones, each in route order.
 */
export function splitByRoute<T>(items: T[], countriesOf: (t: T) => string[], route: Route): { ahead: T[]; past: T[] } {
  const OFF = 1000;
  const PAST = 2000;
  const rankOf = (c: string) => {
    const s = route.status(c);
    const i = route.order.indexOf(c);
    return s === undefined ? OFF : s === 'past' ? PAST + i : i;
  };
  const ranked = items.map((t, i) => {
    const ranks = countriesOf(t).map(rankOf);
    return { t, i, r: ranks.length ? Math.min(...ranks) : OFF };
  });
  ranked.sort((a, b) => a.r - b.r || a.i - b.i);
  return { ahead: ranked.filter((x) => x.r < PAST).map((x) => x.t), past: ranked.filter((x) => x.r >= PAST).map((x) => x.t) };
}
