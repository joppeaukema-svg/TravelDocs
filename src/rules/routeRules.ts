import { bookingLabel } from '../trip/schema';
import type { Builder } from './builder';
import { re } from './builder';
import { addDays, stayStart } from './itinerary';

/** Rule 11: a connection on separate tickets is an entry into that country. */
export function connectionRules(b: Builder): void {
  const { ctx, it } = b;
  for (const s of it.synthetic) {
    const name = it.countryName(s.country);
    const [a, c] = s.viaBookings.map((id) => ctx.bookings.find((x) => x.id === id)!);
    b.check({
      id: `connection-${s.id}`,
      rule: 11,
      severity: 'warn',
      title: `Self-transfer in ${name}: that counts as entering ${name}`,
      detail: `${bookingLabel(a!)} then ${bookingLabel(c!)} on separate bookings means immigration, bags and check-in again — so ${name}'s visa-free rules, forms and onward-ticket checks apply. Book connections on one ticket where you can.`,
      country: s.country,
      stayId: s.id,
      dueDate: stayStart(s),
      sourceIds: b.adviceSource(s.country),
    });
  }
}

/** Rule 12: land crossings have their own records. */
export function crossingRules(b: Builder): void {
  const { ctx, it } = b;
  for (const stay of it.stays) {
    if (stay.entry.mode !== 'land') continue;
    const name = it.countryName(stay.country);
    const crossing = ctx.rules.crossings.find((c) => re(c.match).test(stay.entry.point));
    const base = { rule: 12, country: stay.country, stayId: stay.id, dueDate: stayStart(stay) };
    if (!crossing) {
      b.check({
        ...base,
        id: `crossing-unknown-${stay.id}`,
        severity: 'warn',
        title: `No record for the ${stay.entry.point} crossing`,
        detail: `Check that it is open to foreigners and accepts your visa type for ${name}.`,
        sourceIds: b.adviceSource(stay.country),
      });
      continue;
    }
    if (stay.entryType === 'e-visa' && !crossing.evisaAccepted.includes(stay.country)) {
      b.check({
        ...base,
        id: `crossing-evisa-${stay.id}`,
        severity: 'critical',
        title: `${crossing.name} doesn't accept the ${name} e-visa`,
        detail: 'Use a visa on arrival or another crossing.',
        sourceIds: crossing.sourceIds,
      });
    }
    if (stay.entryType === 'visa-on-arrival' && !crossing.visaOnArrival.includes(stay.country)) {
      b.check({
        ...base,
        id: `crossing-voa-${stay.id}`,
        severity: 'critical',
        title: `${crossing.name} has no visa on arrival for ${name}`,
        detail: 'Apply for a visa or e-visa, or use another crossing.',
        sourceIds: crossing.sourceIds,
      });
    }
    const voa = crossing.visaOnArrival.includes(stay.country) && ['visa-on-arrival', 'undecided'].includes(stay.entryType);
    b.check({
      ...base,
      id: `crossing-${stay.id}`,
      severity: 'info',
      title: `Crossing: ${crossing.name}`,
      detail: [crossing.howToCross, voa ? crossing.requirements : ''].filter(Boolean).join(' '),
      sourceIds: crossing.sourceIds,
    });
    if (stay.entryType === 'visa-on-arrival') {
      b.item({
        id: `voa-${stay.id}`,
        rule: 12,
        group: stay.id,
        country: stay.country,
        moment: 't7',
        title: `Visa on arrival at ${crossing.name}: US dollars and a passport photo`,
        detail: crossing.requirements,
        severity: 'warn',
        remindOn: addDays(stayStart(stay), -ctx.rules.schedule.t7),
        deadline: addDays(stayStart(stay), -1),
        sourceIds: crossing.sourceIds,
      });
    }
  }
}

/** Rule 13: car and scooter plans need an IDP, the right licence and insurance cover. */
export function drivingRules(b: Builder): { idpModel: string } | undefined {
  const { ctx, it } = b;
  const drives = ctx.bookings.filter((x) => (x.type === 'car' || x.type === 'scooter') && x.depart);
  if (!drives.length) return undefined;
  const models = new Set<string>();

  for (const d of drives) {
    const country = it.fromCountry(d) ?? it.locationOn(d.depart!.date).country;
    const rule = ctx.rules.driving.find((r) => r.country === country);
    if (rule && rule.idpModel !== 'any') models.add(`${rule.idpModel} model for ${it.countryName(country)}`);
    b.item({
      id: `driving-${d.id}`,
      rule: 13,
      group: it.locationOn(d.depart!.date).stay?.id ?? 'predeparture',
      country,
      moment: 'driving',
      title: `${bookingLabel(d)}: IDP, licence category, ${d.type === 'scooter' ? 'scooter' : 'rental car'} cover`,
      detail: rule?.detail ?? `Check that ${it.countryName(country)} accepts your IDP and licence category.`,
      severity: 'warn',
      remindOn: addDays(d.depart!.date, -ctx.rules.schedule.t7),
      deadline: addDays(d.depart!.date, -1),
      sourceIds: rule?.sourceIds ?? b.adviceSource(country),
    });
  }

  if (ctx.today < ctx.trip.depart) {
    b.check({
      id: 'driving-idp',
      rule: 13,
      severity: 'warn',
      title: 'Your driving plans need an international driving permit — get it before you leave',
      detail: `The ANWB issues it in person at its stores.${models.size ? ` Needed: ${[...models].join(', ')}.` : ''}`,
      dueDate: addDays(ctx.trip.depart, -1),
      sourceIds: ctx.rules.driving.find((r) => r.idpModel !== 'any')?.sourceIds ?? ['nl-reisadvies'],
    });
  }
  return { idpModel: models.size ? ` (${[...models].join(', ')})` : '' };
}
