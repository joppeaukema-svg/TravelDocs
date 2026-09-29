import { formatDate } from '../lib/format';
import { bookingLabel, type Booking } from '../trip/schema';
import type { Builder } from './builder';
import { re } from './builder';
import { addDays, diffDays, isSynthetic, placeLabel, stayEnd, stayStart } from './itinerary';
import type { PassportRequirement } from './entryRules';
import type { StayStatus } from './types';

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m);
}

function conditionHolds(b: Builder, when: string, driving: boolean): boolean {
  if (when === 'always') return true;
  if (when === 'driving') return driving;
  if (when.startsWith('flag:')) return !!b.ctx.profile.flags[when.slice(5) as keyof typeof b.ctx.profile.flags];
  if (when.startsWith('country:')) return b.it.stays.some((s) => s.country === when.slice(8));
  return false;
}

/** Pre-departure checklist, with due dates relative to leaving home. */
export function predepartureItems(
  b: Builder,
  passport: PassportRequirement | undefined,
  driving: { idpModel: string } | undefined,
): void {
  const { ctx } = b;
  const vars = {
    passportRequiredUntil: passport ? formatDate(passport.until) : 'the end of your trip',
    blankPages: String(passport?.blankPages || 'enough'),
    passportBinding: passport?.description ?? '',
    tripDays: String(diffDays(ctx.trip.depart, ctx.trip.return) + 1),
    idpModel: driving?.idpModel ?? '',
  };
  for (const t of ctx.rules.predeparture) {
    if (!conditionHolds(b, t.when, !!driving)) continue;
    b.item({
      id: t.id,
      group: 'predeparture',
      country: ctx.trip.homeCountry,
      moment: 'predeparture',
      title: fill(t.title, vars),
      detail: t.detail ? fill(t.detail, vars) : undefined,
      severity: t.weeksBefore >= 8 ? 'warn' : 'info',
      remindOn: addDays(ctx.trip.depart, -Math.round(t.weeksBefore * 7)),
      deadline: addDays(ctx.trip.depart, -1),
      sourceIds: t.id === 'pd-passport' && passport ? passport.rule.sourceIds : t.sourceIds,
    });
  }
}

const SELLS_OUT: Booking['type'][] = ['tour', 'activity', 'accommodation', 'boat', 'ferry', 'train', 'flight', 'car', 'scooter'];

/** T−21 bookings, T−7 practicalities, the T−1 arrival kit and exit tasks, per stay. */
export function countryPrep(b: Builder, statuses: StayStatus[], covered: Set<string>): void {
  const { ctx, it } = b;
  const { t21, t7, arrivalKitTime } = ctx.rules.schedule;

  for (const status of statuses) {
    const stay = status.stay;
    if (isSynthetic(stay)) continue;
    const info = ctx.countries.get(stay.country);
    const name = it.countryName(stay.country);
    const start = stayStart(stay);
    const end = stayEnd(stay);
    const vars = {
      countryName: name,
      currency: info?.currency ?? 'local currency',
      places: stay.places.slice(0, 4).join(', ') || name,
    };

    // T−21: bookings that sell out and are still only planned.
    const open = ctx.bookings.filter(
      (x) =>
        x.status === 'planned' &&
        SELLS_OUT.includes(x.type) &&
        x.depart &&
        x.depart.date >= start &&
        x.depart.date <= end &&
        it.locationOn(x.depart.date).country === stay.country &&
        !covered.has(x.id),
    );
    if (open.length) {
      b.item({
        id: `book-${stay.id}`,
        group: stay.id,
        country: stay.country,
        moment: 't21',
        title: `Book what's still open in ${name}: ${open.map(bookingLabel).join('; ')}`,
        detail: 'These are still marked as planned. Tours, boats and popular stays can sell out.',
        severity: 'info',
        remindOn: addDays(start, -t21),
        deadline: addDays(open.map((x) => x.depart!.date).sort()[0]!, -1),
        sourceIds: [],
      });
    }

    for (const p of ctx.rules.countryPrep) {
      if (p.country !== 'ANY' && p.country !== stay.country) continue;
      if (!conditionHolds(b, p.when, false)) continue;
      if (p.moment === 'exit' && it.nextCountry(stay) === stay.country) continue;
      const remindOn = p.moment === 't21' ? addDays(start, -t21) : p.moment === 't7' ? addDays(start, -t7) : addDays(end, -1);
      b.item({
        id: `${p.id}-${stay.id}`,
        group: stay.id,
        country: stay.country,
        moment: p.moment,
        title: fill(p.title, vars),
        detail: p.detail ? fill(p.detail, vars) : undefined,
        severity: 'info',
        remindOn,
        deadline: p.moment === 'exit' ? end : addDays(start, -1),
        sourceIds: p.sourceIds,
      });
    }

    // T−1 at 19:00: the arrival kit.
    b.item({
      id: `kit-${stay.id}`,
      group: stay.id,
      country: stay.country,
      moment: 't1',
      title: `Arriving in ${placeLabel(stay, name)} tomorrow`,
      detail: arrivalKit(b, status),
      severity: 'info',
      remindOn: addDays(start, -1),
      time: arrivalKitTime,
      sourceIds: [...(status.regime?.sourceIds ?? []), ...b.adviceSource(stay.country)],
    });
  }
}

function arrivalKit(b: Builder, status: StayStatus): string {
  const { ctx } = b;
  const stay = status.stay;
  const start = stayStart(stay);
  const lines: string[] = [];

  const bed = ctx.bookings.find((x) => x.type === 'accommodation' && x.depart?.date === start);
  if (bed) {
    const address = bed.addressLocal ?? bed.address;
    lines.push(`First night: ${bookingLabel(bed)}${address ? ` — ${address}` : ' (add the address in local script)'}.`);
  } else {
    lines.push('First night: no accommodation booked yet.');
  }

  const crossing = stay.entry.mode === 'land' ? ctx.rules.crossings.find((c) => re(c.match).test(stay.entry.point)) : undefined;
  lines.push(crossing ? `Crossing: ${crossing.howToCross}` : `Arriving at ${stay.entry.point}.`);

  if (status.regime && status.mustLeaveBy) {
    lines.push(`${status.regime.title}: must leave by ${formatDate(status.mustLeaveBy)}.`);
  }
  const numbers = ctx.countries.get(stay.country)?.emergency ?? [];
  if (numbers.length) lines.push(`Emergency: ${numbers.join(' · ')}.`);

  const banned = ctx.rules.bag.filter((r) => r.severity === 'critical' && r.countries.includes(stay.country));
  if (banned.length) lines.push(`Don't carry: ${banned.map((r) => r.title.toLowerCase()).join('; ')}.`);
  return lines.join('\n');
}
