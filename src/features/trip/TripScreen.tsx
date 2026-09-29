import { useRef, useState } from 'react';
import { getCountry } from '../../content';
import { formatDate, plural } from '../../lib/format';
import { shareFile } from '../../lib/share';
import { buildIcs } from '../../rules/ics';
import { diffDays, isSynthetic, stayEnd, stayStart } from '../../rules/itinerary';
import { useRules, type Rules } from '../../rules/useRules';
import { exportTripFile, parseTripFile, TripFileError, type ImportResult } from '../../trip/io';
import { BOOKING_TYPE_LABELS, bookingLabel } from '../../trip/schema';
import { deleteTrip, replaceTrip } from '../../trip/store';
import { bookingsOn, dateRanges, nightsWithoutBed } from '../../trip/timeline';
import { formatLocal } from '../../trip/time';
import { beginExternalPick, endExternalPick } from '../../vault/autoLock';
import { DownloadIcon, PlusIcon, UploadIcon } from '../../ui/icons';
import { Button, Card, cx, ErrorText, LinkButton, Notice, PageTitle, Pill, SectionTitle } from '../../ui/kit';
import { CheckCard, StayCard } from './parts';

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
      <TripView rules={rules} onImported={setReport} />
    </>
  );
}

function ImportReport({ result, onClose }: { result: ImportResult; onClose: () => void }) {
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

async function readTripFile(file: File): Promise<ImportResult> {
  let json: unknown;
  try {
    json = JSON.parse(await file.text());
  } catch {
    throw new TripFileError('That file is not valid JSON.');
  }
  return parseTripFile(json);
}

export function ImportPanel({ replacing, onImported }: { replacing?: boolean; onImported: (r: ImportResult) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function apply(r: ImportResult) {
    if (replacing && !window.confirm('Replace the current trip with this one? Your edits to the current trip are lost.')) return;
    await replaceTrip(r.data);
    onImported(r);
    window.scrollTo(0, 0);
  }

  async function onFile(f: File) {
    setError('');
    setBusy(true);
    try {
      await apply(await readTripFile(f));
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

  return (
    <Card>
      <p>
        Choose your <code className="font-mono text-sm">my-trip.json</code> (format <code className="font-mono text-sm">travel-companion-trip/1</code>). It stays on this phone.
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
        <UploadIcon /> {replacing ? 'Import a new version' : 'Import trip file'}
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

function TripView({ rules, onImported }: { rules: Rules; onImported: (r: ImportResult) => void }) {
  const { data, result, itinerary } = rules;
  const tripDays = diffDays(data.meta.depart, data.meta.return) + 1;
  const noBed = nightsWithoutBed(data);
  const stuck = result.checks.filter((c) => c.id.startsWith('onward-none-'));
  const stayChecks = result.checks.filter((c) => c.severity !== 'info');

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

      {stayChecks.length > 0 && (
        <>
          <SectionTitle action={<a href="#/checklists" className="text-sm font-bold">Checklists</a>}>Checks</SectionTitle>
          <div className="space-y-2">
            {stayChecks.map((c) => (
              <CheckCard key={c.id} check={c} />
            ))}
          </div>
        </>
      )}

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
        {stuck.map((c) => (
          <p key={c.id} className="mt-2 font-bold text-crit">
            {c.title}
          </p>
        ))}
      </Card>

      <SectionTitle action={<a href="#/trip/booking/new" className="inline-flex items-center gap-1 text-sm font-bold"><PlusIcon size={16} /> Booking</a>}>
        Timeline
      </SectionTitle>
      <Timeline rules={rules} />

      <SectionTitle>Export and import</SectionTitle>
      <ExportPanel rules={rules} onImported={onImported} />
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

function ExportPanel({ rules, onImported }: { rules: Rules; onImported: (r: ImportResult) => void }) {
  const { data, result, itinerary } = rules;
  const [showImport, setShowImport] = useState(false);

  async function exportCalendar() {
    const appUrl = `${window.location.origin}${window.location.pathname}`;
    const countryNames = new Map(data.stays.map((s) => [s.country, getCountry(s.country)?.name ?? itinerary.countryName(s.country)]));
    const ics = buildIcs(result.prep, data.bookings, { appUrl, countryNames });
    await shareFile(new Blob([ics], { type: 'text/calendar' }), 'trip-prep.ics');
  }

  async function exportTrip() {
    const json = JSON.stringify(exportTripFile(data), null, 2);
    await shareFile(new Blob([json], { type: 'application/json' }), 'my-trip.json');
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
      <Button className="mt-3 w-full" onClick={() => void exportTrip()}>
        <DownloadIcon /> Trip file (my-trip.json)
      </Button>
      {showImport ? (
        <div className="mt-3">
          <ImportPanel replacing onImported={(r) => { setShowImport(false); onImported(r); }} />
        </div>
      ) : (
        <Button variant="ghost" className="mt-2 w-full" onClick={() => setShowImport(true)}>
          Replace with a new trip file
        </Button>
      )}
      <Button
        variant="ghost"
        className="w-full text-crit"
        onClick={async () => {
          if (window.confirm('Delete the trip from this phone? Documents stay.')) await deleteTrip();
        }}
      >
        Delete trip
      </Button>
      <LinkButton href="#/checklists" className="mt-2 w-full">
        Prep checklists
      </LinkButton>
    </Card>
  );
}
