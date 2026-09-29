import { Temporal } from 'temporal-polyfill';
import { formatDate } from '../lib/format';
import { ENTRY_TYPE_LABELS, type Stay } from '../trip/schema';
import type { Builder } from './builder';
import { re } from './builder';
import type { RulesContent, StayRegime } from './content';
import { addDays, diffDays, isSynthetic, maxDate, placeLabel, stayEnd, stayLength, stayStart } from './itinerary';
import type { StayStatus } from './types';

export function limitDays(r: StayRegime): number | undefined {
  return r.maxDays ?? (r.maxHours ? Math.floor(r.maxHours / 24) : undefined);
}

/** The stay regime for a stay: matching entry type and in force on the arrival date. */
export function selectRegime(stay: Stay, rules: RulesContent): { regime?: StayRegime; fallback: boolean } {
  const arrival = stayStart(stay);
  const inForce = rules.stayRegimes.filter(
    (r) =>
      r.country === stay.country &&
      (!r.arrivalFrom || arrival >= r.arrivalFrom) &&
      (!r.arrivalUntil || arrival <= r.arrivalUntil),
  );
  const byLimit = (a: StayRegime, b: StayRegime) => (limitDays(a) ?? Infinity) - (limitDays(b) ?? Infinity);
  if (stay.entryType === 'undecided') return { regime: [...inForce].sort(byLimit)[0], fallback: false };
  const exact = inForce.filter((r) => r.entryTypes.includes(stay.entryType)).sort(byLimit)[0];
  if (exact) return { regime: exact, fallback: false };
  if (stay.entryType === 'visa-free') {
    const transit = inForce.find((r) => r.entryTypes.includes('visa-free-transit'));
    if (transit) return { regime: transit, fallback: true };
  }
  return { fallback: false };
}

/** The last day you may be in the country. The stamped date always wins. */
export function mustLeaveBy(stay: Stay, regime: StayRegime, arrivalTime?: string | null): string {
  if (stay.stampedUntil) return stay.stampedUntil;
  const start = stayStart(stay);
  if (regime.maxDays) return addDays(start, regime.maxDays - 1);
  const hours = regime.maxHours!;
  if (arrivalTime) {
    return Temporal.PlainDateTime.from(`${start}T${arrivalTime}`).add({ hours }).toPlainDate().toString();
  }
  // Unknown arrival time: assume you landed just after midnight.
  return addDays(start, Math.floor(hours / 24) - 1);
}

