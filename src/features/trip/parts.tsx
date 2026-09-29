import { useState } from 'react';
import type { PrepStateRow } from '../../db/db';
import { daysBetween, formatDate } from '../../lib/format';
import { rulesContent } from '../../rules/content';
import { addDays } from '../../rules/itinerary';
import { itemStatus, type ItemStatus } from '../../rules/status';
import type { Check, PrepItem, StayStatus } from '../../rules/types';
import { setPrepState } from '../../trip/store';
import { ENTRY_TYPE_LABELS } from '../../trip/schema';
import { AlertIcon, CheckIcon, ChevronRightIcon, ExternalIcon } from '../../ui/icons';
import { cx, Pill } from '../../ui/kit';

export function SourceLinks({ ids }: { ids: string[] }) {
  const sources = [...new Set(ids)].map((id) => [id, rulesContent.sources[id]] as const).filter(([, s]) => s);
  if (!sources.length) return null;
  return (
    <ul className="mt-2 space-y-1 text-sm">
      {sources.map(([id, s]) => (
        <li key={id}>
          <a href={s!.url} target="_blank" rel="noreferrer" className="inline-flex items-start gap-1 text-accent">
            <ExternalIcon size={14} className="mt-1 shrink-0" />
            <span>
              {s!.title}
              <span className="text-muted"> · checked {formatDate(s!.verifiedAt)}</span>
              {s!.unverified && (
                <span className="ml-1 inline-flex items-center gap-0.5 font-bold text-warn">
                  <AlertIcon size={13} /> unverified
                </span>
              )}
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}

const checkTone = { critical: 'border-crit/40 bg-crit-soft', warn: 'border-warn/30 bg-warn-soft', info: 'border-line bg-card' };

export function CheckCard({ check }: { check: Check }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={cx('rounded-2xl border p-3.5', checkTone[check.severity])}>
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-start gap-2.5 text-left" aria-expanded={open}>
        <AlertIcon
          size={20}
          className={cx('mt-0.5 shrink-0', check.severity === 'critical' ? 'text-crit' : check.severity === 'warn' ? 'text-warn' : 'text-info')}
        />
        <span className="flex-1 font-bold">{check.title}</span>
        <ChevronRightIcon size={18} className={cx('mt-0.5 shrink-0 text-muted transition', open && 'rotate-90')} />
      </button>
      {open && (
        <div className="mt-2 pl-7.5">
          {check.detail && <p className="whitespace-pre-line">{check.detail}</p>}
          {check.dueDate && <p className="mt-1 text-sm text-muted">By {formatDate(check.dueDate)}</p>}
          <SourceLinks ids={check.sourceIds} />
        </div>
      )}
    </div>
  );
}

const STATUS_PILL: Record<ItemStatus, { tone: 'crit' | 'warn' | 'ok' | 'info' | 'muted'; label: string }> = {
  overdue: { tone: 'crit', label: 'Overdue' },
  'do-now': { tone: 'warn', label: 'Do now' },
  upcoming: { tone: 'muted', label: '' },
  snoozed: { tone: 'muted', label: 'Snoozed' },
  done: { tone: 'ok', label: 'Done' },
  'not-needed': { tone: 'muted', label: 'Not needed' },
};

function whenText(item: PrepItem, today: string): string {
  const d = daysBetween(today, item.remindOn);
  const at = item.at.time !== '09:00' ? `, ${item.at.time}` : '';
  const when = d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : formatDate(item.remindOn);
  const deadline = item.deadline && item.deadline !== item.remindOn ? ` · by ${formatDate(item.deadline)}` : '';
  return `${when}${at}${deadline}`;
}

export function PrepItemRow({ item, state, today }: { item: PrepItem; state?: PrepStateRow | undefined; today: string }) {
  const [open, setOpen] = useState(false);
  const status = itemStatus(item, state, today);
  const closed = status === 'done' || status === 'not-needed';
  const pill = STATUS_PILL[status];

  return (
    <li className="border-b border-line py-2.5 last:border-b-0">
      <div className="flex items-start gap-3">
        <button
          type="button"
          role="checkbox"
          aria-checked={status === 'done'}
          aria-label={`Done: ${item.title}`}
          onClick={() => void setPrepState(item.id, status === 'done' ? null : 'done')}
          className={cx(
            'mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg border-2',
            status === 'done' ? 'border-ok bg-ok text-card' : 'border-line bg-card',
          )}
        >
          {status === 'done' && <CheckIcon size={18} />}
        </button>
        <button type="button" onClick={() => setOpen(!open)} className="min-w-0 flex-1 text-left" aria-expanded={open}>
          <span className={cx('block font-bold', closed && 'text-muted line-through')}>{item.title}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-sm text-muted">
            {pill.label && <Pill tone={pill.tone}>{pill.label}</Pill>}
            {whenText(item, today)}
          </span>
        </button>
      </div>
      {open && (
        <div className="mt-2 pl-11">
          {item.detail && <p className="whitespace-pre-line">{item.detail}</p>}
          {item.url && (
            <a href={item.url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 font-bold text-accent">
              Open {new URL(item.url).hostname} <ExternalIcon size={16} />
            </a>
          )}
          <SourceLinks ids={item.sourceIds} />
          <div className="mt-2 flex flex-wrap gap-2 text-sm">
            <button type="button" className="min-h-10 rounded-full border border-line px-3 font-bold" onClick={() => void setPrepState(item.id, 'snoozed', addDays(today, 1))}>
              Snooze 1 day
            </button>
            <button type="button" className="min-h-10 rounded-full border border-line px-3 font-bold" onClick={() => void setPrepState(item.id, 'snoozed', addDays(today, 3))}>
              3 days
            </button>
            {status === 'not-needed' || status === 'snoozed' ? (
              <button type="button" className="min-h-10 rounded-full border border-line px-3 font-bold" onClick={() => void setPrepState(item.id, null)}>
                Reopen
              </button>
            ) : (
              <button type="button" className="min-h-10 rounded-full border border-line px-3 font-bold" onClick={() => void setPrepState(item.id, 'not-needed')}>
                Not needed
              </button>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

export function StayCard({ status, countryName }: { status: StayStatus; countryName: string }) {
  const { stay, regime, limitDays, mustLeaveBy, days } = status;
  const current = status.daysUsed !== undefined;
  const pct = limitDays ? Math.min(100, Math.round(((current ? status.daysUsed! : days) / limitDays) * 100)) : 0;
  const over = limitDays !== undefined && days > limitDays;
  return (
    <a
      href={`#/trip/stay/${encodeURIComponent(stay.id)}`}
      className={cx('block rounded-2xl border bg-card p-4 text-ink no-underline active:bg-sunk', current ? 'border-accent' : 'border-line')}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 rounded-md border-2 border-ink px-1.5 font-mono text-sm font-medium leading-6">{stay.country}</span>
        <div className="min-w-0 flex-1">
          <p className="font-bold">
            {countryName}
            {status.synthetic && <span className="font-normal text-muted"> · self-transfer</span>}
          </p>
          <p className="truncate text-sm text-muted">{stay.places.join(' · ') || stay.entry.point}</p>
          <p className="mt-1 text-sm">
            {formatDate(stay.actualFrom ?? stay.from)} – {formatDate(stay.actualTo ?? stay.to)}
          </p>
        </div>
        <Pill tone={stay.entryType === 'undecided' ? 'warn' : 'muted'}>{ENTRY_TYPE_LABELS[stay.entryType]}</Pill>
      </div>
      {limitDays !== undefined && (
        <div className="mt-3">
          <div className="h-2 overflow-hidden rounded-full bg-sunk" aria-hidden="true">
            <div className={cx('h-full rounded-full', over ? 'bg-crit' : current ? 'bg-accent' : 'bg-muted/50')} style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-1.5 flex justify-between text-sm">
            <span className={over ? 'font-bold text-crit' : ''}>
              {current ? `Day ${status.daysUsed} of ${limitDays}` : `${days} of ${limitDays} days`}
            </span>
            {mustLeaveBy && (
              <span className={cx(current && 'font-bold')}>
                Leave by {formatDate(mustLeaveBy)}
                {stay.stampedUntil ? ' (stamp)' : ''}
              </span>
            )}
          </p>
          {current && status.daysLeft !== undefined && (
            <p className="text-sm text-muted">{status.daysLeft} days left · {regime?.title}</p>
          )}
        </div>
      )}
      {!regime && <p className="mt-2 text-sm font-bold text-warn">No stay rule known for this entry type.</p>}
    </a>
  );
}
