import type { PrepStateRow } from '../db/db';
import type { PrepItem } from './types';

export type ItemStatus = 'done' | 'not-needed' | 'snoozed' | 'overdue' | 'do-now' | 'upcoming';

/**
 * - done / not needed: what you marked
 * - snoozed: hidden until the snooze date
 * - do now: its moment has come (or had already passed when you imported the trip)
 * - overdue: the deadline has passed and it isn't done
 */
export function itemStatus(item: PrepItem, state: PrepStateRow | undefined, today: string): ItemStatus {
  if (state?.status === 'done') return 'done';
  if (state?.status === 'not-needed') return 'not-needed';
  if (state?.status === 'snoozed' && state.snoozedUntil && state.snoozedUntil > today) return 'snoozed';
  if (item.deadline && item.deadline < today) return 'overdue';
  if (item.remindOn <= today) return 'do-now';
  return 'upcoming';
}

export const OPEN: ItemStatus[] = ['overdue', 'do-now', 'upcoming'];
