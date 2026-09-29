import { useMemo } from 'react';
import { useNow } from '../app/hooks';
import { todayIn } from '../lib/format';
import { readCoverageSummary } from '../profile/insurance';
import { parseProfile, usePassportExpiry, useProfileRaw } from '../profile/profile';
import { useSettings } from '../settings/settings';
import type { TripData } from '../trip/io';
import { useTrip } from '../trip/store';
import { buildContext, countriesFromContent } from './context';
import { runRules } from './engine';
import { Itinerary } from './itinerary';
import { rulesContent } from './content';
import type { RuleResult } from './types';

export const phoneTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

export function useToday(): string {
  const now = useNow(60_000);
  return useMemo(() => todayIn(phoneTimeZone()), [now]); // eslint-disable-line react-hooks/exhaustive-deps
}

export interface Rules {
  data: TripData;
  result: RuleResult;
  today: string;
  itinerary: Itinerary;
}

/** The rules engine over the stored trip. undefined while loading, null without a trip. */
export function useRules(): Rules | null | undefined {
  const trip = useTrip();
  const raw = useProfileRaw();
  const { profile } = parseProfile(raw);
  const passportExpiry = usePassportExpiry(profile.passportExpiry);
  const today = useToday();
  return useMemo(() => {
    if (!trip) return trip;
    const ctx = buildContext(trip, {
      today,
      profile: { ...profile, ...(passportExpiry ? { passportExpiry } : {}) },
      coverage: readCoverageSummary(raw),
    });
    return { data: trip, result: runRules(ctx), today, itinerary: new Itinerary(ctx) };
  }, [trip, raw, passportExpiry, today]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Where you are now: the manual override, else the itinerary, else nothing. */
export function useCurrentCountry(): { code: string | null; auto: boolean } {
  const { countryOverride } = useSettings();
  const trip = useTrip();
  const today = useToday();
  const hour = new Date().getHours();
  const auto = useMemo(() => {
    if (!trip) return null;
    const it = new Itinerary({
      trip: trip.meta,
      stays: trip.stays,
      bookings: trip.bookings,
      days: trip.days,
      profile: { flags: {} },
      coverage: { entered: false, evacuation: 'unknown', maxDaysPerTrip: null, scooter: 'unknown', diving: 'unknown', divingMaxDepthM: null, trekking: 'unknown' },
      today,
      rules: rulesContent,
      countries: countriesFromContent(),
    });
    const here = it.locationOn(today, hour >= 12).country;
    return here === trip.meta.homeCountry ? null : here;
  }, [trip, today, hour]);
  if (countryOverride) return { code: countryOverride, auto: false };
  return { code: auto, auto: true };
}
