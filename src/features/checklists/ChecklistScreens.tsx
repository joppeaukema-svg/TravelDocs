import { formatDate } from '../../lib/format';
import { itemStatus, OPEN } from '../../rules/status';
import type { PrepItem } from '../../rules/types';
import { useRules, type Rules } from '../../rules/useRules';
import { usePrepStates } from '../../trip/store';
import { Card, LinkButton, Notice, PageTitle, Pill, RowLink, SectionTitle } from '../../ui/kit';
import { PrepItemRow } from '../trip/parts';
import { packingId, PackingScreen, usePackingList } from './Packing';

function groupTitle(rules: Rules, group: string): { title: string; sub: string } {
  if (group === 'predeparture') return { title: 'Before you leave', sub: `Due by ${formatDate(rules.data.meta.depart)}` };
  const s = rules.result.stays.find((x) => x.stay.id === group)?.stay;
  if (!s) return { title: group, sub: '' };
  const name = rules.itinerary.countryName(s.country);
  const place = s.places[0] && rules.data.stays.filter((x) => x.country === s.country).length > 1 ? ` · ${s.places[0]}` : '';
  return { title: `${name}${place}`, sub: `${formatDate(s.from)} – ${formatDate(s.to)}` };
}

function NoTrip() {
  return (
    <>
      <PageTitle>Checklists</PageTitle>
      <Notice title="Import your trip first" action={<LinkButton href="#/trip">Go to Trip</LinkButton>}>
        The checklists are built from your itinerary and the entry rules.
      </Notice>
      <Card className="mt-4 py-1">
        <RowLink href="#/checklists/packing" title="Packing" sub="The general packing list" />
      </Card>
    </>
  );
}

function PackingRow() {
  const items = usePackingList();
  const states = usePrepStates();
  const open = items.filter((i) => states.get(packingId(i))?.status !== 'done').length;
  return (
    <RowLink
      href="#/checklists/packing"
      title="Packing"
      sub="Includes items for the countries on your route"
      trailing={open ? <Pill tone="muted">{open} open</Pill> : <Pill tone="ok">Done</Pill>}
    />
  );
}

export function ChecklistsScreen() {
  const rules = useRules();
  const states = usePrepStates();
  if (rules === undefined) return null;
  if (rules === null) return <NoTrip />;
  const { result, today } = rules;
  const status = (p: PrepItem) => itemStatus(p, states.get(p.id), today);
  const urgent = result.prep.filter((p) => ['overdue', 'do-now'].includes(status(p)));
  const groups = ['predeparture', ...result.stays.map((s) => s.stay.id)].filter((g) => result.prep.some((p) => p.group === g));

  return (
    <>
      <PageTitle sub="Built from your itinerary and the entry rules.">Checklists</PageTitle>
      {urgent.length > 0 && (
        <>
          <SectionTitle>Do now</SectionTitle>
          <Card className="py-1">
            <ul>
              {urgent.map((p) => (
                <PrepItemRow key={p.id} item={p} state={states.get(p.id)} today={today} />
              ))}
            </ul>
          </Card>
        </>
      )}
      <SectionTitle>By country</SectionTitle>
      <Card className="py-1">
        {groups.map((g) => {
          const items = result.prep.filter((p) => p.group === g);
          const open = items.filter((p) => OPEN.includes(status(p))).length;
          const { title, sub } = groupTitle(rules, g);
          return (
            <RowLink
              key={g}
              href={`#/checklists/${encodeURIComponent(g)}`}
              title={title}
              sub={sub}
              trailing={open ? <Pill tone="muted">{open} open</Pill> : <Pill tone="ok">Done</Pill>}
            />
          );
        })}
      </Card>
      <SectionTitle>Packing</SectionTitle>
      <Card className="py-1">
        <PackingRow />
      </Card>
    </>
  );
}

export function ChecklistScreen({ group }: { group: string }) {
  if (group === 'packing') return <PackingScreen />;
  return <GroupChecklist group={group} />;
}

function GroupChecklist({ group }: { group: string }) {
  const rules = useRules();
  const states = usePrepStates();
  if (rules === undefined) return null;
  if (rules === null) return <NoTrip />;
  const items = rules.result.prep.filter((p) => p.group === group);
  const { title, sub } = groupTitle(rules, group);
  const status = (p: PrepItem) => itemStatus(p, states.get(p.id), rules.today);
  const open = items.filter((p) => OPEN.includes(status(p)));
  const closed = items.filter((p) => !OPEN.includes(status(p)));

  return (
    <>
      <PageTitle sub={sub}>{title}</PageTitle>
      {items.length === 0 && <Notice title="Nothing to prepare here" />}
      {open.length > 0 && (
        <Card className="py-1">
          <ul>
            {open.map((p) => (
              <PrepItemRow key={p.id} item={p} state={states.get(p.id)} today={rules.today} />
            ))}
          </ul>
        </Card>
      )}
      {closed.length > 0 && (
        <>
          <SectionTitle>Done, snoozed or not needed</SectionTitle>
          <Card className="py-1">
            <ul>
              {closed.map((p) => (
                <PrepItemRow key={p.id} item={p} state={states.get(p.id)} today={rules.today} />
              ))}
            </ul>
          </Card>
        </>
      )}
      {group !== 'predeparture' && (
        <LinkButton href={`#/trip/stay/${encodeURIComponent(group)}`} variant="ghost" className="mt-4 w-full">
          Stay details and counter
        </LinkButton>
      )}
    </>
  );
}
