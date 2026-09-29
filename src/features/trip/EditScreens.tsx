import { useLiveQuery } from 'dexie-react-hooks';
import { useState, type FormEvent } from 'react';
import { go } from '../../app/hooks';
import { allCountries } from '../../content';
import { db } from '../../db/db';
import { DOC_TYPE_LABELS, DocType } from '../../docs/docs';
import { formatDate } from '../../lib/format';
import { useRules } from '../../rules/useRules';
import {
  Booking,
  BOOKING_TYPE_LABELS,
  BookingStatus,
  BookingType,
  ENTRY_TYPE_LABELS,
  EntryType,
  Stay,
  TravelMode,
} from '../../trip/schema';
import { deleteBooking, saveBooking, saveStay } from '../../trip/store';
import { durationMinutes, formatDuration, formatLocal, utcOffset, zoneCity } from '../../trip/time';
import { DocsIcon, TrashIcon } from '../../ui/icons';
import { Button, Card, ErrorText, LinkButton, Notice, PageTitle, RowLink, SectionTitle, SelectField, TextArea, TextField } from '../../ui/kit';
import { CheckCard, PrepItemRow } from './parts';
import { usePrepStates } from '../../trip/store';
import { FileViewer } from '../docs/files';
import { useVaultState } from '../../app/hooks';

const ENTRY_OPTIONS = EntryType.options.map((value) => ({ value, label: ENTRY_TYPE_LABELS[value] }));
const MODE_OPTIONS = TravelMode.options.map((value) => ({ value, label: { air: 'By air', land: 'Over land', sea: 'By sea' }[value] }));

function errorText(err: unknown): string {
  if (err && typeof err === 'object' && 'issues' in err) {
    return (err as { issues: { path: PropertyKey[]; message: string }[] }).issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
  }
  return err instanceof Error ? err.message : String(err);
}

export function StayScreen({ id }: { id: string }) {
  const rules = useRules();
  const states = usePrepStates();
  if (!rules) return null;
  const status = rules.result.stays.find((s) => s.stay.id === id);
  if (!status) return <Notice tone="warn" title="This stay no longer exists" action={<LinkButton href="#/trip">Trip</LinkButton>} />;
  const name = rules.itinerary.countryName(status.stay.country);
  const checks = rules.result.checks.filter((c) => c.stayId === id);
  const items = rules.result.prep.filter((p) => p.group === id);

  return (
    <>
      <PageTitle sub={`${formatDate(status.stay.from)} – ${formatDate(status.stay.to)} · ${status.days} days`}>{name}</PageTitle>
      {status.regime && (
        <Card>
          <p className="font-bold">{status.regime.title}</p>
          <p>
            {status.limitDays} days · leave by <strong>{status.mustLeaveBy && formatDate(status.mustLeaveBy)}</strong>
            {status.stay.stampedUntil && ' (from your passport stamp)'}
          </p>
          {status.regime.note && <p className="mt-1 text-sm text-muted">{status.regime.note}</p>}
        </Card>
      )}
      {checks.length > 0 && (
        <div className="mt-3 space-y-2">
          {checks.map((c) => (
            <CheckCard key={c.id} check={c} />
          ))}
        </div>
      )}
      {status.synthetic ? (
        <Notice title="Derived from two flights">Add a real stay to your trip file to edit it.</Notice>
      ) : (
        <StayForm stay={status.stay} />
      )}
      {items.length > 0 && (
        <>
          <SectionTitle>Prep checklist</SectionTitle>
          <Card className="py-1">
            <ul>
              {items.map((p) => (
                <PrepItemRow key={p.id} item={p} state={states.get(p.id)} today={rules.today} />
              ))}
            </ul>
          </Card>
        </>
      )}
    </>
  );
}

