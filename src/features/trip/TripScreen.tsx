import { useRef, useState } from 'react';
import { getCountry } from '../../content';
import { formatDate, formatDayRange, plural } from '../../lib/format';
import { shareFile } from '../../lib/share';
import { buildIcs } from '../../rules/ics';
import { rulesContent } from '../../rules/content';
import { diffDays } from '../../rules/itinerary';
import { useRules, type Rules } from '../../rules/useRules';
import { exportTripFile, parseTripFile, TripFileError, type ImportResult, type TripData } from '../../trip/io';
import { checksByLeg, holidaysOn, tripLegs } from '../../trip/days';
import { applyTripUpdate, deleteTrip, loadTrip, replaceTrip } from '../../trip/store';
import { isTripUpdate, parseTripUpdate, planTripUpdate, type UpdatePlan } from '../../trip/update';
import { bookingsOn, dateRanges, nightsWithoutBed } from '../../trip/timeline';
import { beginExternalPick, endExternalPick } from '../../vault/autoLock';
import { ChevronRightIcon, DownloadIcon, PlusIcon, UploadIcon } from '../../ui/icons';
import { Button, Card, ErrorText, LinkButton, Notice, PageTitle, Pill, SectionTitle } from '../../ui/kit';
import { DayRow } from './DayRow';
import { CheckCard } from './parts';
import { useTripCode } from './SharePanel';

export function TripScreen() {
  const rules = useRules();
  // Kept here so the report survives the switch from the import screen to the trip.
  const [report, setReport] = useState<ImportResult | null>(null);
  if (rules === undefined) return null;
  if (rules === null) {
    return (
      <>
        <PageTitle sub="Import your itinerary to get stay counters, entry checks and prep reminders.">Trip</PageTitle>
        <ImportPanel onImported={setReport} />
        <div className="mt-4">
          <Notice title="Travelling together?" action={<LinkButton href="#/together">Travelling together</LinkButton>}>
            If your travel companion already has the trip, receive it from them instead: More → Travelling together.
          </Notice>
        </div>
      </>
    );
  }
  return (
    <>
      {report && (
        <div className="mb-3">
          <ImportReport result={report} onClose={() => setReport(null)} />
        </div>
      )}
      <TripView rules={rules} />
    </>
  );
}

export function ImportReport({ result, onClose }: { result: ImportResult; onClose: () => void }) {
  return (
    <Notice
      tone={result.rejected.length ? 'warn' : 'ok'}
      title={`Imported ${plural(result.data.stays.length, 'stay')}, ${plural(result.data.bookings.length, 'booking')}, ${plural(result.data.days.length, 'day')}`}
      action={
        <Button variant="ghost" className="min-h-10 px-0" onClick={onClose}>
          Dismiss
        </Button>
      }
    >
      {result.rejected.length > 0 && (
        <>
          <p className="mt-1">Not imported:</p>
          <ul className="ml-4 list-disc">
            {result.rejected.map((r, i) => (
              <li key={i}>
                <strong>{r.where}</strong>: {r.reason}
              </li>
            ))}
          </ul>
        </>
      )}
    </Notice>
  );
}

async function readJson(file: File): Promise<unknown> {
  try {
    return JSON.parse(await file.text());
  } catch {
    throw new TripFileError('That file is not valid JSON.');
  }
}

const FIELD_LABELS: Record<string, string> = {
  depart: 'departure',
  arrive: 'arrival',
  from: 'from',
  to: 'to',
  status: 'status',
  title: 'title',
  provider: 'airline/provider',
  confirmation: 'reference',
  note: 'note',
  type: 'type',
  entry: 'entry point',
  exit: 'exit point',
  place: 'place',
  country: 'country',
  sameTicketAs: 'same ticket',
};

function UpdatePreview({ plan, onApply, onCancel }: { plan: UpdatePlan; onApply: () => void; onCancel: () => void }) {
  const kinds = { booking: 'Booking', stay: 'Stay', day: 'Day' } as const;
  return (
    <div className="space-y-3">
      <p className="font-bold">
        {plan.title ?? 'Update'}: {plural(plan.changes.length, 'change')}
        {plan.unchanged > 0 && <span className="font-normal text-muted"> · {plan.unchanged} already up to date</span>}
      </p>
      <ul className="space-y-1.5" aria-label="Changes">
        {plan.changes.map((c) => (
          <li key={`${c.kind}:${c.key}`} className="flex items-start gap-2">
            <Pill tone={c.action === 'add' ? 'ok' : 'info'}>{c.action === 'add' ? 'New' : 'Changed'}</Pill>
            <span className="min-w-0">
              <span className="block font-bold">{c.label}</span>
              <span className="block text-sm text-muted">
                {kinds[c.kind]}
                {c.action === 'update' && ` · ${c.fields.map((f) => FIELD_LABELS[f] ?? f).join(', ')}`}
              </span>
            </span>
          </li>
        ))}
      </ul>
      {plan.problems.length > 0 && (
        <Notice tone="warn" title="Left out">
          <ul className="ml-4 list-disc">
            {plan.problems.map((p, i) => (
              <li key={i}>
                <strong>{p.where}</strong>: {p.reason}
              </li>
            ))}
          </ul>
        </Notice>
      )}
      <p className="text-sm text-muted">Only these items change; the rest of your trip, your notes and checklists stay as they are.</p>
      <div className="grid grid-cols-2 gap-2">
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="primary" disabled={!plan.changes.length} onClick={onApply}>
          Apply {plural(plan.changes.length, 'change')}
        </Button>
      </div>
    </div>
  );
}

