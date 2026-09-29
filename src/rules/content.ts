import { z } from 'zod';
import { countryCode, isoDate } from '../content/schema';
import { BookingType, clockTime, EntryType, TravelMode } from '../trip/schema';
import raw from '../../content/rules.json';

/** A regular expression written as a string in the content (case-insensitive). */
const pattern = z.string().refine((s) => {
  try {
    new RegExp(s, 'i');
    return true;
  } catch {
    return false;
  }
}, 'Invalid regular expression');

const sourceIds = z.array(z.string()).min(1, 'Every rule needs at least one source');

export const RuleSource = z.object({
  title: z.string().min(1),
  url: z.url({ protocol: /^https$/ }),
  verifiedAt: isoDate,
  unverified: z.boolean().optional(),
});
export type RuleSource = z.infer<typeof RuleSource>;

/** Rule 1: how long an entry type allows you to stay. */
export const StayRegime = z.object({
  id: z.string(),
  country: countryCode,
  title: z.string(),
  entryTypes: z.array(EntryType).min(1),
  maxDays: z.number().int().positive().optional(),
  maxHours: z.number().int().positive().optional(),
  /** The regime applies to arrivals on or after / on or before these dates. */
  arrivalFrom: isoDate.optional(),
  arrivalUntil: isoDate.optional(),
  extendable: z.boolean().default(false),
  requiresThirdCountryOnward: z.boolean().default(false),
  ports: z.array(pattern).optional(),
  suggestWhenTooLong: z.string().optional(),
  note: z.string().optional(),
  sourceIds,
});
export type StayRegime = z.infer<typeof StayRegime>;

/** Rule 2. basis "stay": valid for the whole stay; otherwise N months after arrival or departure. */
export const PassportRule = z.object({
  country: countryCode,
  basis: z.enum(['stay', 'arrival', 'departure']),
  months: z.number().int().nonnegative().default(0),
  blankPages: z.number().int().nonnegative().optional(),
  entryTypes: z.array(EntryType).optional(),
  sourceIds,
});
export type PassportRule = z.infer<typeof PassportRule>;

/** Rule 3. */
export const OnwardRule = z.object({
  country: countryCode,
  entryTypes: z.array(EntryType).optional(),
  why: z.string(),
  /** Bookings that don't prove much at the border (e.g. a local bus paid on board). */
  weakProofTypes: z.array(BookingType).default([]),
  weakProofNote: z.string().optional(),
  sourceIds,
});
export type OnwardRule = z.infer<typeof OnwardRule>;

/** Rule 4. */
export const EvisaRule = z.object({
  country: countryCode,
  applyUrl: z.url(),
  applyLeadDays: z.number().int().positive(),
  processing: z.string(),
  ports: z.array(z.object({ name: z.string(), match: pattern })).min(1),
  alternativesUrl: z.url(),
  sourceIds,
});
export type EvisaRule = z.infer<typeof EvisaRule>;

/** Rule 5. */
export const FormRule = z.object({
  id: z.string(),
  country: countryCode,
  name: z.string(),
  direction: z.enum(['arrival', 'departure']),
  modes: z.array(TravelMode).min(1),
  entryPointMatch: pattern.optional(),
  opensDaysBefore: z.number().int().nonnegative(),
  /** "day-before-travel": the day before the trip that gets you there. "event-day": the arrival/departure day. */
  deadline: z.enum(['day-before-travel', 'event-day']),
  /** Do it before leaving home when the arrival is this close to the home departure. */
  preferAtHomeWithinDays: z.number().int().positive().optional(),
  mandatory: z.boolean(),
  url: z.url(),
  detail: z.string(),
  sourceIds,
});
export type FormRule = z.infer<typeof FormRule>;

/** Rule 6. */
export const BookingWindowRule = z.object({
  id: z.string(),
  country: countryCode,
  name: z.string(),
  types: z.array(BookingType).min(1),
  stations: z.array(pattern).min(2),
  opensDaysBefore: z.number().int().positive(),
  opensAt: clockTime,
  timeZone: z.string(),
  busyMonths: z.array(z.number().int().min(1).max(12)).default([]),
  detail: z.string(),
  sourceIds,
});
export type BookingWindowRule = z.infer<typeof BookingWindowRule>;

