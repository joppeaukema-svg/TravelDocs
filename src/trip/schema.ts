import { z } from 'zod';
import { countryCode, isoDate } from '../content/schema';

export const TRIP_FORMAT = 'travel-companion-trip/1';

export function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const timeZone = z.string().refine(isTimeZone, 'Unknown IANA time zone');
export const clockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time as HH:MM');

/** A local date and optional time in an IANA zone. Unknown times are null. */
export const LocalMoment = z.object({
  date: isoDate,
  time: clockTime.nullable().default(null),
  tz: timeZone,
});
export type LocalMoment = z.infer<typeof LocalMoment>;

export const TravelMode = z.enum(['air', 'land', 'sea']);
export type TravelMode = z.infer<typeof TravelMode>;

export const Border = z.object({ point: z.string().min(1), mode: TravelMode });
export type Border = z.infer<typeof Border>;

export const EntryType = z.enum(['visa-free', 'visa-free-transit', 'e-visa', 'visa-on-arrival', 'visa', 'undecided']);
export type EntryType = z.infer<typeof EntryType>;

export const ENTRY_TYPE_LABELS: Record<EntryType, string> = {
  'visa-free': 'Visa-free',
  'visa-free-transit': 'Visa-free transit',
  'e-visa': 'E-visa',
  'visa-on-arrival': 'Visa on arrival',
  visa: 'Visa',
  undecided: 'Not decided yet',
};

export const Stay = z
  .object({
    id: z.string().min(1),
    country: countryCode,
    kind: z.enum(['stay', 'layover', 'transit']).default('stay'),
    places: z.array(z.string()).default([]),
    from: isoDate,
    to: isoDate,
    entry: Border,
    exit: Border,
    entryType: EntryType,
    entryNote: z.string().optional(),
    actualFrom: isoDate.optional(),
    actualTo: isoDate.optional(),
    /** The "valid until" date stamped in the passport. Always wins. */
    stampedUntil: isoDate.optional(),
  })
  .refine((s) => s.to >= s.from, { message: '"to" is before "from"', path: ['to'] });
export type Stay = z.infer<typeof Stay>;

export const BookingType = z.enum([
  'flight', 'train', 'bus', 'ferry', 'boat', 'accommodation', 'tour', 'activity', 'transport', 'car', 'scooter',
]);
export type BookingType = z.infer<typeof BookingType>;

export const BOOKING_TYPE_LABELS: Record<BookingType, string> = {
  flight: 'Flight',
  train: 'Train',
  bus: 'Bus',
  ferry: 'Ferry',
  boat: 'Boat',
  accommodation: 'Accommodation',
  tour: 'Tour',
  activity: 'Activity',
  transport: 'Transport',
  car: 'Rental car',
  scooter: 'Scooter',
};

export const BookingStatus = z.enum(['booked', 'planned', 'idea']);
export type BookingStatus = z.infer<typeof BookingStatus>;

export const Booking = z.object({
  id: z.string().min(1),
  type: BookingType,
  status: BookingStatus,
  title: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  depart: LocalMoment.optional(),
  arrive: LocalMoment.optional(),
  /** Set when the time zone alone doesn't tell the country (e.g. Bangkok vs Vientiane share a zone). */
  fromCountry: countryCode.optional(),
  toCountry: countryCode.optional(),
  provider: z.string().optional(),
  confirmation: z.string().optional(),
  address: z.string().optional(),
  addressLocal: z.string().optional(),
  cost: z.number().nonnegative().optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  freeCancellationUntil: isoDate.optional(),
  documentIds: z.array(z.string()).default([]),
  note: z.string().optional(),
});
export type Booking = z.infer<typeof Booking>;

export const Day = z.object({
  date: isoDate,
  country: z.string().regex(/^[A-Z]{2}$/),
  place: z.string().nullable().default(null),
  note: z.string().default(''),
});
export type Day = z.infer<typeof Day>;

export const TripMeta = z.object({
  title: z.string().default('My trip'),
  depart: isoDate,
  return: isoDate,
  passport: z.string().default('NL'),
  homeCountry: z.string().regex(/^[A-Z]{2}$/).default('NL'),
  homeTimeZone: timeZone.default('Europe/Amsterdam'),
  demo: z.boolean().default(false),
  importedAt: z.string().optional(),
});
export type TripMeta = z.infer<typeof TripMeta>;

export function bookingLabel(b: Booking): string {
  if (b.title) return b.title;
  if (b.from && b.to) return `${b.from} → ${b.to}`;
  return BOOKING_TYPE_LABELS[b.type];
}