function StayForm({ stay }: { stay: Stay }) {
  const [v, setV] = useState(stay);
  const [state, setState] = useState<'idle' | 'saved'>('idle');
  const [error, setError] = useState('');
  const set = (patch: Partial<Stay>) => {
    setState('idle');
    setV({ ...v, ...patch });
  };
  const opt = (s: string) => (s ? s : undefined);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      const next = { ...v, actualFrom: opt(v.actualFrom ?? ''), actualTo: opt(v.actualTo ?? ''), stampedUntil: opt(v.stampedUntil ?? '') };
      for (const k of ['actualFrom', 'actualTo', 'stampedUntil'] as const) if (!next[k]) delete next[k];
      await saveStay(next);
      setState('saved');
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <form onSubmit={submit}>
      <SectionTitle>Entry</SectionTitle>
      <SelectField label="Entry type" value={v.entryType} onChange={(entryType) => set({ entryType })} options={ENTRY_OPTIONS} hint={v.entryNote} />
      <TextField
        label="Valid until (stamped in your passport)"
        type="date"
        value={v.stampedUntil ?? ''}
        onChange={(stampedUntil) => set({ stampedUntil })}
        hint="Always overrides the calculated date."
      />
      <TextField label="Entry point" value={v.entry.point} onChange={(point) => set({ entry: { ...v.entry, point } })} />
      <SelectField label="Arriving" value={v.entry.mode} onChange={(mode) => set({ entry: { ...v.entry, mode } })} options={MODE_OPTIONS} />
      <SectionTitle>Dates</SectionTitle>
      <TextField label="Planned arrival" type="date" value={v.from} onChange={(from) => set({ from })} />
      <TextField label="Planned departure" type="date" value={v.to} onChange={(to) => set({ to })} />
      <TextField label="Actual arrival" type="date" value={v.actualFrom ?? ''} onChange={(actualFrom) => set({ actualFrom })} />
      <TextField label="Actual departure" type="date" value={v.actualTo ?? ''} onChange={(actualTo) => set({ actualTo })} />
      <SectionTitle>Exit</SectionTitle>
      <TextField label="Exit point" value={v.exit.point} onChange={(point) => set({ exit: { ...v.exit, point } })} />
      <SelectField label="Leaving" value={v.exit.mode} onChange={(mode) => set({ exit: { ...v.exit, mode } })} options={MODE_OPTIONS} />
      <ErrorText>{error}</ErrorText>
      <Button type="submit" variant="primary" className="w-full">
        {state === 'saved' ? 'Saved' : 'Save stay'}
      </Button>
    </form>
  );
}

function zoneOptions(current: string[]) {
  const zones = new Set([...allCountries().map((c) => c.timeZone), 'Europe/Amsterdam', ...current.filter(Boolean)]);
  return [...zones].map((z) => ({ value: z, label: `${zoneCity(z)} (${z})` }));
}

type BookingForm = Booking & { cost?: number };

const EMPTY: BookingForm = {
  id: '',
  type: 'flight',
  status: 'planned',
  documentIds: [],
  depart: { date: '', time: null, tz: 'Europe/Amsterdam' },
};

export function BookingScreen({ id }: { id: string }) {
  const isNew = id === 'new';
  const existing = useLiveQuery(async () => (isNew ? null : ((await db.bookings.get(id)) ?? null)), [id]);
  if (existing === undefined) return null;
  if (!isNew && existing === null) {
    return <Notice tone="warn" title="This booking no longer exists" action={<LinkButton href="#/trip">Trip</LinkButton>} />;
  }
  return (
    <>
      <PageTitle>{isNew ? 'New booking' : 'Booking'}</PageTitle>
      <BookingEditor initial={existing ?? { ...EMPTY, id: crypto.randomUUID() }} isNew={isNew} />
    </>
  );
}

function MomentFields({
  label,
  value,
  onChange,
  zones,
}: {
  label: string;
  value: Booking['depart'];
  onChange: (m: Booking['depart']) => void;
  zones: { value: string; label: string }[];
}) {
  const m = value ?? { date: '', time: null, tz: zones[0]!.value };
  return (
    <fieldset className="mb-2">
      <legend className="mb-1 font-bold">{label}</legend>
      <div className="grid grid-cols-2 gap-2">
        <TextField label="Date" type="date" value={m.date} onChange={(date) => onChange(date ? { ...m, date } : undefined)} />
        <TextField label="Local time" type="time" value={m.time ?? ''} onChange={(time) => onChange({ ...m, time: time || null })} />
      </div>
      <SelectField label="Time zone" value={m.tz} onChange={(tz) => onChange({ ...m, tz })} options={zones} />
    </fieldset>
  );
}

