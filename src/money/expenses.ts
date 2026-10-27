import { useLiveQuery } from 'dexie-react-hooks';
import { db, getMeta, setMeta } from '../db/db';
import { addTombstones, markUnsent } from '../trip/store';
import { CATEGORY_LABELS, Expense, ExpenseCategory, ForWhom, forWhomOf, MONEY_META, type Travellers } from './schema';

export { CATEGORY_LABELS, Expense, ExpenseCategory, ForWhom, forWhomOf, type Travellers } from './schema';

// Expenses, budgets and the two names travel with the trip share (see trip/share.ts),
// so every change here counts as an edit to send to a travel companion.

export type ExpenseInput = Omit<Expense, 'id' | 'createdAt' | 'updatedAt'>;

export async function saveExpense(input: ExpenseInput, id?: string): Promise<string> {
  const now = new Date().toISOString();
  const existing = id ? await db.expenses.get(id) : undefined;
  const row = Expense.parse({ ...input, id: id ?? crypto.randomUUID(), createdAt: existing?.createdAt ?? now, updatedAt: now });
  await db.expenses.put(row);
  await markUnsent();
  return row.id;
}

export async function deleteExpense(id: string): Promise<void> {
  await db.expenses.delete(id);
  await addTombstones([`expense:${id}`]);
  await markUnsent();
}

export function useExpenses(): Expense[] | undefined {
  return useLiveQuery(() => db.expenses.orderBy('date').reverse().toArray(), []);
}

// --- Travellers -----------------------------------------------------------------

export async function getTravellers(): Promise<Travellers> {
  return { a: '', b: '', ...((await getMeta(MONEY_META.travellers)) as Partial<Travellers> | undefined) };
}

export function useTravellers(): Travellers | undefined {
  return useLiveQuery(getTravellers, []);
}

export async function setTravellers(t: Pick<Travellers, 'a' | 'b'>): Promise<void> {
  await setMeta(MONEY_META.travellers, { a: t.a.trim(), b: t.b.trim(), updatedAt: new Date().toISOString() });
  await markUnsent();
}

export function whoLabel(w: ForWhom, t: Travellers | undefined): string {
  if (w === 'both') return 'Samen';
  return t?.[w] || (w === 'a' ? 'Traveller 1' : 'Traveller 2');
}

// --- Budgets --------------------------------------------------------------------

/** Daily budget in EUR per country. */
export type Budgets = Record<string, number>;

export async function getBudgets(): Promise<Budgets> {
  return ((await getMeta(MONEY_META.budgets)) as Budgets | undefined) ?? {};
}

export function useBudgets(): Budgets | undefined {
  return useLiveQuery(getBudgets, []);
}

export async function setBudget(country: string, eurPerDay: number | null): Promise<void> {
  const next = { ...(await getBudgets()) };
  if (eurPerDay === null) delete next[country];
  else next[country] = eurPerDay;
  await setMeta(MONEY_META.budgets, next);
  await setMeta(MONEY_META.budgetsUpdatedAt, new Date().toISOString());
  await markUnsent();
}

// --- Totals ---------------------------------------------------------------------

/** The EUR value: fixed at entry, or with today's rate for older entries saved without one. */
export function eurOf(e: Pick<Expense, 'eur' | 'amount' | 'currency'>, rate: (c: string) => number | undefined): number | undefined {
  if (e.eur !== undefined) return e.eur;
  const r = rate(e.currency);
  return r ? e.amount / r : undefined;
}

export interface CountrySummary {
  country: string;
  total: number;
  /** Days in the country so far (or the planned days, before you get there). */
  days: number;
  perDay: number;
  budget?: number;
  byCategory: Partial<Record<ExpenseCategory, number>>;
  /** Expenses without a known EUR value (no rate for that currency). */
  unknown: number;
}

/**
 * Totals per country. `daysIn(country)` gives the days spent there so far, so
 * the average per day can be compared with the budget.
 */
export function summarise(
  expenses: Expense[],
  rate: (c: string) => number | undefined,
  daysIn: (country: string) => number,
  budgets: Budgets,
): { total: number; countries: CountrySummary[]; unknown: number; byWho: Record<ForWhom, number> } {
  const map = new Map<string, CountrySummary>();
  let total = 0;
  let unknown = 0;
  const byWho: Record<ForWhom, number> = { both: 0, a: 0, b: 0 };
  for (const e of expenses) {
    const s = map.get(e.country) ?? { country: e.country, total: 0, days: 0, perDay: 0, byCategory: {}, unknown: 0 };
    const eur = eurOf(e, rate);
    if (eur === undefined) {
      s.unknown++;
      unknown++;
    } else {
      s.total += eur;
      total += eur;
      byWho[forWhomOf(e)] += eur;
      s.byCategory[e.category] = (s.byCategory[e.category] ?? 0) + eur;
    }
    map.set(e.country, s);
  }
  for (const [country, budget] of Object.entries(budgets)) {
    if (!map.has(country)) map.set(country, { country, total: 0, days: 0, perDay: 0, byCategory: {}, unknown: 0 });
    map.get(country)!.budget = budget;
  }
  for (const s of map.values()) {
    s.days = Math.max(1, daysIn(s.country));
    s.perDay = s.total / s.days;
  }
  return { total, unknown, byWho, countries: [...map.values()].sort((a, b) => b.total - a.total) };
}

export function spentOn(expenses: Expense[], date: string, rate: (c: string) => number | undefined): number {
  return expenses.filter((e) => e.date === date).reduce((sum, e) => sum + (eurOf(e, rate) ?? 0), 0);
}

/** What a day's expenses add up to per category, in EUR, the largest first. */
export function spentByCategoryOn(expenses: Expense[], date: string, rate: (c: string) => number | undefined): [ExpenseCategory, number][] {
  const by = new Map<ExpenseCategory, number>();
  for (const e of expenses) {
    const value = e.date === date ? eurOf(e, rate) : undefined;
    if (value !== undefined) by.set(e.category, (by.get(e.category) ?? 0) + value);
  }
  return [...by].sort((a, b) => b[1] - a[1]);
}

const csvCell = (v: string | number | undefined) => {
  const s = v === undefined ? '' : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function expensesCsv(expenses: Expense[], rate: (c: string) => number | undefined, travellers?: Travellers): string {
  const head = ['date', 'country', 'category', 'for', 'amount', 'currency', 'eur', 'note'];
  const rows = [...expenses]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((e) =>
      [e.date, e.country, CATEGORY_LABELS[e.category], whoLabel(forWhomOf(e), travellers), e.amount, e.currency, eurOf(e, rate)?.toFixed(2), e.note]
        .map(csvCell)
        .join(','),
    );
  return [head.join(','), ...rows].join('\n') + '\n';
}
