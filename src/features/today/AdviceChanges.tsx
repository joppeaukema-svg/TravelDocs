import { getCountry } from '../../content';
import { adviceState, useAdvice, useAdviceSeen } from '../../live/useLive';
import { formatDate } from '../../lib/format';
import { useToday } from '../../rules/useRules';
import { useTrip } from '../../trip/store';
import { LinkButton, Notice } from '../../ui/kit';

/** Flags travel advice that changed since you last read it, for the countries still ahead of you. */
export function AdviceChanges() {
  const trip = useTrip();
  const today = useToday();
  const advice = useAdvice();
  const seen = useAdviceSeen();
  if (!trip || !advice || !seen) return null;
  const ahead = new Set(trip.stays.filter((s) => s.to >= today).map((s) => s.country));
  const changed = advice.countries.filter((a) => ahead.has(a.country) && adviceState(a, seen) === 'changed');
  if (!changed.length) return null;
  return (
    <div className="mt-3 space-y-2">
      {changed.map((a) => (
        <Notice
          key={a.country}
          tone="warn"
          title={`Travel advice for ${getCountry(a.country)?.name ?? a.country} changed`}
          action={
            <LinkButton href={`#/countries/${a.country}/safety`} className="w-full">
              Read what changed
            </LinkButton>
          }
        >
          Updated {formatDate(a.lastModified.slice(0, 10))}, after you last read it.
        </Notice>
      ))}
    </div>
  );
}
