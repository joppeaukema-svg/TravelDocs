import { formatDate } from '../lib/format';
import { bookingLabel } from '../trip/schema';
import type { Builder } from './builder';
import { re } from './builder';
import type { PassportRule } from './content';
import { addDays, addMonths, placeLabel, stayEnd, stayStart } from './itinerary';

export interface PassportRequirement {
  until: string;
  country: string;
  rule: PassportRule;
  blankPages: number;
  description: string;
}

/** Rule 2: the passport must be valid until the latest date any country on the route requires. */
export function passportRule(b: Builder): PassportRequirement | undefined {
  const { ctx, it } = b;
  let req: PassportRequirement | undefined;
  let pages = 0;

  for (const stay of it.stays) {
    for (const rule of ctx.rules.passport) {
      if (rule.country !== stay.country) continue;
      if (rule.entryTypes && !rule.entryTypes.includes(stay.entryType)) continue;
      const until =
        rule.basis === 'stay'
          ? stayEnd(stay)
          : addMonths(rule.basis === 'arrival' ? stayStart(stay) : stayEnd(stay), rule.months);
      pages = Math.max(pages, rule.blankPages ?? 0);
      if (!req || until > req.until) {
        const name = it.countryName(stay.country);
        const description =
          rule.basis === 'stay'
            ? `${name} wants it valid for the whole stay (until ${formatDate(until)}).`
            : `${name} wants it valid ${rule.months} months after ${rule.basis === 'arrival' ? 'arrival' : 'departure'} (${formatDate(until)}).`;
        req = { until, country: stay.country, rule, blankPages: 0, description };
      }
    }
  }
  if (!req) return undefined;
  req.blankPages = pages;

  const expiry = ctx.profile.passportExpiry;
  const need = `valid until at least ${formatDate(req.until)}${pages ? ` with ${pages} blank pages` : ''}`;
  if (!expiry) {
    b.check({
      id: 'passport-unknown',
      rule: 2,
      severity: 'warn',
      title: 'Add your passport and its expiry date',
      detail: `Your passport must be ${need}. ${req.description}`,
      dueDate: addDays(ctx.trip.depart, -1),
      sourceIds: req.rule.sourceIds,
    });
  } else if (expiry < req.until) {
    b.check({
      id: 'passport-too-short',
      rule: 2,
      severity: 'critical',
      title: `Passport expires ${formatDate(expiry)} — it must be ${need}`,
      detail: req.description,
      country: req.country,
      dueDate: addDays(ctx.trip.depart, -1),
      sourceIds: req.rule.sourceIds,
    });
  }
  if (ctx.profile.blankPages !== undefined && ctx.profile.blankPages < pages) {
    b.check({
      id: 'passport-pages',
      rule: 2,
      severity: 'critical',
      title: `Your passport needs ${pages} blank pages`,
      detail: `You entered ${ctx.profile.blankPages}.`,
      dueDate: addDays(ctx.trip.depart, -1),
      sourceIds: ctx.rules.passport.filter((r) => r.blankPages).flatMap((r) => r.sourceIds),
    });
  }
  return req;
}

/** Rule 3: countries that want to see how you leave. */
export function onwardRule(b: Builder): void {
  const { ctx, it } = b;
  const { t21 } = ctx.rules.schedule;
  for (const stay of it.stays) {
    const rule = ctx.rules.onward.find(
      (o) =>
        o.country === stay.country &&
        (!o.entryTypes || stay.entryType === 'undecided' || o.entryTypes.includes(stay.entryType)),
    );
    if (!rule) continue;
    const name = it.countryName(stay.country);
    const start = stayStart(stay);
    const leaving = it.leavingBookings(stay);
    const strong = leaving.filter((x) => !rule.weakProofTypes.includes(x.type));
    if (strong.some((x) => x.status === 'booked')) continue;

    const base = { country: stay.country, stayId: stay.id, sourceIds: rule.sourceIds };
    if (!leaving.length) {
      b.check({
        ...base,
        id: `onward-none-${stay.id}`,
        rule: 3,
        severity: 'critical',
        title: `No booking leaves ${name}`,
        detail: `${rule.why} Add the way out to your trip and book it.`,
        dueDate: start,
      });
      continue;
    }
    const target = strong[0];
    const title = target
      ? `Book ${bookingLabel(target)} — the onward ticket ${name} wants to see on ${formatDate(start)}`
      : `Proof of leaving ${name}`;
    const detail = target ? rule.why : [rule.why, rule.weakProofNote].filter(Boolean).join(' ');
    b.check({ ...base, id: `onward-${stay.id}`, rule: 3, severity: 'warn', title, detail, dueDate: addDays(start, -1) });
    b.item({
      ...base,
      id: `onward-${stay.id}`,
      rule: 3,
      group: stay.id,
      moment: 't21',
      title,
      detail,
      severity: 'warn',
      remindOn: addDays(start, -t21),
      deadline: addDays(start, -1),
    });
  }
}

