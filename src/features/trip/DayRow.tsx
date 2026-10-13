import { useState } from 'react';
import { formatDayRange } from '../../lib/format';
import type { Holiday } from '../../rules/content';
import type { ItemStatus } from '../../rules/status';
import type { PrepItem } from '../../rules/types';
import { BOOKING_TYPE_LABELS, bookingLabel, type Booking, type Day } from '../../trip/schema';
import { saveDay, setPrepState } from '../../trip/store';
import { formatLocal } from '../../trip/time';
import { CheckIcon, EditIcon } from '../../ui/icons';
import { Button, cx, Pill, TextArea, TextField } from '../../ui/kit';
import { SourceLinks } from './parts';

/** A must-do from the checklists (a mandatory form, a visa step…) on the day to act, with a box to tick it off. */
export interface DayTask {
  item: PrepItem;
  /** The item's title, with the country in front when the title doesn't name it. */
  title: string;
  status: ItemStatus;
}

function TaskLine({ task: { item, title, status } }: { task: DayTask }) {
  const closed = status === 'done' || status === 'not-needed';
  return (
    <div className="mt-1.5 flex items-start gap-2 text-sm">
      <button
        type="button"
        role="checkbox"
        aria-checked={status === 'done'}
        aria-label={`Done: ${title}`}
        onClick={() => void setPrepState(item.id, status === 'done' ? null : 'done')}
        className={cx(
          'grid h-7 w-7 shrink-0 place-items-center rounded-md border-2',
          status === 'done' ? 'border-ok bg-ok text-card' : 'border-warn bg-card',
        )}
      >
        {status === 'done' && <CheckIcon size={16} />}
      </button>
      <a href={`#/checklists/${encodeURIComponent(item.group)}`} className="min-w-0 pt-0.5 text-ink no-underline">
        <span className={cx('font-bold', closed && 'text-muted line-through')}>{title}</span>
        {item.deadline && item.deadline !== item.remindOn && <span className="text-muted"> · by {formatDayRange(item.deadline, item.deadline)}</span>}
      </a>
    </div>
  );
}

/** One day of the trip: place, holidays, must-dos, notes and bookings, with a pencil to edit the place and notes. */
export function DayRow({
  date,
  country,
  day,
  bookings,
  holidays,
  tasks = [],
  isToday,
  editing,
  onEdit,
}: {
  date: string;
  country: string;
  day: Day | undefined;
  bookings: Booking[];
  holidays: Holiday[];
  tasks?: DayTask[];
  isToday: boolean;
  editing: boolean;
  onEdit: (on: boolean) => void;
}) {
  const label = formatLocal({ date, time: null, tz: 'UTC' });
  return (
    <li className={cx('border-b border-line py-2 last:border-b-0', isToday && 'bg-accent-soft -mx-4 px-4')}>
      <div className="flex items-start gap-2">
        <span className="tabular w-20 shrink-0 pt-0.5 text-sm text-muted">{label}</span>
        <div className="min-w-0 flex-1">
          <p className="font-bold">{day?.place || '—'}</p>
          {holidays.map((h) => (
            <details key={h.id} className="mt-1 text-sm">
              <summary className="flex cursor-pointer list-none items-center gap-1.5 [&::-webkit-details-marker]:hidden">
                <Pill tone="info">Holiday</Pill> <span className="font-bold">{h.name}</span>
              </summary>
              <p className="mt-1">{h.detail}</p>
              <SourceLinks ids={h.sourceIds} />
            </details>
          ))}
          {tasks.map((t) => (
            <TaskLine key={t.item.id} task={t} />
          ))}
          {editing ? (
            <DayEditor date={date} country={country} day={day} onDone={() => onEdit(false)} />
          ) : (
            day?.note && <p className="mt-1 whitespace-pre-line text-sm">{day.note}</p>
          )}
          {bookings.map((b) => (
            <a key={b.id} href={`#/trip/booking/${encodeURIComponent(b.id)}`} className="mt-1 flex items-center gap-2 text-sm text-ink no-underline">
              <Pill tone={b.status === 'booked' ? 'ok' : b.status === 'planned' ? 'muted' : 'info'}>{b.status}</Pill>
              <span className="min-w-0 flex-1 truncate">
                {b.depart?.time && <span className="tabular font-bold">{b.depart.time} </span>}
                {BOOKING_TYPE_LABELS[b.type]}: {bookingLabel(b)}
              </span>
            </a>
          ))}
        </div>
        {!editing && (
          <button
            type="button"
            onClick={() => onEdit(true)}
            aria-label={`Plan and notes for ${label}`}
            className="-mr-2 -mt-1.5 grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted active:bg-sunk"
          >
            <EditIcon size={18} />
          </button>
        )}
      </div>
    </li>
  );
}

function DayEditor({ date, country, day, onDone }: { date: string; country: string; day: Day | undefined; onDone: () => void }) {
  const [place, setPlace] = useState(day?.place ?? '');
  const [note, setNote] = useState(day?.note ?? '');
  return (
    <form
      className="mt-2 space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void saveDay(date, country, { place: place.trim() || null, note: note.trim() }).then(onDone);
      }}
    >
      <TextField label="Place" value={place} onChange={setPlace} />
      <TextArea
        label="Notes"
        value={note}
        onChange={setNote}
        hint="For example: book the train ticket today. Notes go along when you send the trip to your travel companion."
      />
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary">
          Save
        </Button>
      </div>
    </form>
  );
}
