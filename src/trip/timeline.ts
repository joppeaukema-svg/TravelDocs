import { addDays } from '../rules/itinerary';
import type { TripData } from './io';
import type { Booking } from './schema';

const OVERNIGHT: Booking['type'][] = ['flight', 'train', 'bus', 'ferry', 'boat', 'transport', 'tour'];

/** Nights (dates you go to sleep) with no accommodation, overnight transport or multi-day tour booked. */
export function nightsWithoutBed(data: TripData): string[] {
  const out: string[] = [];
  for (let night = data.meta.depart; night < data.meta.return; night = addDays(night, 1)) {
    const covered = data.bookings.some((b) => {
      if (b.status === 'idea' || !b.depart) return false;
      const start = b.depart.date;
      const end = b.arrive?.date ?? start;
      if (b.type === 'accommodation') return start <= night && (end > night || (end === start && start === night));
      return OVERNIGHT.includes(b.type) && start <= night && end > night;
    });
    if (!covered) out.push(night);
  }
  return out;
}

/** Bookings that start on a date, in local time order. */
export function bookingsOn(data: TripData, date: string): Booking[] {
  return data.bookings
    .filter((b) => b.depart?.date === date)
    .sort((a, b) => (a.depart!.time ?? '99').localeCompare(b.depart!.time ?? '99'));
}

/** Groups consecutive dates into ranges: ["1", "2", "3", "5"] → [["1","3"], ["5","5"]]. */
export function dateRanges(dates: string[]): [string, string][] {
  const ranges: [string, string][] = [];
  for (const d of dates) {
    const last = ranges[ranges.length - 1];
    if (last && addDays(last[1], 1) === d) last[1] = d;
    else ranges.push([d, d]);
  }
  return ranges;
}

/** The accommodation you sleep in on a night (the check-in date up to the day before check-out). */
export function accommodationOn(data: TripData, night: string): Booking | undefined {
  return data.bookings.find((b) => {
    if (b.type !== 'accommodation' || b.status === 'idea' || !b.depart) return false;
    const end = b.arrive?.date ?? b.depart.date;
    return b.depart.date <= night && (end > night || end === b.depart.date);
  });
}
