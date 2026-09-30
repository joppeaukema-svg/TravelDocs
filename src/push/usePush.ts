import { useEffect, useMemo } from 'react';
import { useRules } from '../rules/useRules';
import { usePrepStates } from '../trip/store';
import { syncPush, usePushState } from './push';
import { buildPushSchedule, type PushEntry } from './schedule';

/** The push schedule for the current trip and checklist state. */
export function usePushSchedule(): PushEntry[] {
  const rules = useRules();
  const states = usePrepStates();
  return useMemo(() => {
    if (!rules) return [];
    return buildPushSchedule(
      rules.result.prep,
      states,
      rules.result.stays.map((s) => s.stay.id),
      (c) => rules.itinerary.countryName(c),
    );
  }, [rules, states]);
}

/** Keeps the push server's schedule in step with the trip, when notifications are on. */
export function usePushSync(): void {
  const state = usePushState();
  const schedule = usePushSchedule();
  const on = !!state;
  useEffect(() => {
    if (!on || !navigator.onLine) return;
    const t = setTimeout(() => void syncPush(schedule), 2000);
    return () => clearTimeout(t);
  }, [on, schedule]);
}
