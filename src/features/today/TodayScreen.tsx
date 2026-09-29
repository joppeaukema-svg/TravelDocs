import { useLiveQuery } from 'dexie-react-hooks';
import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { Temporal } from 'temporal-polyfill';
import { useNow, useVaultState } from '../../app/hooks';
import { backupIsDue } from '../../backup/backup';
import { allCountries, getCountry } from '../../content';
import { db, getMeta, META } from '../../db/db';
import { DOC_TYPE_LABELS, DocType } from '../../docs/docs';
import { parseCard } from '../../emergency/card';
import { clock, daysBetween, formatDate, formatDateTime, plural, todayIn } from '../../lib/format';
import { readCoverageSummary } from '../../profile/insurance';
import { updateSettings, useSettings } from '../../settings/settings';
import { CheckIcon } from '../../ui/icons';
import { Card, cx, LinkButton, Notice, PageTitle, SectionTitle } from '../../ui/kit';
import { addDays } from '../../rules/itinerary';
import { itemStatus } from '../../rules/status';
import { useCurrentCountry, useRules } from '../../rules/useRules';
import { BOOKING_TYPE_LABELS, bookingLabel } from '../../trip/schema';
import { usePrepStates, useTrip } from '../../trip/store';
import { formatLocal, toInstant, zoneCity } from '../../trip/time';
import { CheckCard, PrepItemRow, StayCard } from '../trip/parts';

const HOME_TZ = 'Europe/Amsterdam';

function subscribeDisplayMode(cb: () => void) {
  const mq = window.matchMedia('(display-mode: standalone)');
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}

function useInstalled(): boolean {
  return useSyncExternalStore(
    subscribeDisplayMode,
    () =>
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true,
  );
}

function CountryPicker({ onPicked }: { onPicked?: () => void }) {
  const { countryOverride } = useSettings();
  return (
    <div className="flex flex-wrap gap-2">
      {allCountries().map((c) => (
        <button
          key={c.country}
          type="button"
          onClick={() => void updateSettings({ countryOverride: c.country }).then(onPicked)}
          className={cx('min-h-11 rounded-full border px-4 font-bold', c.country === countryOverride ? 'border-ink bg-ink text-paper' : 'border-line bg-paper')}
        >
          {c.name}
        </button>
      ))}
    </div>
  );
}

function CountryClock() {
  const current = useCurrentCountry();
  const trip = useTrip();
  const now = useNow();
  const [picking, setPicking] = useState(false);
  const country = getCountry(current.code);
  const home = clock(HOME_TZ, now);

  if (!country) {
    return (
      <Card>
        <p className="font-bold">{trip ? 'Not travelling today' : 'Where are you now?'}</p>
        <p className="mb-3 text-muted">
          {trip ? 'Pick a country to see its time and emergency numbers anyway.' : 'Once you import your trip this follows your itinerary.'}
        </p>
        <CountryPicker />
      </Card>
    );
  }

  const local = clock(country.timeZone, now);
  return (
    <Card className="relative overflow-hidden">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.12em] text-muted">You are in</p>
          <p className="text-2xl font-bold">{country.name}</p>
          <p className="tabular mt-2 text-5xl font-bold tracking-tight">{local.time}</p>
          <p className="text-muted">{local.day}</p>
        </div>
        <span className="mt-1 rotate-[-6deg] rounded-lg border-[3px] border-accent px-2 py-1 font-mono text-xl font-medium text-accent">
          {country.country}
        </span>
      </div>
      <div className="mt-4 flex items-center justify-between border-t border-dashed border-line pt-3">
        <p>
          <span className="text-muted">Netherlands</span>{' '}
          <span className="tabular font-bold">{home.time}</span> <span className="text-muted">{home.day}</span>
        </p>
        {current.auto ? (
          <button type="button" className="min-h-11 px-2 font-bold text-accent" onClick={() => setPicking(!picking)}>
            Change
          </button>
        ) : (
          <button type="button" className="min-h-11 px-2 font-bold text-accent" onClick={() => void updateSettings({ countryOverride: null })}>
            {trip ? 'Follow trip' : 'Change'}
          </button>
        )}
      </div>
      <p className="text-sm text-muted">{current.auto ? 'From your itinerary.' : 'Set by hand.'}</p>
      {picking && (
        <div className="mt-3">
          <CountryPicker onPicked={() => setPicking(false)} />
        </div>
      )}
    </Card>
  );
}

