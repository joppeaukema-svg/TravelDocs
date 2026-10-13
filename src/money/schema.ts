import { z } from 'zod';
import { countryCode, isoDate } from '../content/schema';

// The expense data, without storage: shared by the Money screens and the trip share.

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

/** Who an expense is for: both of you, or one of you ("a" and "b"; their names are set in Money and shared). */
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

export const forWhomOf = (e: Pick<Expense, 'forWhom'>): ForWhom => e.forWhom ?? 'both';

/** The two travellers' names, and when they were last changed (for merging with a companion's phone). */
export const Travellers = z.object({ a: z.string(), b: z.string(), updatedAt: z.string().optional() });
export type Travellers = z.infer<typeof Travellers>;

/** Daily budgets in EUR per country, and when they were last changed. */
export const SharedBudgets = z.object({ values: z.record(z.string(), z.number()), updatedAt: z.string() });
export type SharedBudgets = z.infer<typeof SharedBudgets>;

/** Where Money keeps its settings in the meta table. */
export const MONEY_META = { budgets: 'budgets', budgetsUpdatedAt: 'budgetsUpdatedAt', travellers: 'travellers' } as const;
