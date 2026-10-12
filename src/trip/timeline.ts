import type { TripData } from './io';
import type { Booking } from './schema';

/** Bookings that start on a date, in local time order. */
export function bookingsOn(data: TripData, date: string): Booking[] {
  return data.bookings
    .filter((b) => b.depart?.date === date)
    .sort((a, b) => (a.depart!.time ?? '99').localeCompare(b.depart!.time ?? '99'));
}

/** The accommodation you sleep in on a night (the check-in date up to the day before check-out). */
export function accommodationOn(data: TripData, night: string): Booking | undefined {
  return data.bookings.find((b) => {
    if (b.type !== 'accommodation' || b.status === 'idea' || !b.depart) return false;
    const end = b.arrive?.date ?? b.depart.date;
    return b.depart.date <= night && (end > night || end === b.depart.date);
  });
}
