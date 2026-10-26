import { useEffect, useMemo, useState } from 'react';
import { useNow, useOnline } from '../../app/hooks';
import { getCountry } from '../../content';
import { clock, formatDate, formatDateTime, formatDayRange, todayIn } from '../../lib/format';
import { useToday } from '../../rules/useRules';
import { updateSettings, useSettings } from '../../settings/settings';
import { useTrip } from '../../trip/store';
import { ChevronRightIcon } from '../../ui/icons';
import { Button, Card, LinkButton, Notice, PageTitle, SectionTitle, Toggle } from '../../ui/kit';
import { clearForecasts, currentAndNext, describe, refreshForecasts, stops, useForecasts, type Forecast, type ForecastHour, type Stop } from '../../weather/weather';
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
  // Forecasts stored before hours were included count as stale, so the hours come in at once.
  const stale = forecasts?.some((f) => !f || now - Date.parse(f.fetchedAt) > STALE_MS || !f.days[0]?.hours);
  useEffect(() => {
    if (weather && online && stale && list.length) void refreshForecasts(list);
  }, [weather, online, stale, list]);
  return { list, forecasts, refresh: () => refreshForecasts(list) };
}

function DayLine({ d }: { d: Forecast['days'][number] }) {
  const w = describe(d.code);
  return (
    <>
      <span className="w-16 shrink-0 text-sm text-muted">{formatDayRange(d.date, d.date)}</span>
      <span className="text-xl" aria-hidden="true">
        {w.icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{w.label}</span>
      {d.rain !== null && <span className="text-sm text-info">{d.rain}%</span>}
      <span className="tabular w-20 text-right font-bold">
        {d.max}° <span className="font-normal text-muted">{d.min}°</span>
      </span>
    </>
  );
}

/** One day's hours; for today, from the current hour at the place on. */
function Hours({ hours, from }: { hours: ForecastHour[]; from?: string | undefined }) {
  const shown = from ? hours.filter((h) => h.time >= from.slice(0, 3) + '00') : hours;
  return (
    <ol className="mb-2 rounded-xl bg-sunk px-3 py-1">
      {shown.map((h) => {
        const w = describe(h.code, h.day);
        return (
          <li key={h.time} className="flex items-center gap-3 border-b border-line py-1.5 text-sm last:border-b-0">
            <span className="tabular w-12 shrink-0 text-muted">{h.time}</span>
            <span className="text-lg" aria-hidden="true">
              {w.icon}
            </span>
            <span className="min-w-0 flex-1 truncate">{w.label}</span>
            {h.rain !== null && <span className="tabular w-10 text-right text-info">{h.rain}%</span>}
            <span className="tabular w-10 text-right font-bold">{h.temp}°</span>
          </li>
        );
      })}
    </ol>
  );
}

/** The days; with `hourly`, each day folds open to its hours. */
function ForecastTable({ f, days = 7, hourly = false }: { f: Forecast; days?: number; hourly?: boolean }) {
  const now = useNow(60_000);
  const today = f.timeZone ? todayIn(f.timeZone, now) : undefined;
  const hourNow = f.timeZone ? clock(f.timeZone, now).time : undefined;
  return (
    <ul>
      {f.days.slice(0, days).map((d) =>
        hourly && d.hours?.length ? (
          <li key={d.date} className="border-b border-line last:border-b-0">
            <details className="group">
              <summary
                className="flex cursor-pointer list-none items-center gap-3 py-2 [&::-webkit-details-marker]:hidden"
                aria-label={`${formatDayRange(d.date, d.date)}, hour by hour`}
              >
                <DayLine d={d} />
                <ChevronRightIcon size={16} className="shrink-0 text-muted transition group-open:rotate-90" />
              </summary>
              <Hours hours={d.hours} from={d.date === today ? hourNow : undefined} />
            </details>
          </li>
        ) : (
          <li key={d.date} className="flex items-center gap-3 border-b border-line py-2 last:border-b-0">
            <DayLine d={d} />
          </li>
        ),
      )}
    </ul>
  );
}

/** Compact card for Today: today and tomorrow where you are. */
export function WeatherCard() {
  const { weather, weatherAsked } = useSettings();
  const online = useOnline();
  const { list, forecasts } = useStopForecasts();
  if (!list.length) return null;
  // Off by default on every phone: it sends place names to Open-Meteo, so it's offered, not switched on.
  if (!weather) {
    if (weatherAsked) return null;
    return (
      <>
        <SectionTitle>Weather</SectionTitle>
        <Card>
          <p className="font-bold">Weather is off on this phone</p>
          <p className="mt-1 text-sm text-muted">
            Turning it on sends the names of your current and next stop (no dates, nothing else) to Open-Meteo, a free service
            without accounts.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button onClick={() => void updateSettings({ weatherAsked: true })}>Not now</Button>
            <Button variant="primary" onClick={() => void updateSettings({ weather: true })}>
              Turn on
            </Button>
          </div>
        </Card>
      </>
    );
  }
  const f = forecasts?.[0];
  if (!f) {
    return (
      <>
        <SectionTitle>Weather</SectionTitle>
        <Card>
          <p className="text-muted">{online ? 'Getting the forecast…' : 'No forecast yet: it downloads when you’re online.'}</p>
        </Card>
      </>
    );
  }
  return (
    <>
      <SectionTitle action={<a href="#/weather" className="text-sm font-bold">7 days</a>}>Weather</SectionTitle>
      <a href="#/weather" className="block text-ink no-underline">
        <Card>
          <p className="font-bold">{f.place}</p>
          <ForecastTable f={f} days={2} />
          <p className="mt-1 text-sm text-muted">Updated {formatDateTime(f.fetchedAt)}</p>
        </Card>
      </a>
    </>
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
                    <ForecastTable f={f} hourly />
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
