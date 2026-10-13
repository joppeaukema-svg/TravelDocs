import { useLiveQuery } from 'dexie-react-hooks';
import { z } from 'zod';
import { countryCode, isoDate } from '../content/schema';
import { db, getMeta, setMeta } from '../db/db';

export const ExpenseCategory = z.enum(['food', 'stay', 'flights', 'transport', 'activities', 'shopping', 'fees', 'health', 'esim', 'other']);
export type ExpenseCategory = z.infer<typeof ExpenseCategory>;

export const CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  food: 'Food & drink',
  stay: 'Accommodation',
  flights: 'Flights',
  transport: 'Transport',
  activities: 'Activities',
  shopping: 'Shopping',
  fees: 'Visas & fees',
  health: 'Health',
  esim: 'E-sims',
  other: 'Other',
};

/** Who an expense is for: both of you, or one of you ("a" and "b"; their names are set on the phone). */
export const ForWhom = z.enum(['both', 'a', 'b']);
export type ForWhom = z.infer<typeof ForWhom>;

/** One expense. `eur` is fixed when it's saved, with the rate you had then. */
export const Expense = z.object({
  id: z.string(),
  date: isoDate,
  amount: z.number().positive(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  category: ExpenseCategory,
  /** Where it was spent — for per-country budgets. 'NL' for costs at home. */
  country: countryCode,
  note: z.string().optional(),
  /** Missing on older entries: those count as for both. */
  forWhom: ForWhom.optional(),
  eur: z.number().nonnegative().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Expense = z.infer<typeof Expense>;

export type ExpenseInput = Omit<Expense, 'id' | 'createdAt' | 'updatedAt'>;

export async function saveExpense(input: ExpenseInput, id?: string): Promise<string> {
  const now = new Date().toISOString();
  const existing = id ? await db.expenses.get(id) : undefined;
  const row = Expense.parse({ ...input, id: id ?? crypto.randomUUID(), createdAt: existing?.createdAt ?? now, updatedAt: now });
  await db.expenses.put(row);
  return row.id;
}

export async function deleteExpense(id: string): Promise<void> {
  await db.expenses.delete(id);
}

export function useExpenses(): Expense[] | undefined {
  return useLiveQuery(() => db.expenses.orderBy('date').reverse().toArray(), []);
}

export const forWhomOf = (e: Pick<Expense, 'forWhom'>): ForWhom => e.forWhom ?? 'both';

// --- Travellers -----------------------------------------------------------------

/** The two travellers' names. Kept on this phone only (they're personal), set once in Money. */
export interface Travellers {
  a: string;
  b: string;
}
const TRAVELLERS = 'travellers';

export function useTravellers(): Travellers | undefined {
  return useLiveQuery(async () => ({ a: '', b: '', ...((await getMeta(TRAVELLERS)) as Partial<Travellers> | undefined) }), []);
}

export async function setTravellers(t: Travellers): Promise<void> {
  await setMeta(TRAVELLERS, { a: t.a.trim(), b: t.b.trim() });
}

export function whoLabel(w: ForWhom, t: Travellers | undefined): string {
  if (w === 'both') return 'Samen';
  return t?.[w] || (w === 'a' ? 'Traveller 1' : 'Traveller 2');
}

// --- Budgets --------------------------------------------------------------------

/** Daily budget in EUR per country. */
export type Budgets = Record<string, number>;
const BUDGETS = 'budgets';

export function useBudgets(): Budgets | undefined {
  return useLiveQuery(async () => ((await getMeta(BUDGETS)) as Budgets | undefined) ?? {}, []);
}

export async function setBudget(country: string, eurPerDay: number | null): Promise<void> {
  const next = { ...(((await getMeta(BUDGETS)) as Budgets | undefined) ?? {}) };
  if (eurPerDay === null) delete next[country];
  else next[country] = eurPerDay;
  await setMeta(BUDGETS, next);
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
