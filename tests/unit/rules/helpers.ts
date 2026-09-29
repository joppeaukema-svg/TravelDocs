import { buildContext } from '../../../src/rules/context';
import { runRules } from '../../../src/rules/engine';
import type { Profile, RuleResult } from '../../../src/rules/types';
import type { TripData } from '../../../src/trip/io';
import { Booking, Stay, TripMeta } from '../../../src/trip/schema';

type StayInput = Partial<Omit<Stay, 'entry' | 'exit'>> & {
  country: string;
  from: string;
  to: string;
  entry?: Partial<Stay['entry']>;
  exit?: Partial<Stay['exit']>;
};

let n = 0;
export function stay(s: StayInput): Stay {
  return Stay.parse({
    id: s.id ?? `s${++n}`,
    entryType: 'visa-free',
    ...s,
    entry: { point: 'Airport', mode: 'air', ...s.entry },
    exit: { point: 'Airport', mode: 'air', ...s.exit },
  });
}

const TZ: Record<string, string> = {
  NL: 'Europe/Amsterdam',
  CN: 'Asia/Shanghai',
  JP: 'Asia/Tokyo',
  VN: 'Asia/Ho_Chi_Minh',
  TH: 'Asia/Bangkok',
  LA: 'Asia/Vientiane',
  PH: 'Asia/Manila',
};

/** A booking between countries; `from`/`to` are country codes, times optional. */
export function hop(
  from: string,
  to: string,
  date: string,
  extra: Partial<Booking> & { arriveDate?: string } = {},
): Booking {
  const { arriveDate, ...rest } = extra;
  return Booking.parse({
    id: `b${++n}`,
    type: 'flight',
    status: 'booked',
    from: `${from} place`,
    to: `${to} place`,
    depart: { date, time: null, tz: TZ[from] },
    arrive: { date: arriveDate ?? date, time: null, tz: TZ[to] },
    ...rest,
  });
}

export function trip(depart: string, ret: string, stays: Stay[], bookings: Booking[] = []): TripData {
  return { meta: TripMeta.parse({ depart, return: ret }), stays, bookings, days: [] };
}

export function run(
  data: TripData,
  opts: { today?: string; profile?: Profile; coverage?: unknown } = {},
): RuleResult {
  return runRules(buildContext(data, { today: opts.today ?? '2026-01-01', ...opts }));
}

export const ids = (r: RuleResult) => ({
  checks: r.checks.map((c) => c.id),
  prep: r.prep.map((p) => p.id),
});

export function check(r: RuleResult, id: string) {
  return r.checks.find((c) => c.id === id);
}

export function item(r: RuleResult, id: string) {
  return r.prep.find((p) => p.id === id);
}
