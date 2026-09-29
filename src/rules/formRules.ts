import { formatDate } from '../lib/format';
import type { Builder } from './builder';
import { re } from './builder';
import { addDays, diffDays, minDate, placeLabel, stayEnd, stayStart } from './itinerary';

/** Rule 5: arrival and departure forms as dated to-dos (window opens → deadline). */
export function formRules(b: Builder): void {
  const { ctx, it } = b;
  for (const stay of it.stays) {
    const name = it.countryName(stay.country);
    const sameCountryStays = it.stays.filter((s) => s.country === stay.country).length;
    const where = sameCountryStays > 1 ? ` — ${placeLabel(stay, name)}` : '';

    for (const form of ctx.rules.forms.filter((f) => f.country === stay.country)) {
      let event: string;
      let deadline: string;
      if (form.direction === 'arrival') {
        if (!form.modes.includes(stay.entry.mode)) continue;
        if (form.entryPointMatch && !re(form.entryPointMatch).test(stay.entry.point)) continue;
        event = stayStart(stay);
        const travelDay = it.arrivingBooking(stay)?.depart?.date ?? event;
        deadline = form.deadline === 'event-day' ? event : addDays(travelDay, -1);
        if (form.preferAtHomeWithinDays && diffDays(ctx.trip.depart, event) <= form.preferAtHomeWithinDays) {
          deadline = addDays(ctx.trip.depart, -1);
        }
      } else {
        if (!form.modes.includes(stay.exit.mode) || it.nextCountry(stay) === stay.country) continue;
        event = stayEnd(stay);
        deadline = event;
      }
      const remindOn = minDate(addDays(event, -form.opensDaysBefore), deadline);
      const verb = form.direction === 'arrival' ? 'arriving' : 'leaving';
      b.item({
        id: `form-${form.id}-${stay.id}`,
        rule: 5,
        group: stay.id,
        country: stay.country,
        moment: 'form',
        title: `${form.name}${where}`,
        detail: `${form.detail} You're ${verb} on ${formatDate(event)}.`,
        severity: form.mandatory ? 'warn' : 'info',
        remindOn,
        deadline,
        url: form.url,
        sourceIds: form.sourceIds,
      });
    }
  }
}

/** Rule 6: tickets that go on sale a set time ahead (e.g. the Laos–China Railway). */
export function bookingWindowRules(b: Builder): void {
  const { ctx, it } = b;
  for (const w of ctx.rules.bookingWindows) {
    for (const booking of ctx.bookings) {
      if (booking.status === 'booked' || !w.types.includes(booking.type) || !booking.depart) continue;
      if (!booking.from || !booking.to || it.fromCountry(booking) !== w.country) continue;
      const station = (place: string) => w.stations.some((s) => re(s).test(place));
      if (!station(booking.from) || !station(booking.to)) continue;

      const date = booking.depart.date;
      const opens = addDays(date, -w.opensDaysBefore);
      const busy = w.busyMonths.includes(Number(date.slice(5, 7)));
      b.item({
        id: `window-${w.id}-${booking.id}`,
        rule: 6,
        group: it.locationOn(date).stay?.id ?? 'predeparture',
        country: w.country,
        moment: 'window',
        title: `${w.name} sales open for ${booking.from} → ${booking.to} on ${formatDate(date)}`,
        detail: busy ? `${w.detail} This is peak season: be ready at ${w.opensAt}.` : w.detail,
        severity: busy ? 'warn' : 'info',
        remindOn: opens,
        deadline: opens,
        time: w.opensAt,
        tz: w.timeZone,
        sourceIds: w.sourceIds,
      });
    }
  }
}