function TripToday() {
  const rules = useRules();
  const states = usePrepStates();
  const now = useNow();
  if (rules === undefined) return null;
  if (rules === null) {
    return (
      <div className="mt-4">
        <Notice title="Import your itinerary" action={<LinkButton href="#/trip">Go to Trip</LinkButton>}>
          Stay counters, the next booking, entry-rule checks and prep reminders come from your trip file.
        </Notice>
      </div>
    );
  }
  const { result, today, data } = rules;
  const current = result.stays.find((s) => s.daysUsed !== undefined && !s.synthetic);
  const nowInstant = Temporal.Instant.fromEpochMilliseconds(now.getTime());
  const next = data.bookings
    .filter((b) => b.depart && b.status !== 'idea')
    .map((b) => ({ b, when: toInstant(b.depart!) ?? Temporal.PlainDate.from(b.depart!.date).toZonedDateTime({ timeZone: b.depart!.tz, plainTime: '23:59' }).toInstant() }))
    .filter((x) => Temporal.Instant.compare(x.when, nowInstant) >= 0)
    .sort((a, c) => Temporal.Instant.compare(a.when, c.when))[0]?.b;
  const due = result.prep.filter((p) => ['overdue', 'do-now'].includes(itemStatus(p, states.get(p.id), today)));
  const soonLimit = addDays(today, 7);
  const soon = result.prep.filter((p) => itemStatus(p, states.get(p.id), today) === 'upcoming' && p.remindOn <= soonLimit);
  const important = result.checks.filter((c) => c.severity !== 'info');

  return (
    <>
      {current && (
        <>
          <SectionTitle>Stay</SectionTitle>
          <StayCard status={current} countryName={rules.itinerary.countryName(current.stay.country)} />
        </>
      )}
      {next && (
        <>
          <SectionTitle>Next</SectionTitle>
          <a href={`#/trip/booking/${encodeURIComponent(next.id)}`} className="block rounded-2xl border border-line bg-card p-4 text-ink no-underline active:bg-sunk">
            <p className="text-sm font-bold uppercase tracking-wide text-muted">
              {BOOKING_TYPE_LABELS[next.type]} · {next.status}
            </p>
            <p className="text-lg font-bold">{bookingLabel(next)}</p>
            <p>
              {formatLocal(next.depart!)} <span className="text-muted">{zoneCity(next.depart!.tz)}</span>
            </p>
            {next.confirmation && <p className="mt-1 font-mono">{next.confirmation}</p>}
            {next.documentIds.length > 0 && <p className="mt-1 font-bold text-accent">Ticket attached — tap to show</p>}
          </a>
        </>
      )}
      <SectionTitle action={<a href="#/checklists" className="text-sm font-bold">All checklists</a>}>Due now</SectionTitle>
      {due.length ? (
        <Card className="py-1">
          <ul>
            {due.slice(0, 8).map((p) => (
              <PrepItemRow key={p.id} item={p} state={states.get(p.id)} today={today} />
            ))}
          </ul>
          {due.length > 8 && (
            <a href="#/checklists" className="block py-2 text-center font-bold">
              {due.length - 8} more
            </a>
          )}
        </Card>
      ) : (
        <Notice tone="ok" title="Nothing due right now" />
      )}
      {soon.length > 0 && (
        <>
          <SectionTitle>Coming up this week</SectionTitle>
          <Card className="py-1">
            <ul>
              {soon.map((p) => (
                <PrepItemRow key={p.id} item={p} state={states.get(p.id)} today={today} />
              ))}
            </ul>
          </Card>
        </>
      )}
      {important.length > 0 && (
        <>
          <SectionTitle>Checks</SectionTitle>
          <div className="space-y-2">
            {important.map((c) => (
              <CheckCard key={c.id} check={c} />
            ))}
          </div>
        </>
      )}
    </>
  );
}

