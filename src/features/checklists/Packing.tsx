import { useState } from 'react';
import { factById, getCountry, packingTemplate } from '../../content';
import type { PackingItem } from '../../content/schema';
import { parseProfile, useProfileRaw } from '../../profile/profile';
import { setPrepState, usePrepStates, useTrip } from '../../trip/store';
import { CheckIcon } from '../../ui/icons';
import { Card, cx, PageTitle, Pill } from '../../ui/kit';
import { FactCard } from '../content/Facts';

export const packingId = (item: PackingItem) => `pack-${item.id}`;

/** The template, narrowed to the countries on your route and your profile. */
export function usePackingList(): PackingItem[] {
  const trip = useTrip();
  const { profile } = parseProfile(useProfileRaw());
  const route = new Set(trip?.stays.map((s) => s.country) ?? []);
  return packingTemplate().filter((i) => {
    if (i.countries && route.size && !i.countries.some((c) => route.has(c))) return false;
    if (i.flag && !profile.flags[i.flag as keyof typeof profile.flags]) return false;
    return true;
  });
}

function PackingRow({ item, done }: { item: PackingItem; done: boolean }) {
  const [open, setOpen] = useState(false);
  const facts = (item.factIds ?? []).map(factById).filter((f) => f !== undefined);
  return (
    <li className="border-b border-line py-2.5 last:border-b-0">
      <div className="flex items-start gap-3">
        <button
          type="button"
          role="checkbox"
          aria-checked={done}
          aria-label={`Packed: ${item.title}`}
          onClick={() => void setPrepState(packingId(item), done ? null : 'done')}
          className={cx('mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg border-2', done ? 'border-ok bg-ok text-card' : 'border-line bg-card')}
        >
          {done && <CheckIcon size={18} />}
        </button>
        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setOpen(!open)} aria-expanded={open} disabled={!facts.length}>
          <span className={cx('block font-bold', done && 'text-muted line-through')}>{item.title}</span>
          {item.countries && (
            <span className="text-sm text-muted">{item.countries.map((c) => getCountry(c)?.name ?? c).join(', ')}</span>
          )}
          {facts.length > 0 && <span className="block text-sm font-bold text-accent">{open ? 'Hide why' : 'Why?'}</span>}
        </button>
      </div>
      {open && (
        <div className="mt-2 space-y-2 pl-11">
          {facts.map((f) => (
            <FactCard key={f.id} fact={f} />
          ))}
        </div>
      )}
    </li>
  );
}

export function PackingScreen() {
  const items = usePackingList();
  const states = usePrepStates();
  const done = items.filter((i) => states.get(packingId(i))?.status === 'done').length;
  return (
    <>
      <PageTitle sub="Destination-specific items follow your route and profile.">Packing</PageTitle>
      <p className="mb-2">
        <Pill tone={done === items.length ? 'ok' : 'muted'}>
          {done} of {items.length} packed
        </Pill>
      </p>
      <Card className="py-1">
        <ul>
          {items.map((i) => (
            <PackingRow key={i.id} item={i} done={states.get(packingId(i))?.status === 'done'} />
          ))}
        </ul>
      </Card>
    </>
  );
}