/** Rule 7 (advisory areas that may affect insurance cover). */
export const AdvisoryArea = z.object({
  id: z.string(),
  country: countryCode,
  placeMatch: pattern,
  detail: z.string(),
  sourceIds,
});
export type AdvisoryArea = z.infer<typeof AdvisoryArea>;

export const ProfileFlag = z.enum(['vape', 'prescriptionMeds', 'drone', 'diving', 'scooter']);
export type ProfileFlag = z.infer<typeof ProfileFlag>;

/** Rule 8. */
export const BagRule = z.object({
  id: z.string(),
  flag: ProfileFlag,
  countries: z.array(countryCode).min(1),
  severity: z.enum(['info', 'warn', 'critical']),
  title: z.string(),
  detail: z.string(),
  sourceIds,
});
export type BagRule = z.infer<typeof BagRule>;

/** Rule 9. */
export const Holiday = z.object({
  id: z.string(),
  country: countryCode,
  name: z.string(),
  from: isoDate,
  to: isoDate,
  placeMatch: pattern.optional(),
  detail: z.string(),
  sourceIds,
});
export type Holiday = z.infer<typeof Holiday>;

/** Rule 12. */
export const Crossing = z.object({
  id: z.string(),
  name: z.string(),
  countries: z.tuple([countryCode, countryCode]),
  match: pattern,
  evisaAccepted: z.array(countryCode).default([]),
  visaOnArrival: z.array(countryCode).default([]),
  requirements: z.string(),
  howToCross: z.string(),
  sourceIds,
});
export type Crossing = z.infer<typeof Crossing>;

/** Rule 13. */
export const DrivingRule = z.object({
  country: countryCode,
  idpModel: z.enum(['1949', '1968', 'any']).default('any'),
  detail: z.string(),
  sourceIds,
});
export type DrivingRule = z.infer<typeof DrivingRule>;

const Condition = z.string().regex(/^(always|driving|flag:[a-zA-Z]+|country:[A-Z]{2})$/);

export const PredepartureItem = z.object({
  id: z.string(),
  weeksBefore: z.number().nonnegative(),
  title: z.string(),
  detail: z.string().optional(),
  when: Condition.default('always'),
  /** Tasks that are advice rather than facts may have no source. */
  sourceIds: z.array(z.string()).default([]),
});
export type PredepartureItem = z.infer<typeof PredepartureItem>;

export const CountryPrepItem = z.object({
  id: z.string(),
  country: z.union([countryCode, z.literal('ANY')]),
  moment: z.enum(['t21', 't7', 'exit']),
  title: z.string(),
  detail: z.string().optional(),
  when: Condition.default('always'),
  sourceIds: z.array(z.string()).default([]),
});
export type CountryPrepItem = z.infer<typeof CountryPrepItem>;

export const RulesContent = z.object({
  version: z.string(),
  freshnessDays: z.number().int().positive(),
  schedule: z.object({
    defaultTime: clockTime,
    arrivalKitTime: clockTime,
    quietFrom: clockTime,
    quietUntil: clockTime,
    t21: z.number().int().positive(),
    t7: z.number().int().positive(),
  }),
  stayWarningDays: z.array(z.number().int().positive()),
  sources: z.record(z.string(), RuleSource),
  stayRegimes: z.array(StayRegime),
  passport: z.array(PassportRule),
  onward: z.array(OnwardRule),
  evisa: z.array(EvisaRule),
  forms: z.array(FormRule),
  bookingWindows: z.array(BookingWindowRule),
  advisoryAreas: z.array(AdvisoryArea),
  bag: z.array(BagRule),
  holidays: z.array(Holiday),
  crossings: z.array(Crossing),
  driving: z.array(DrivingRule),
  predeparture: z.array(PredepartureItem),
  countryPrep: z.array(CountryPrepItem),
});
export type RulesContent = z.infer<typeof RulesContent>;

/** All sourceIds used anywhere must exist in `sources`. */
export function missingSourceIds(content: RulesContent): string[] {
  const used = new Set<string>();
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        if (k === 'sourceIds' && Array.isArray(x)) x.forEach((id) => used.add(String(id)));
        else walk(x);
      }
    }
  };
  const { sources: _sources, ...rest } = content;
  walk(rest);
  return [...used].filter((id) => !(id in content.sources));
}

export const rulesContent: RulesContent = RulesContent.parse(raw);