export function ImportPanel({ replacing, onImported }: { replacing?: boolean; onImported: (r: ImportResult) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<UpdatePlan | null>(null);
  const [updated, setUpdated] = useState<number | null>(null);
  const linked = !!useTripCode();

  async function apply(r: ImportResult) {
    if (replacing && !window.confirm('Replace the current trip with this one? Your edits to the current trip are lost.')) return;
    await replaceTrip(r.data);
    onImported(r);
    window.scrollTo(0, 0);
  }

  async function onFile(f: File) {
    setError('');
    setBusy(true);
    setUpdated(null);
    try {
      const json = await readJson(f);
      if (isTripUpdate(json)) {
        const trip = await loadTrip();
        if (!trip) throw new TripFileError('This is an update for a trip that is already in the app. Import the trip itself first.');
        setPlan(planTripUpdate(trip, parseTripUpdate(json)));
        return;
      }
      await apply(parseTripFile(json));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function loadDemo() {
    const demo = (await import('../../../demo/trip.demo.json')).default;
    await apply(parseTripFile(demo));
  }

  if (plan) {
    return (
      <Card>
        <UpdatePreview
          plan={plan}
          onCancel={() => setPlan(null)}
          onApply={() =>
            void applyTripUpdate(plan).then((n) => {
              setPlan(null);
              setUpdated(n);
            })
          }
        />
      </Card>
    );
  }

  return (
    <Card>
      {updated !== null && (
        <div className="mb-3">
          <Notice tone="ok" title={`Trip updated: ${plural(updated, 'change')}`}>
            {linked
              ? 'Now send it to your travel companion with Send trip, at the top of this screen.'
              : 'Checks, checklists and reminders now follow the new details.'}
          </Notice>
        </div>
      )}
      <p>
        {replacing ? (
          <>
            An <strong>update file</strong> changes only what it lists (new flight times, a confirmed booking) and keeps the rest. A{' '}
            <strong>trip file</strong> (<code className="font-mono text-sm">my-trip.json</code>) replaces the whole trip.
          </>
        ) : (
          <>
            Choose your <code className="font-mono text-sm">my-trip.json</code> (format{' '}
            <code className="font-mono text-sm">travel-companion-trip/1</code>). It stays on this phone.
          </>
        )}
      </p>
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        hidden
        data-testid="trip-input"
        onChange={(e) => {
          endExternalPick();
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void onFile(f);
        }}
      />
      <Button
        variant="primary"
        className="mt-3 w-full"
        disabled={busy}
        onClick={() => {
          beginExternalPick();
          input.current?.click();
        }}
      >
        <UploadIcon /> {replacing ? 'Choose file' : 'Import trip file'}
      </Button>
      {!replacing && (
        <Button className="mt-2 w-full" onClick={() => void loadDemo()}>
          Try the demo trip
        </Button>
      )}
      <ErrorText>{error}</ErrorText>
    </Card>
  );
}

function TripView({ rules }: { rules: Rules }) {
  const { data } = rules;
  const tripDays = diffDays(data.meta.depart, data.meta.return) + 1;
  const noBed = nightsWithoutBed(data);

  return (
    <>
      <PageTitle sub={`${formatDate(data.meta.depart)} – ${formatDate(data.meta.return)} · ${tripDays} days door to door`}>
        {data.meta.title} {data.meta.demo && <Pill tone="info">Demo</Pill>}
      </PageTitle>

      <SectionTitle action={<a href="#/trip/booking/new" className="inline-flex items-center gap-1 text-sm font-bold"><PlusIcon size={16} /> Booking</a>}>
        Day by day
      </SectionTitle>
      <DayByDay rules={rules} />

      <SectionTitle>Gaps</SectionTitle>
      <Card>
        <p className="font-bold">{noBed.length ? `${plural(noBed.length, 'night')} without accommodation booked` : 'Every night has a bed'}</p>
        {noBed.length > 0 && (
          <p className="mt-1 text-sm text-muted">
            {dateRanges(noBed)
              .map(([a, b]) => (a === b ? formatDate(a) : `${formatDate(a)} – ${formatDate(b)}`))
              .join(' · ')}
          </p>
        )}
      </Card>

      <SectionTitle>Reminders</SectionTitle>
      <CalendarPanel rules={rules} />
    </>
  );
}

const LEG_TITLES = { departure: 'Leaving home', return: 'Back home', between: 'On the way' } as const;

/** One fold per country: its checks, then every day with the plan, holidays, notes and bookings. */
function DayByDay({ rules }: { rules: Rules }) {
  const { data, result, today, itinerary } = rules;
  const days = new Map(data.days.map((d) => [d.date, d]));
  const legs = tripLegs(data.meta, itinerary.stays, (date) => days.get(date)?.country);
  const checks = checksByLeg(legs, result.checks, itinerary.stays);
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      {legs.map((leg) => {
        const name = leg.kind === 'stay' ? itinerary.countryName(leg.country) : LEG_TITLES[leg.kind];
        const legChecks = checks.get(leg.key) ?? [];
        const attention = legChecks.filter((c) => c.severity !== 'info');
        const places = leg.stay?.places.join(' · ') ?? '';
        return (
          <details key={leg.key} open={leg.from <= today && today <= leg.to} className="group rounded-2xl border border-line bg-card">
            <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 py-2.5 [&::-webkit-details-marker]:hidden">
              <span className="rounded-md border-2 border-ink px-1.5 font-mono text-sm font-medium leading-6">{leg.country}</span>
              <span className="min-w-0 flex-1">
                <span className="block font-bold">{name}</span>
                <span className="block truncate text-sm text-muted">
                  {formatDayRange(leg.from, leg.to)}
                  {places && ` · ${places}`}
                </span>
              </span>
              {attention.length > 0 && (
                <Pill tone={attention.some((c) => c.severity === 'critical') ? 'crit' : 'warn'}>{attention.length} to check</Pill>
              )}
              <ChevronRightIcon size={18} className="shrink-0 text-muted transition group-open:rotate-90" />
            </summary>
            {legChecks.length > 0 && (
              <div className="space-y-2 border-t border-line px-3 py-3">
                <p className="px-1 text-xs font-bold uppercase tracking-[0.12em] text-muted">To check</p>
                {legChecks.map((c) => (
                  <CheckCard key={c.id} check={c} />
                ))}
              </div>
            )}
            <ol className="border-t border-line px-4 py-1" aria-label={`${name}, day by day`}>
              {leg.dates.map((date) => {
                const id = `${leg.key}|${date}`;
                return (
                  <DayRow
                    key={date}
                    date={date}
                    country={leg.country}
                    day={days.get(date)}
                    bookings={bookingsOn(data, date)}
                    holidays={holidaysOn(rulesContent.holidays, leg.country, leg.stay?.places ?? [], date)}
                    isToday={date === today}
                    editing={editing === id}
                    onEdit={(on) => setEditing(on ? id : null)}
                  />
                );
              })}
            </ol>
            {(leg.stay || getCountry(leg.country)) && (
              <div className="flex flex-wrap gap-x-5 border-t border-line px-4 py-2.5 text-sm font-bold">
                {getCountry(leg.country) && <a href={`#/countries/${leg.country}`}>{itinerary.countryName(leg.country)} guide</a>}
                {leg.stay && <a href={`#/trip/stay/${encodeURIComponent(leg.stay.id)}`}>Edit stay</a>}
              </div>
            )}
          </details>
        );
      })}
    </div>
  );
}

/** Writes the trip as a my-trip.json file (to keep, or to give to a travel companion). */
export async function exportTrip(data: TripData) {
  const json = JSON.stringify(exportTripFile(data), null, 2);
  await shareFile(new Blob([json], { type: 'application/json' }), 'my-trip.json');
}

function CalendarPanel({ rules }: { rules: Rules }) {
  const { data, result, itinerary } = rules;

  async function exportCalendar() {
    const appUrl = `${window.location.origin}${window.location.pathname}`;
    const countryNames = new Map(data.stays.map((s) => [s.country, getCountry(s.country)?.name ?? itinerary.countryName(s.country)]));
    const ics = buildIcs(result.prep, data.bookings, { appUrl, countryNames });
    await shareFile(new Blob([ics], { type: 'text/calendar' }), 'trip-prep.ics');
  }

  return (
    <Card>
      <Button variant="primary" className="w-full" onClick={() => void exportCalendar()}>
        <DownloadIcon /> Calendar with prep reminders (.ics)
      </Button>
      <p className="mt-2 text-sm text-muted">
        One event per prep moment with an alarm, at the local time where you'll be, never between 22:00 and 08:00. Import it into a
        separate calendar (e.g. “Trip prep”). When the plan changes: delete that calendar and import the new file.
      </p>
      <LinkButton href="#/checklists" className="mt-3 w-full">
        Prep checklists and checks
      </LinkButton>
      <Button
        variant="ghost"
        className="mt-1 w-full text-crit"
        onClick={async () => {
          if (window.confirm('Delete the trip from this phone? Documents stay.')) await deleteTrip();
        }}
      >
        Delete trip
      </Button>
    </Card>
  );
}
