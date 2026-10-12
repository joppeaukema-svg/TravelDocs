import { useState } from 'react';
import type { Holiday } from '../../rules/content';
import { BOOKING_TYPE_LABELS, bookingLabel, type Booking, type Day } from '../../trip/schema';
import { saveDay } from '../../trip/store';
import { formatLocal } from '../../trip/time';
import { EditIcon } from '../../ui/icons';
import { Button, cx, Pill, TextArea, TextField } from '../../ui/kit';
import { SourceLinks } from './parts';

/** One day of the trip: place, holidays, notes and bookings, with a pencil to edit the place and notes. */
export function DayRow({
  date,
  country,
  day,
  bookings,
  holidays,
  isToday,
  editing,
  onEdit,
}: {
  date: string;
  country: string;
  day: Day | undefined;
  bookings: Booking[];
  holidays: Holiday[];
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
