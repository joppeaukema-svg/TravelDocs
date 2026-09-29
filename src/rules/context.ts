import { allCountries } from '../content';
import { CoverageSummary } from '../profile/insurance';
import type { TripData } from '../trip/io';
import { rulesContent, type RulesContent } from './content';
import type { CountryInfo, Profile, RuleContext } from './types';

export function countriesFromContent(): Map<string, CountryInfo> {
  return new Map(
    allCountries().map((c) => [
      c.country,
      {
        code: c.country,
        name: c.name,
        timeZone: c.timeZone,
        currency: c.currency,
        emergency: c.emergencyNumbers.map((n) => `${n.label} ${n.number}`),
      },
    ]),
  );
}

export function contentFacts(): NonNullable<RuleContext['facts']> {
  return allCountries().flatMap((c) => c.facts.map((f) => ({ id: f.id, title: f.title, topic: f.topic, verifiedAt: f.verifiedAt })));
}

export function buildContext(
  data: TripData,
  opts: { today: string; profile?: Profile; coverage?: unknown; rules?: RulesContent },
): RuleContext {
  return {
    trip: data.meta,
    stays: data.stays,
    bookings: data.bookings,
    days: data.days,
    profile: opts.profile ?? { flags: {} },
    coverage: CoverageSummary.parse(opts.coverage ?? {}),
    today: opts.today,
    rules: opts.rules ?? rulesContent,
    countries: countriesFromContent(),
    facts: contentFacts(),
  };
}
