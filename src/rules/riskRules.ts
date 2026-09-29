import { formatDate } from '../lib/format';
import { bookingLabel } from '../trip/schema';
import type { Builder } from './builder';
import { re } from './builder';
import { addDays, diffDays, stayEnd, stayStart } from './itinerary';

const DRIVING = ['car', 'scooter'] as const;

/** Rule 7: trip length and activities against the insurance cover. */
export function insuranceRules(b: Builder): void {
  const { ctx, it } = b;
  const cov = ctx.coverage;
  const tripDays = diffDays(ctx.trip.depart, ctx.trip.return) + 1;
  const due = addDays(ctx.trip.depart, -1);
  const src = ['poliswijzer-max-days'];

  if (!cov.entered || cov.maxDaysPerTrip === null) {
    b.check({
      id: 'ins-max-days',
      rule: 7,
      severity: 'warn',
      title: `Check your policy's maximum days per trip (${tripDays}-day trip)`,
      detail: 'Continuous travel policies cap the length of a single trip. Enter the limit under More → Insurance.',
      dueDate: due,
      sourceIds: src,
    });
  } else if (cov.maxDaysPerTrip < tripDays) {
    b.check({
      id: 'ins-max-days',
      rule: 7,
      severity: 'critical',
      title: `Your insurance covers ${cov.maxDaysPerTrip} days per trip; this trip is ${tripDays}`,
      detail: 'Extend the policy or buy separate cover for the whole trip.',
      dueDate: due,
      sourceIds: src,
    });
  }

  const drives = ctx.bookings.filter((x) => (DRIVING as readonly string[]).includes(x.type));
  if (drives.length && cov.scooter !== 'yes') {
    b.check({
      id: 'ins-scooter',
      rule: 7,
      severity: cov.scooter === 'no' ? 'critical' : 'warn',
      title: cov.scooter === 'no' ? 'Your insurance does not cover scooters or cars' : 'Check scooter and car cover',
      detail: `Planned: ${drives.map(bookingLabel).join('; ')}. Check licence conditions too.`,
      dueDate: due,
      sourceIds: src,
    });
  }
  if (ctx.profile.flags.diving && cov.diving !== 'yes') {
    b.check({
      id: 'ins-diving',
      rule: 7,
      severity: cov.diving === 'no' ? 'critical' : 'warn',
      title: cov.diving === 'no' ? 'Your insurance does not cover diving' : 'Check diving cover and maximum depth',
      detail: 'Diving usually needs extra cover.',
      dueDate: due,
      sourceIds: b.adviceSource('PH'),
    });
  }
  if (cov.evacuation !== 'yes') {
    b.check({
      id: 'ins-evacuation',
      rule: 7,
      severity: 'warn',
      title: 'Check that medical evacuation is covered',
      detail: 'Healthcare can be very limited outside the capitals; serious cases may need evacuation to another country.',
      dueDate: due,
      sourceIds: it.stays.some((s) => s.country === 'LA') ? b.adviceSource('LA') : src,
    });
  }

  for (const area of ctx.rules.advisoryAreas) {
    const pattern = re(area.placeMatch);
    const hit = it.stays.find((s) => s.country === area.country && s.places.some((p) => pattern.test(p)));
    if (!hit) continue;
    b.check({
      id: `ins-area-${area.id}`,
      rule: 7,
      severity: 'warn',
      title: `${hit.places.find((p) => pattern.test(p))}: near an orange or red advice area`,
      detail: `${area.detail} Check what your insurance covers there.`,
      country: area.country,
      stayId: hit.id,
      dueDate: stayStart(hit),
      sourceIds: area.sourceIds,
    });
  }
}

/** Rule 8: things in your bag that are banned or limited on the route. */
export function bagRules(b: Builder): void {
  const { ctx, it } = b;
  const route = new Set(it.stays.map((s) => s.country));
  for (const rule of ctx.rules.bag) {
    if (!ctx.profile.flags[rule.flag]) continue;
    const hit = rule.countries.filter((c) => route.has(c));
    if (!hit.length) continue;
    b.check({
      id: `bag-${rule.id}`,
      rule: 8,
      severity: rule.severity,
      title: `${rule.title}: ${hit.map((c) => it.countryName(c)).join(', ')}`,
      detail: rule.detail,
      sourceIds: rule.sourceIds,
    });
  }
}

/** Rule 9: holidays and festivals during a stay. */
export function holidayRules(b: Builder): void {
  const { ctx, it } = b;
  for (const h of ctx.rules.holidays) {
    const stay = it.stays.find(
      (s) =>
        s.country === h.country &&
        stayStart(s) <= h.to &&
        h.from <= stayEnd(s) &&
        (!h.placeMatch || s.places.some((p) => re(h.placeMatch!).test(p))),
    );
    if (!stay) continue;
    const when = h.from === h.to ? formatDate(h.from) : `${formatDate(h.from)} – ${formatDate(h.to)}`;
    b.check({
      id: `holiday-${h.id}`,
      rule: 9,
      severity: 'info',
      title: `${h.name}, ${when}`,
      detail: h.detail,
      country: h.country,
      stayId: stay.id,
      dueDate: h.from,
      sourceIds: h.sourceIds,
    });
  }
}

const FRESH_TOPICS = ['entry', 'forms', 'laws'];

/** Rule 10: entry, form and law facts that haven't been verified recently. */
export function freshnessRule(b: Builder): void {
  const { ctx } = b;
  const cutoff = addDays(ctx.today, -ctx.rules.freshnessDays);
  const staleSources = Object.entries(ctx.rules.sources).filter(([, s]) => s.verifiedAt < cutoff);
  const staleFacts = (ctx.facts ?? []).filter((f) => FRESH_TOPICS.includes(f.topic) && f.verifiedAt < cutoff);
  const n = staleSources.length + staleFacts.length;
  if (!n) return;
  const names = [...staleSources.map(([, s]) => s.title), ...staleFacts.map((f) => f.title)];
  b.check({
    id: 'freshness',
    rule: 10,
    severity: 'warn',
    title: `Re-verify ${n} rule ${n === 1 ? 'source' : 'sources'} (checked more than ${ctx.rules.freshnessDays} days ago)`,
    detail: names.slice(0, 5).join('; ') + (names.length > 5 ? `; and ${names.length - 5} more` : ''),
    dueDate: ctx.today,
    sourceIds: staleSources.slice(0, 10).map(([id]) => id),
  });
}