/** Rule 1 (stay counters and limits) and rule 14 (rules that change during the trip). */
export function stayRules(b: Builder): StayStatus[] {
  const { ctx, it } = b;
  const { rules, today } = ctx;
  const statuses: StayStatus[] = [];

  for (const stay of it.stays) {
    const name = it.countryName(stay.country);
    const place = placeLabel(stay, name);
    const start = stayStart(stay);
    const end = stayEnd(stay);
    const { regime, fallback } = selectRegime(stay, rules);
    const status: StayStatus = { stay, synthetic: isSynthetic(stay), fallback, days: stayLength(stay) };
    statuses.push(status);

    if (!regime) {
      b.check({
        id: `stay-norule-${stay.id}`,
        rule: 1,
        severity: 'warn',
        title: `${place}: no stay rule for “${ENTRY_TYPE_LABELS[stay.entryType]}” in ${name}`,
        detail: 'Check the entry conditions, and enter the date stamped in your passport once you arrive.',
        country: stay.country,
        stayId: stay.id,
        dueDate: start,
        sourceIds: b.adviceSource(stay.country),
      });
      continue;
    }

    const arriving = it.arrivingBooking(stay);
    const arrivalTime = arriving?.arrive?.date === start ? arriving.arrive.time : null;
    const leaveBy = mustLeaveBy(stay, regime, arrivalTime);
    Object.assign(status, { regime, limitDays: limitDays(regime), mustLeaveBy: leaveBy });

    if (fallback) {
      b.check({
        id: `stay-fallback-${stay.id}`,
        rule: 1,
        severity: 'warn',
        title: `${place}: ${regime.title} instead of the visa exemption`,
        detail: `No visa exemption is known for arrivals on ${formatDate(start)}. This stay can use ${regime.title.toLowerCase()} if its conditions are met. ${regime.note ?? ''}`.trim(),
        country: stay.country,
        stayId: stay.id,
        dueDate: start,
        sourceIds: regime.sourceIds,
      });
    }

    if (end > leaveBy) {
      const over = diffDays(leaveBy, end);
      if (regime.extendable) {
        b.check({
          id: `stay-extend-${stay.id}`,
          rule: 1,
          severity: 'warn',
          title: `${place}: your plan is ${over} days longer than the ${limitDays(regime)}-day limit`,
          detail: `Arrange an extension before ${formatDate(leaveBy)}. ${regime.note ?? ''}`.trim(),
          country: stay.country,
          stayId: stay.id,
          dueDate: leaveBy,
          sourceIds: regime.sourceIds,
        });
        b.item({
          id: `stay-extend-${stay.id}`,
          rule: 1,
          group: stay.id,
          country: stay.country,
          moment: 'stay',
          title: `${name}: arrange a visa extension (the limit is day ${limitDays(regime)})`,
          detail: regime.note,
          severity: 'warn',
          remindOn: maxDate(start, addDays(leaveBy, -7)),
          deadline: leaveBy,
          sourceIds: regime.sourceIds,
        });
      } else {
        b.check({
          id: `stay-over-${stay.id}`,
          rule: 1,
          severity: 'critical',
          title: `${place}: ${status.days} days planned, ${regime.title.toLowerCase()} allows ${limitDays(regime)}`,
          detail: [`Leave by ${formatDate(leaveBy)}.`, regime.note, regime.suggestWhenTooLong].filter(Boolean).join(' '),
          country: stay.country,
          stayId: stay.id,
          dueDate: start,
          sourceIds: regime.sourceIds,
        });
        if (regime.suggestWhenTooLong) {
          b.item({
            id: `stay-too-long-${stay.id}`,
            rule: 1,
            group: stay.id,
            country: stay.country,
            moment: 't21',
            title: `${name}: your stay is longer than ${limitDays(regime)} days`,
            detail: regime.suggestWhenTooLong,
            severity: 'critical',
            remindOn: addDays(start, -rules.schedule.t21),
            deadline: addDays(start, -1),
            sourceIds: regime.sourceIds,
          });
        }
      }
    }

    if (regime.requiresThirdCountryOnward) {
      const leaving = it.leavingBookings(stay);
      const next = (leaving[0] && it.toCountry(leaving[0])) ?? it.nextCountry(stay);
      if (next === it.prevCountry(stay)) {
        b.check({
          id: `stay-third-country-${stay.id}`,
          rule: 1,
          severity: 'critical',
          title: `${place}: ${regime.title.toLowerCase()} needs an onward ticket to a third country`,
          detail: `You arrive from ${it.countryName(it.prevCountry(stay))} and leave for the same country.`,
          country: stay.country,
          stayId: stay.id,
          dueDate: start,
          sourceIds: regime.sourceIds,
        });
      }
    }

    if (regime.ports && !regime.ports.some((p) => re(p).test(stay.entry.point))) {
      b.check({
        id: `stay-port-${stay.id}`,
        rule: 1,
        severity: 'warn',
        title: `${place}: check that ${stay.entry.point} qualifies for ${regime.title.toLowerCase()}`,
        detail: regime.note ?? '',
        country: stay.country,
        stayId: stay.id,
        dueDate: start,
        sourceIds: regime.sourceIds,
      });
    }

    // Live counter while you're there.
    if (start <= today && today <= end) {
      status.daysUsed = diffDays(start, today) + 1;
      status.daysLeft = diffDays(today, leaveBy);
      const warnFrom = Math.max(...rules.stayWarningDays);
      if (status.daysLeft <= warnFrom) {
        b.check({
          id: `stay-left-${stay.id}`,
          rule: 1,
          severity: status.daysLeft <= 1 ? 'critical' : status.daysLeft <= 7 ? 'warn' : 'info',
          title: `${name}: ${status.daysLeft} days left — leave by ${formatDate(leaveBy)}`,
          detail: `Day ${status.daysUsed} of ${limitDays(regime)} on a ${regime.title.toLowerCase()}.`,
          country: stay.country,
          stayId: stay.id,
          dueDate: leaveBy,
          sourceIds: regime.sourceIds,
        });
      }
    }

    // Countdown reminders, only when the plan cuts it close (the live counter covers the rest).
    const margin = diffDays(end, leaveBy);
    for (const left of margin <= 3 ? rules.stayWarningDays : []) {
      const on = addDays(leaveBy, -left);
      if (on < start || on > end) continue;
      b.item({
        id: `stay-left-${stay.id}-${left}`,
        rule: 1,
        group: stay.id,
        country: stay.country,
        moment: 'stay',
        title: `${name}: ${left} ${left === 1 ? 'day' : 'days'} left — leave by ${formatDate(leaveBy)}`,
        severity: left <= 3 ? 'critical' : 'warn',
        remindOn: on,
        sourceIds: regime.sourceIds,
      });
    }
  }

  recheckRules(b, statuses);
  return statuses;
}

/** Rule 14: a rule that starts or ends during the trip gets a re-check a week before the stays it affects. */
function recheckRules(b: Builder, statuses: StayStatus[]) {
  const { ctx, it } = b;
  for (const r of ctx.rules.stayRegimes) {
    const change = r.arrivalUntil ? addDays(r.arrivalUntil, 1) : r.arrivalFrom;
    if (!change || change <= ctx.trip.depart || change > ctx.trip.return) continue;
    for (const s of statuses) {
      if (s.stay.country !== r.country || stayStart(s.stay) < change) continue;
      const name = it.countryName(r.country);
      const place = placeLabel(s.stay, name);
      const title = r.arrivalUntil
        ? `${place}: has ${name} extended the ${r.title}?`
        : `${place}: new rule from ${formatDate(change)} — ${r.title}`;
      const detail = r.arrivalUntil
        ? `It covers arrivals until ${formatDate(r.arrivalUntil)}. If it wasn't extended: ${s.regime?.title ?? 'check the entry rules'}. Either way keep your onward ticket at hand for immigration.`
        : `Check the rule before you arrive.`;
      b.item({
        id: `recheck-${r.id}-${s.stay.id}`,
        rule: 14,
        group: s.stay.id,
        country: r.country,
        moment: 'recheck',
        title,
        detail,
        severity: 'warn',
        remindOn: addDays(stayStart(s.stay), -7),
        deadline: addDays(stayStart(s.stay), -1),
        sourceIds: [...new Set([...r.sourceIds, ...(s.regime?.sourceIds ?? [])])],
      });
    }
  }
}
