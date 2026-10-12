import { useRef, useState } from 'react';
import { getCountry } from '../../content';
import { formatDate, plural } from '../../lib/format';
import { shareFile } from '../../lib/share';
import { buildIcs } from '../../rules/ics';
import { diffDays, isSynthetic, stayEnd, stayStart } from '../../rules/itinerary';
import { useRules, type Rules } from '../../rules/useRules';
import { exportTripFile, parseTripFile, TripFileError, type ImportResult, type TripData } from '../../trip/io';
import { BOOKING_TYPE_LABELS, bookingLabel } from '../../trip/schema';
import { applyTripUpdate, deleteTrip, loadTrip, replaceTrip } from '../../trip/store';
import { isTripUpdate, parseTripUpdate, planTripUpdate, type UpdatePlan } from '../../trip/update';
import { bookingsOn, dateRanges, nightsWithoutBed } from '../../trip/timeline';
import { formatLocal } from '../../trip/time';
import { beginExternalPick, endExternalPick } from '../../vault/autoLock';
import { DownloadIcon, PlusIcon, UploadIcon } from '../../ui/icons';
import { Button, Card, cx, ErrorText, LinkButton, Notice, PageTitle, Pill, SectionTitle } from '../../ui/kit';
import { StayCard } from './parts';
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
  const { data, result, itinerary } = rules;
  const tripDays = diffDays(data.meta.depart, data.meta.return) + 1;
  const noBed = nightsWithoutBed(data);

  return (
    <>
      <PageTitle sub={`${formatDate(data.meta.depart)} – ${formatDate(data.meta.return)} · ${tripDays} days door to door`}>
        {data.meta.title} {data.meta.demo && <Pill tone="info">Demo</Pill>}
      </PageTitle>

      <SectionTitle>Countries</SectionTitle>
      <div className="space-y-2">
        {result.stays.map((s) => (
          <StayCard key={s.stay.id} status={s} countryName={itinerary.countryName(s.stay.country)} />
        ))}
      </div>

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

      <SectionTitle action={<a href="#/trip/booking/new" className="inline-flex items-center gap-1 text-sm font-bold"><PlusIcon size={16} /> Booking</a>}>
        Timeline
      </SectionTitle>
      <Timeline rules={rules} />

      <SectionTitle>Reminders</SectionTitle>
      <CalendarPanel rules={rules} />
    </>
  );
}

function Timeline({ rules }: { rules: Rules }) {
  const { data, today, itinerary } = rules;
  return (
    <div className="space-y-2">
      {itinerary.stays
        .filter((s) => !isSynthetic(s))
        .map((stay) => {
          const dates = data.days.filter((d) => d.date >= stayStart(stay) && d.date <= stayEnd(stay)).map((d) => d.date);
          const isNow = stayStart(stay) <= today && today <= stayEnd(stay);
          return (
            <details key={stay.id} open={isNow} className="rounded-2xl border border-line bg-card">
              <summary className="flex min-h-12 cursor-pointer items-center gap-2 px-4 py-2 font-bold">
                <span className="font-mono text-sm">{stay.country}</span>
                {itinerary.countryName(stay.country)}
                <span className="ml-auto text-sm font-normal text-muted">
                  {formatDate(stayStart(stay))} – {formatDate(stayEnd(stay))}
                </span>
              </summary>
              <ol className="border-t border-line px-4 py-1">
                {dates.map((date) => {
                  const day = data.days.find((d) => d.date === date);
                  const items = bookingsOn(data, date);
                  return (
                    <li key={date} className={cx('border-b border-line py-2 last:border-b-0', date === today && 'bg-accent-soft -mx-4 px-4')}>
                      <p className="flex gap-2">
                        <span className="tabular w-20 shrink-0 text-sm text-muted">{formatLocal({ date, time: null, tz: 'UTC' })}</span>
                        <span className="font-bold">{day?.place ?? '—'}</span>
                      </p>
                      {day?.note && <p className="ml-22 text-sm text-muted">{day.note}</p>}
                      {items.map((b) => (
                        <a key={b.id} href={`#/trip/booking/${encodeURIComponent(b.id)}`} className="ml-22 mt-1 flex items-center gap-2 text-sm text-ink no-underline">
                          <Pill tone={b.status === 'booked' ? 'ok' : b.status === 'planned' ? 'muted' : 'info'}>{b.status}</Pill>
                          <span className="min-w-0 flex-1 truncate">
                            {b.depart?.time && <span className="tabular font-bold">{b.depart.time} </span>}
                            {BOOKING_TYPE_LABELS[b.type]}: {bookingLabel(b)}
                          </span>
                        </a>
                      ))}
                    </li>
                  );
                })}
              </ol>
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