/** Rule 4: an e-visa only works at the ports on the official list. */
export function evisaRule(b: Builder): void {
  const { ctx, it } = b;
  for (const rule of ctx.rules.evisa) {
    for (const stay of it.stays.filter((s) => s.country === rule.country)) {
      const name = it.countryName(stay.country);
      const start = stayStart(stay);
      const port = rule.ports.find((p) => re(p.match).test(stay.entry.point));
      const base = { country: stay.country, stayId: stay.id, sourceIds: rule.sourceIds };
      const lastDay = addDays(start, -rule.applyLeadDays);

      if (stay.entryType === 'e-visa' && !port) {
        b.check({
          ...base,
          id: `evisa-port-${stay.id}`,
          rule: 4,
          severity: 'critical',
          title: `The ${name} e-visa doesn't work at ${stay.entry.point}`,
          detail: `It is only accepted at: ${rule.ports.map((p) => p.name).join('; ')}. Use a visa on arrival where offered — see the checkpoint list: ${rule.alternativesUrl}`,
          dueDate: start,
        });
      }

      if (stay.entryType === 'undecided') {
        const crossing = ctx.rules.crossings.find((c) => re(c.match).test(stay.entry.point));
        const voa = crossing?.visaOnArrival.includes(stay.country) ? crossing.requirements : '';
        b.item({
          ...base,
          id: `evisa-decide-${stay.id}`,
          rule: 4,
          group: stay.id,
          moment: 't21',
          title: `${name}: e-visa or visa on arrival${voa ? ' (US dollars + photo)' : ''}`,
          detail: [
            port
              ? `${stay.entry.point} accepts the e-visa (${rule.processing}).`
              : `The e-visa is not accepted at ${stay.entry.point}.`,
            voa,
          ]
            .filter(Boolean)
            .join(' '),
          severity: 'warn',
          remindOn: addDays(start, -ctx.rules.schedule.t21),
          deadline: port ? lastDay : addDays(start, -1),
          url: rule.applyUrl,
        });
      }

      if (stay.entryType === 'e-visa') {
        b.item({
          ...base,
          id: `evisa-apply-${stay.id}`,
          rule: 4,
          group: stay.id,
          moment: 't21',
          title: `Apply for the ${name} e-visa`,
          detail: `${rule.processing}. Only at ${rule.applyUrl}.`,
          severity: 'warn',
          remindOn: addDays(start, -ctx.rules.schedule.t21),
          deadline: lastDay,
          url: rule.applyUrl,
        });
      }

      if (port && (stay.entryType === 'e-visa' || stay.entryType === 'undecided')) {
        b.item({
          ...base,
          id: `evisa-last-${stay.id}`,
          rule: 4,
          group: stay.id,
          moment: 't21',
          title: `Last comfortable day to apply for the ${name} e-visa`,
          detail: `${rule.processing}. Only at ${rule.applyUrl}. Arriving at ${placeLabel(stay, name)} on ${formatDate(start)}.`,
          severity: 'warn',
          remindOn: lastDay,
          deadline: lastDay,
          url: rule.applyUrl,
        });
      }
    }
  }
}