function Warnings() {
  const vault = useVaultState();
  const last = useLiveQuery(() => db.meta.get(META.lastBackupAt), [])?.value as string | undefined;
  const docs = useLiveQuery(() => db.docs.where('expiresAt').above('').toArray(), []);
  const today = todayIn(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const items: ReactNode[] = [];

  if (vault !== 'none' && vault !== 'loading' && backupIsDue(last)) {
    items.push(
      <Notice
        key="backup"
        tone="warn"
        title={last ? 'Backup is more than a week old' : 'Make your first backup'}
        action={<LinkButton href="#/backup">Back up now</LinkButton>}
      >
        {last ? `Last one: ${formatDateTime(last)}.` : 'If this phone is lost, a backup file is the only way back.'}
      </Notice>,
    );
  }
  for (const d of docs ?? []) {
    const days = daysBetween(today, d.expiresAt!);
    if (days > 90) continue;
    const label = DOC_TYPE_LABELS[DocType.catch('other').parse(d.type)];
    items.push(
      <Notice
        key={d.id}
        tone={days < 0 ? 'crit' : 'warn'}
        title={days < 0 ? `${label} has expired` : `${label} expires in ${plural(days, 'day')}`}
        action={<LinkButton href={`#/docs/${d.id}`}>Open</LinkButton>}
      >
        {formatDate(d.expiresAt!)}
      </Notice>,
    );
  }
  if (!items.length) return null;
  return (
    <>
      <SectionTitle>Needs attention</SectionTitle>
      <div className="space-y-2">{items}</div>
    </>
  );
}

function SetupSteps() {
  const vault = useVaultState();
  const installed = useInstalled();
  const facts = useLiveQuery(async () => {
    const [passports, profile, card, last] = await Promise.all([
      db.docs.where('type').equals('passport').count(),
      getMeta(META.profile),
      getMeta(META.emergencyCard),
      getMeta(META.lastBackupAt),
    ]);
    return {
      passport: passports > 0,
      insurance: readCoverageSummary(profile).entered,
      card: !!parseCard(card).updatedAt,
      backup: !!last,
    };
  }, []);
  if (!facts) return null;

  const steps = [
    { done: vault !== 'none', label: 'Create your vault', href: '#/docs' },
    { done: facts.passport, label: 'Add your passport', href: '#/docs/new' },
    { done: facts.insurance, label: 'Enter your insurance', href: '#/insurance' },
    { done: facts.card, label: 'Set up the emergency card', href: '#/personal' },
    { done: facts.backup, label: 'Make a first backup', href: '#/backup' },
    { done: installed, label: 'Add the app to your home screen', href: '#/today' },
  ];
  if (steps.every((s) => s.done)) return null;

  return (
    <>
      <SectionTitle>Get ready</SectionTitle>
      <Card className="py-1">
        <ol>
          {steps.map((s) => (
            <li key={s.label} className="border-b border-line last:border-b-0">
              <a href={s.href} className="flex min-h-12 items-center gap-3 py-2 text-ink no-underline">
                <span
                  className={cx(
                    'grid h-7 w-7 shrink-0 place-items-center rounded-full border-2',
                    s.done ? 'border-ok bg-ok text-card' : 'border-line',
                  )}
                >
                  {s.done && <CheckIcon size={16} />}
                </span>
                <span className={s.done ? 'text-muted line-through' : 'font-bold'}>{s.label}</span>
              </a>
            </li>
          ))}
        </ol>
      </Card>
      {!installed && (
        <p className="mt-2 text-sm text-muted">
          iPhone: Safari → Share → Add to Home Screen. Android: Chrome menu → Add to Home screen / Install app.
        </p>
      )}
    </>
  );
}

export function TodayScreen() {
  return (
    <>
      <PageTitle>Today</PageTitle>
      <CountryClock />
      <TripToday />
      <Warnings />
      <SetupSteps />
    </>
  );
}
