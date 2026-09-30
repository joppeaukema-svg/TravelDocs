import { Temporal } from 'temporal-polyfill';
import type { PrepStateRow } from '../db/db';
import type { PrepItem } from '../rules/types';

/** What the push server gets per notification: a time, a short title and an in-app link. Nothing else. */
export interface PushEntry {
  at: string;
  title: string;
  url: string;
}

const MAX = 300;

const tasks = (n: number) => `${n} ${n === 1 ? 'task' : 'tasks'}`;

/**
 * One notification per checklist and alarm time, from the prep items still
 * open. Titles name only the country and a count — never bookings or places —
 * and links use the stay's position in the trip instead of its id.
 */
export function buildPushSchedule(
  prep: PrepItem[],
  states: Map<string, PrepStateRow>,
  stayOrder: string[],
  countryName: (code: string) => string,
  now: Date = new Date(),
): PushEntry[] {
  const groups = new Map<string, { at: string; group: string; country: string; items: PrepItem[] }>();
  for (const item of prep) {
    const state = states.get(item.id);
    if (state?.status === 'done' || state?.status === 'not-needed') continue;
    const date = state?.status === 'snoozed' && state.snoozedUntil ? state.snoozedUntil : item.alarm.date;
    const at = Temporal.PlainDateTime.from(`${date}T${item.alarm.time}`).toZonedDateTime(item.alarm.tz).toInstant();
    if (at.epochMilliseconds <= now.getTime()) continue;
    const key = `${at.toString()}|${item.group}`;
    const g = groups.get(key) ?? { at: at.toString(), group: item.group, country: item.country, items: [] };
    g.items.push(item);
    groups.set(key, g);
  }
  return [...groups.values()]
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(0, MAX)
    .map((g) => {
      const n = g.items.length;
      const index = stayOrder.indexOf(g.group);
      const url = g.group === 'predeparture' ? '#/checklists/predeparture' : index >= 0 ? `#/checklists/n/${index}` : '#/checklists';
      let title: string;
      if (g.group === 'predeparture') title = `Before you leave: ${tasks(n)} due`;
      else if (g.items.every((i) => i.moment === 'exit')) title = `Leaving ${countryName(g.country)}: ${tasks(n)}`;
      else title = `${countryName(g.country)} prep: ${tasks(n)} due`;
      return { at: g.at, title: title.slice(0, 80), url };
    });
}
