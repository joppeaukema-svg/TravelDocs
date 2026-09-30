import { useEffect, useMemo, useState } from 'react';
import { useNow, useOnline } from '../../app/hooks';
import { getCountry } from '../../content';
import { formatDate, formatDateTime } from '../../lib/format';
import { useToday } from '../../rules/useRules';
import { updateSettings, useSettings } from '../../settings/settings';
import { useTrip } from '../../trip/store';
import { Button, Card, LinkButton, Notice, PageTitle, SectionTitle, Toggle } from '../../ui/kit';
import { clearForecasts, currentAndNext, describe, refreshForecasts, stops, useForecasts, type Forecast, type Stop } from '../../weather/weather';
import { FactList } from '../content/Facts';

const STALE_MS = 3 * 3600_000;

/** The current and next stop, refreshed when stale and online. */
function useStopForecasts(): { list: Stop[]; forecasts: (Forecast | undefined)[] | undefined; refresh: () => Promise<string[]> } {
  const trip = useTrip();
  const today = useToday();
  const { weather } = useSettings();
  const online = useOnline();
  const list = useMemo(() => (trip ? currentAndNext(stops(trip), today) : []), [trip, today]);
  const forecasts = useForecasts(list);
  const now = useNow(60_000).getTime();
  const stale = forecasts?.some((f) => !f || now - Date.parse(f.fetchedAt) > STALE_MS);
  useEffect(() => {
    if (weather && online && stale && list.length) void refreshForecasts(list);
  }, [weather, online, stale, list]);
  return { list, forecasts, refresh: () => refreshForecasts(list) };
}

function ForecastTable({ f, days = 7 }: { f: Forecast; days?: number }) {
  return (
    <ul>
      {f.days.slice(0, days).map((d) => {
        const w = describe(d.code);
        return (
          <li key={d.date} className="flex items-center gap-3 border-b border-line py-2 last:border-b-0">
            <span className="w-24 shrink-0 text-sm text-muted">{formatDate(d.date)}</span>
            <span className="text-xl" aria-hidden="true">
              {w.icon}
            </span>
            <span className="min-w-0 flex-1 truncate">{w.label}</span>
            {d.rain !== null && <span className="text-sm text-info">{d.rain}%</span>}
            <span className="tabular w-20 text-right font-bold">
              {d.max}° <span className="font-normal text-muted">{d.min}°</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Compact card for Today: today and tomorrow where you are. */
export function WeatherCard() {
  const { weather } = useSettings();
  const { list, forecasts } = useStopForecasts();
  if (!weather || !list.length || !forecasts?.[0]) return null;
  const f = forecasts[0];
  return (
    <a href="#/weather" className="block text-ink no-underline">
      <Card>
        <p className="font-bold">Weather · {f.place}</p>
        <ForecastTable f={f} days={2} />
        <p className="mt-1 text-sm text-muted">Updated {formatDateTime(f.fetchedAt)}</p>
      </Card>
    </a>
  );
}

export function WeatherScreen() {
  const { weather } = useSettings();
  const online = useOnline();
  const { list, forecasts, refresh } = useStopForecasts();
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const countries = [...new Set(list.map((s) => s.country))];

  return (
    <>
      <PageTitle sub="7-day forecast for where you are and your next stop.">Weather</PageTitle>
      <Card>
        <Toggle
          label="Weather forecasts"
          hint="Sends the names of your current and next stop (no dates, nothing else) to Open-Meteo, a free service without accounts."
          checked={weather}
          onChange={(v) => void updateSettings({ weather: v }).then(() => (v ? undefined : clearForecasts()))}
        />
      </Card>

      {weather && !list.length && <Notice title="No stops yet">Import your trip (with places per day) to get forecasts.</Notice>}

      {weather &&
        list.map((s, i) => {
          const f = forecasts?.[i];
          return (
            <section key={`${s.country}:${s.place}`}>
              <SectionTitle>
                {i === 0 ? 'Now' : 'Next'} · {s.place}, {getCountry(s.country)?.name ?? s.country}
              </SectionTitle>
              <Card className="py-1">
                {f ? (
                  <>
                    <ForecastTable f={f} />
                    <p className="py-2 text-sm text-muted">
                      {f.matched} · updated {formatDateTime(f.fetchedAt)}
                      {!online && ' · offline'}
                    </p>
                  </>
                ) : (
                  <p className="py-3 text-muted">{online ? 'Loading…' : 'No forecast stored yet — connect once.'}</p>
                )}
              </Card>
              {i === 1 && <p className="mt-1 text-sm text-muted">From {formatDate(s.from)} — a forecast only reaches 7 days ahead.</p>}
            </section>
          );
        })}

      {weather && list.length > 0 && (
        <Button
          className="mt-3 w-full"
          disabled={!online || busy}
          onClick={() => {
            setBusy(true);
            void refresh()
              .then(setErrors)
              .finally(() => setBusy(false));
          }}
        >
          {busy ? 'Refreshing…' : 'Refresh'}
        </Button>
      )}
      {errors.map((e) => (
        <p key={e} className="mt-2 text-sm text-warn">
          {e}
        </p>
      ))}

      {countries.length > 0 && (
        <>
          <SectionTitle>Seasons</SectionTitle>
          <FactList facts={countries.flatMap((c) => getCountry(c)?.facts.filter((f) => f.topic === 'weather') ?? [])} />
        </>
      )}
      <LinkButton href="https://open-meteo.com" external variant="ghost" className="mt-3 w-full">
        Weather data by Open-Meteo.com
      </LinkButton>
    </>
  );
}
