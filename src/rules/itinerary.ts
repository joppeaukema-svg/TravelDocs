import { Temporal } from 'temporal-polyfill';
import type { Booking, Stay } from '../trip/schema';
import type { RuleContext } from './types';

export const addDays = (d: string, n: number) => Temporal.PlainDate.from(d).add({ days: n }).toString();
export const addMonths = (d: string, n: number) => Temporal.PlainDate.from(d).add({ months: n }).toString();
/** Whole days from a to b. */
export const diffDays = (a: string, b: string) =>
  Temporal.PlainDate.from(a).until(Temporal.PlainDate.from(b), { largestUnit: 'day' }).days;
export const maxDate = (a: string, b: string) => (a > b ? a : b);
export const minDate = (a: string, b: string) => (a < b ? a : b);

export const stayStart = (s: Stay) => s.actualFrom ?? s.from;
export const stayEnd = (s: Stay) => s.actualTo ?? s.to;
/** Days in a country, counting arrival and departure day (how immigration counts). */
export const stayLength = (s: Stay) => diffDays(stayStart(s), stayEnd(s)) + 1;

const MOVING: Booking['type'][] = ['flight', 'train', 'bus', 'ferry', 'boat', 'transport'];

export interface SyntheticStay extends Stay {
  synthetic: true;
  viaBookings: [string, string];
}

/**
 * Derived view of the itinerary used by all rules: countries of bookings,
 * the bookings that enter and leave each stay, and where you are on a date.
 */
export class Itinerary {
  readonly stays: Stay[];
  readonly synthetic: SyntheticStay[];
  private readonly tzCountry = new Map<string, string>();

  constructor(private readonly ctx: RuleContext) {
    for (const c of ctx.countries.values()) this.tzCountry.set(c.timeZone, c.code);
    this.tzCountry.set(ctx.trip.homeTimeZone, ctx.trip.homeCountry);
    const real = [...ctx.stays].sort((a, b) => stayStart(a).localeCompare(stayStart(b)));
    this.synthetic = this.findSelfTransfers(real);
    this.stays = [...real, ...this.synthetic].sort((a, b) => stayStart(a).localeCompare(stayStart(b)));
  }

  get home() {
    return this.ctx.trip.homeCountry;
  }

  countryOfTz(tz: string): string | undefined {
    return this.tzCountry.get(tz);
  }

  tzOf(country: string): string {
    if (country === this.home) return this.ctx.trip.homeTimeZone;
    return this.ctx.countries.get(country)?.timeZone ?? this.ctx.trip.homeTimeZone;
  }

  countryName(country: string): string {
    return this.ctx.countries.get(country)?.name ?? country;
  }

  fromCountry(b: Booking): string | undefined {
    return b.fromCountry ?? (b.depart ? this.countryOfTz(b.depart.tz) : undefined);
  }

  toCountry(b: Booking): string | undefined {
    return b.toCountry ?? (b.arrive ? this.countryOfTz(b.arrive.tz) : undefined);
  }

  private neighbour(stay: Stay, dir: -1 | 1): string {
    const i = this.stays.indexOf(stay);
    return this.stays[i + dir]?.country ?? this.home;
  }

  prevCountry(stay: Stay): string {
    return this.neighbour(stay, -1);
  }

  nextCountry(stay: Stay): string {
    return this.neighbour(stay, 1);
  }

  /** Bookings that take you out of the stay's country. */
  leavingBookings(stay: Stay): Booking[] {
    const start = stayStart(stay);
    const end = stayEnd(stay);
    return this.ctx.bookings.filter((b) => {
      if (!MOVING.includes(b.type) || !b.depart) return false;
      if (b.depart.date < start || b.depart.date > end) return false;
      if (this.fromCountry(b) !== stay.country) return false;
      const to = this.toCountry(b);
      if (to) return to !== stay.country;
      return b.depart.date === end && this.nextCountry(stay) !== stay.country;
    });
  }

  /** The booking that brings you into the stay's country, if any. */
  arrivingBooking(stay: Stay): Booking | undefined {
    const start = stayStart(stay);
    const candidates = this.ctx.bookings.filter((b) => {
      if (!MOVING.includes(b.type) || !b.depart) return false;
      const to = this.toCountry(b);
      const arrivalDate = b.arrive?.date ?? b.depart.date;
      if (arrivalDate < addDays(start, -1) || arrivalDate > start) return false;
      if (to) return to === stay.country && this.fromCountry(b) !== stay.country;
      return b.depart.date === start && this.fromCountry(b) === this.prevCountry(stay);
    });
    return candidates.sort((a, b) => b.depart!.date.localeCompare(a.depart!.date))[0];
  }

  /** Where you are on a date; on travel days the morning belongs to the earlier stay. */
  locationOn(date: string, afternoon = false): { country: string; tz: string; stay?: Stay } {
    const here = this.stays.filter((s) => stayStart(s) <= date && date <= stayEnd(s));
    const stay = afternoon ? here[here.length - 1] : here[0];
    if (stay) return { country: stay.country, tz: this.tzOf(stay.country), stay };
    if (date < this.ctx.trip.depart || date > this.ctx.trip.return) return { country: this.home, tz: this.tzOf(this.home) };
    const before = this.stays.filter((s) => stayEnd(s) < date).pop();
    const country = before?.country ?? this.home;
    return { country, tz: this.tzOf(country), ...(before ? { stay: before } : {}) };
  }

  /**
   * Rule 11: two flights where the first lands in a country and the second
   * leaves it within a day, with no stay there, are a connection on separate
   * tickets — which counts as entering that country.
   */
  private findSelfTransfers(real: Stay[]): SyntheticStay[] {
    const flights = this.ctx.bookings
      .filter((b) => b.type === 'flight' && b.depart)
      .sort((a, b) => a.depart!.date.localeCompare(b.depart!.date));
    const out: SyntheticStay[] = [];
    for (const a of flights) {
      const c = this.toCountry(a);
      const landed = a.arrive?.date;
      if (!c || !landed || c === this.fromCountry(a) || c === this.home) continue;
      if (real.some((s) => s.country === c && stayStart(s) <= landed && landed <= stayEnd(s))) continue;
      const b = flights.find(
        (f) => f !== a && this.fromCountry(f) === c && f.depart!.date >= landed && f.depart!.date <= addDays(landed, 1),
      );
      if (!b) continue;
      out.push({
        id: `connection-${a.id}`,
        country: c,
        kind: 'transit',
        places: [a.to ?? c],
        from: landed,
        to: b.depart!.date,
        entry: { point: a.to ?? c, mode: 'air' },
        exit: { point: b.from ?? c, mode: 'air' },
        entryType: 'undecided',
        synthetic: true,
        viaBookings: [a.id, b.id],
      });
    }
    return out;
  }
}

export function isSynthetic(s: Stay): s is SyntheticStay {
  return (s as Partial<SyntheticStay>).synthetic === true;
}

export function placeLabel(s: Stay, countryName: string): string {
  return s.places[0] ?? countryName;
}
