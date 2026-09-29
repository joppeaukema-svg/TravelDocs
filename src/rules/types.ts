import type { CoverageSummary } from '../profile/insurance';
import type { Booking, Day, Stay, TripMeta } from '../trip/schema';
import type { ProfileFlag, RulesContent, StayRegime } from './content';

export type Severity = 'info' | 'warn' | 'critical';

/** A state the traveller should know about, linked to its sources. */
export interface Check {
  id: string;
  rule: number;
  severity: Severity;
  title: string;
  detail: string;
  dueDate?: string;
  country?: string;
  stayId?: string;
  sourceIds: string[];
}

export type Moment =
  | 'predeparture'
  | 't21'
  | 't7'
  | 'form'
  | 'window'
  | 't1'
  | 'exit'
  | 'recheck'
  | 'driving'
  | 'stay';

/** A local wall-clock moment in an IANA zone. */
export interface ZonedMoment {
  date: string;
  time: string;
  tz: string;
}

/** A dated task. `group` is the checklist it belongs to: a stay id or "predeparture". */
export interface PrepItem {
  id: string;
  rule?: number;
  group: string;
  country: string;
  moment: Moment;
  title: string;
  detail?: string;
  severity: Severity;
  /** When to act (the prep moment); items already past on import show as "do now". */
  remindOn: string;
  /** Last day it can be done, if there is one. */
  deadline?: string;
  /** Event time for the calendar, in the zone the traveller will be in. */
  at: ZonedMoment;
  /** Alarm time: `at`, moved out of quiet hours. */
  alarm: ZonedMoment;
  url?: string;
  sourceIds: string[];
}

export interface CountryInfo {
  code: string;
  name: string;
  timeZone: string;
  currency: string;
  emergency: string[];
}

export interface Profile {
  flags: Partial<Record<ProfileFlag, boolean>>;
  blankPages?: number;
  passportExpiry?: string;
}

export interface RuleContext {
  trip: TripMeta;
  stays: Stay[];
  bookings: Booking[];
  days: Day[];
  profile: Profile;
  coverage: CoverageSummary;
  today: string;
  rules: RulesContent;
  countries: Map<string, CountryInfo>;
  /** Content facts, for the freshness rule. */
  facts?: { id: string; title: string; topic: string; verifiedAt: string }[];
}

export interface StayStatus {
  stay: Stay;
  synthetic: boolean;
  regime?: StayRegime;
  /** True when the entry type had no regime and a fallback (e.g. transit) was used. */
  fallback: boolean;
  days: number;
  limitDays?: number;
  mustLeaveBy?: string;
  daysUsed?: number;
  daysLeft?: number;
}

export interface RuleResult {
  checks: Check[];
  prep: PrepItem[];
  stays: StayStatus[];
  passportRequiredUntil?: string;
}
