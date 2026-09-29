import { Builder } from './builder';
import { evisaRule, onwardRule, passportRule } from './entryRules';
import { bookingWindowRules, formRules } from './formRules';
import { Itinerary } from './itinerary';
import { countryPrep, predepartureItems } from './prepRules';
import { bagRules, freshnessRule, holidayRules, insuranceRules } from './riskRules';
import { connectionRules, crossingRules, drivingRules } from './routeRules';
import { stayRules } from './stayRules';
import type { RuleContext, RuleResult } from './types';

/**
 * Runs every rule over the itinerary. Pure: same context in, same result out.
 * Rule parameters come from content/rules.json via `ctx.rules`.
 */
export function runRules(ctx: RuleContext): RuleResult {
  const it = new Itinerary(ctx);
  const b = new Builder(ctx, it);

  const stays = stayRules(b); // 1, 14
  const passport = passportRule(b); // 2
  onwardRule(b); // 3
  evisaRule(b); // 4
  formRules(b); // 5
  bookingWindowRules(b); // 6
  insuranceRules(b); // 7
  bagRules(b); // 8
  holidayRules(b); // 9
  freshnessRule(b); // 10
  connectionRules(b); // 11
  crossingRules(b); // 12
  const driving = drivingRules(b); // 13

  // Bookings already handled by a specific task (onward ticket, sale window) aren't repeated in "book what's open".
  const covered = new Set<string>();
  for (const s of it.stays) for (const x of it.leavingBookings(s)) covered.add(x.id);
  const prepIds = new Set(b.prep.map((p) => p.id));
  for (const w of ctx.rules.bookingWindows) {
    for (const x of ctx.bookings) if (prepIds.has(`window-${w.id}-${x.id}`)) covered.add(x.id);
  }

  predepartureItems(b, passport, driving);
  countryPrep(b, stays, covered);

  return {
    checks: b.checks,
    prep: b.prep,
    stays,
    ...(passport ? { passportRequiredUntil: passport.until } : {}),
  };
}