function BookingEditor({ initial, isNew }: { initial: BookingForm; isNew: boolean }) {
  const [v, setV] = useState<BookingForm>(initial);
  const [cost, setCost] = useState(initial.cost?.toString() ?? '');
  const [state, setState] = useState<'idle' | 'saved'>('idle');
  const [error, setError] = useState('');
  const [viewing, setViewing] = useState<string | null>(null);
  const vault = useVaultState();
  const docs = useLiveQuery(() => db.docs.toArray(), []);
  const zones = zoneOptions([v.depart?.tz ?? '', v.arrive?.tz ?? '']);
  const set = (patch: Partial<BookingForm>) => {
    setState('idle');
    setV({ ...v, ...patch });
  };
  const text = (k: 'title' | 'from' | 'to' | 'provider' | 'confirmation' | 'address' | 'addressLocal' | 'currency' | 'freeCancellationUntil' | 'note') =>
    ({ value: v[k] ?? '', onChange: (s: string) => set({ [k]: s || undefined }) });
  const minutes = v.depart && v.arrive ? durationMinutes(v.depart, v.arrive) : null;
  const linked = (docs ?? []).filter((d) => v.documentIds.includes(d.id));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      const n = Number(cost.replace(',', '.'));
      const next: Record<string, unknown> = { ...v, cost: cost.trim() && Number.isFinite(n) ? n : undefined };
      for (const [k, x] of Object.entries(next)) if (x === undefined || x === '') delete next[k];
      await saveBooking(Booking.parse(next));
      setState('saved');
      if (isNew) go(`/trip/booking/${encodeURIComponent(v.id)}`);
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <form onSubmit={submit}>
      {v.depart?.date && (
        <Card className="mb-4">
          <p className="text-sm font-bold uppercase tracking-wide text-muted">{BOOKING_TYPE_LABELS[v.type]}</p>
          <p className="text-lg font-bold">{v.title ?? [v.from, v.to].filter(Boolean).join(' → ')}</p>
          <p className="mt-1">
            {formatLocal(v.depart)} <span className="text-muted">{zoneCity(v.depart.tz)} ({utcOffset(v.depart)})</span>
          </p>
          {v.arrive?.date && (
            <p>
              → {formatLocal(v.arrive)} <span className="text-muted">{zoneCity(v.arrive.tz)} ({utcOffset(v.arrive)})</span>
            </p>
          )}
          {minutes !== null && <p className="mt-1 text-sm text-muted">Takes {formatDuration(minutes)}</p>}
          {v.addressLocal && <p lang="und" className="mt-2 text-2xl font-bold leading-snug">{v.addressLocal}</p>}
        </Card>
      )}

      {linked.length > 0 && (
        <>
          <SectionTitle>Tickets and documents</SectionTitle>
          <Card className="mb-2 py-1">
            {linked.map((d) => (
              <RowLink key={d.id} href={`#/docs/${d.id}`} icon={<DocsIcon />} title={DOC_TYPE_LABELS[DocType.catch('other').parse(d.type)]} sub={`${d.fileIds.length} files`} />
            ))}
          </Card>
          {vault === 'unlocked' && linked[0]?.fileIds[0] && (
            <Button variant="primary" className="mb-4 w-full" onClick={() => setViewing(linked[0]!.fileIds[0]!)}>
              Show ticket full screen
            </Button>
          )}
        </>
      )}

      <SelectField label="Type" value={v.type} onChange={(type) => set({ type })} options={BookingType.options.map((value) => ({ value, label: BOOKING_TYPE_LABELS[value] }))} />
      <SelectField
        label="Status"
        value={v.status}
        onChange={(status) => set({ status })}
        options={BookingStatus.options.map((value) => ({ value, label: { booked: 'Booked', planned: 'Planned (still to book)', idea: 'Idea' }[value] }))}
      />
      <TextField label="Title" {...text('title')} />
      <TextField label="From" {...text('from')} />
      <TextField label="To" {...text('to')} />
      <MomentFields label="Departure / start" value={v.depart} onChange={(depart) => set({ depart })} zones={zones} />
      <MomentFields label="Arrival / end" value={v.arrive} onChange={(arrive) => set({ arrive })} zones={zones} />
      <TextField label="Provider" {...text('provider')} />
      <TextField label="Confirmation code" {...text('confirmation')} />
      <TextField label="Address" {...text('address')} />
      <TextArea label="Address in local script (for taxi drivers)" value={v.addressLocal ?? ''} onChange={(s) => set({ addressLocal: s || undefined })} rows={2} />
      <div className="grid grid-cols-2 gap-2">
        <TextField label="Cost" inputMode="decimal" value={cost} onChange={(s) => { setState('idle'); setCost(s); }} />
        <TextField label="Currency" {...text('currency')} placeholder="EUR" />
      </div>
      <TextField label="Free cancellation until" type="date" {...text('freeCancellationUntil')} />
      <TextArea label="Notes" value={v.note ?? ''} onChange={(s) => set({ note: s || undefined })} />

      <SectionTitle>Linked documents</SectionTitle>
      {(docs ?? []).length === 0 ? (
        <p className="mb-3 text-muted">Add tickets and confirmations under Docs, then link them here.</p>
      ) : (
        <Card className="mb-4 py-1">
          {(docs ?? []).map((d) => (
            <label key={d.id} className="flex min-h-12 items-center gap-3 border-b border-line last:border-b-0">
              <input
                type="checkbox"
                className="h-6 w-6 accent-accent"
                checked={v.documentIds.includes(d.id)}
                onChange={(e) => set({ documentIds: e.target.checked ? [...v.documentIds, d.id] : v.documentIds.filter((x) => x !== d.id) })}
              />
              <span>
                {DOC_TYPE_LABELS[DocType.catch('other').parse(d.type)]}
                <span className="text-sm text-muted"> · added {formatDate(d.createdAt.slice(0, 10))}</span>
              </span>
            </label>
          ))}
        </Card>
      )}

      <ErrorText>{error}</ErrorText>
      <Button type="submit" variant="primary" className="w-full">
        {state === 'saved' ? 'Saved' : 'Save booking'}
      </Button>
      {!isNew && (
        <Button
          variant="danger"
          className="mt-6 w-full"
          onClick={async () => {
            if (!window.confirm('Delete this booking?')) return;
            await deleteBooking(v.id);
            go('/trip');
          }}
        >
          <TrashIcon size={20} /> Delete booking
        </Button>
      )}
      {viewing && <FileViewer fileId={viewing} onClose={() => setViewing(null)} />}
    </form>
  );
}
