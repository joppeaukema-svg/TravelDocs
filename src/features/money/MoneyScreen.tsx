import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { go } from '../../app/hooks';
import { allCountries, getCountry } from '../../content';
import { db } from '../../db/db';
import { formatDate } from '../../lib/format';
import { shareFile } from '../../lib/share';
import {
  CATEGORY_LABELS,
  deleteExpense,
  ExpenseCategory,
  expensesCsv,
  eurOf,
  saveExpense,
  setBudget,
  spentOn,
  summarise,
  useBudgets,
  useExpenses,
  type CountrySummary,
  type Expense,
} from '../../money/expenses';
import { diffDays, minDate, stayEnd, stayStart } from '../../rules/itinerary';
import { useCurrentCountry, useToday } from '../../rules/useRules';
import { useTrip } from '../../trip/store';
import type { TripData } from '../../trip/io';
import { DownloadIcon, PlusIcon } from '../../ui/icons';
import { Button, Card, cx, ErrorText, Field, inputClass, LinkButton, Notice, PageTitle, RowLink, SectionTitle, SelectField, TextField } from '../../ui/kit';
import { convert, CURRENCIES, formatMoney, parseAmount, useRateTable } from './Converter';

const eur = (n: number) => formatMoney(n, 'EUR');

/** Days in a country up to today; before you get there, the planned days. */
export function daysInCountry(trip: TripData | null | undefined, country: string, today: string): number {
  if (!trip) return 1;
  const stays = trip.stays.filter((s) => s.country === country);
  let sofar = 0;
  let planned = 0;
  for (const s of stays) {
    planned += diffDays(stayStart(s), stayEnd(s)) + 1;
    if (stayStart(s) <= today) sofar += diffDays(stayStart(s), minDate(stayEnd(s), today)) + 1;
  }
  return sofar || planned || 1;
}

function BudgetBar({ spent, budget }: { spent: number; budget: number }) {
  const ratio = spent / budget;
  return (
    <div className="mt-2 h-3 overflow-hidden rounded-full bg-sunk" role="meter" aria-valuemin={0} aria-valuemax={budget} aria-valuenow={Math.round(spent)} aria-label="Budget used">
      <div
        className={cx('h-full rounded-full', ratio > 1 ? 'bg-crit' : ratio > 0.85 ? 'bg-warn' : 'bg-ok')}
        style={{ width: `${Math.min(100, ratio * 100)}%` }}
      />
    </div>
  );
}

function BudgetEditor({ country, budget }: { country: string; budget?: number | undefined }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  if (!editing) {
    return (
      <Button
        variant="ghost"
        className="min-h-10 px-2 text-sm"
        onClick={() => {
          setDraft(budget ? String(budget) : '');
          setEditing(true);
        }}
      >
        {budget ? 'Change budget' : 'Set daily budget'}
      </Button>
    );
  }
  return (
    <form
      className="mt-2 flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const v = parseAmount(draft);
        void setBudget(country, draft.trim() && v > 0 ? v : null).then(() => setEditing(false));
      }}
    >
      <input
        aria-label={`Daily budget for ${getCountry(country)?.name ?? country} in EUR`}
        inputMode="decimal"
        className={inputClass}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="EUR per day (empty: none)"
        autoFocus
      />
      <Button type="submit" variant="primary">
        Save
      </Button>
    </form>
  );
}

function CountryCard({ s }: { s: CountrySummary }) {
  const name = s.country === 'NL' ? 'Netherlands (before you leave)' : (getCountry(s.country)?.name ?? s.country);
  const cats = Object.entries(s.byCategory).sort(([, a], [, b]) => b - a);
  return (
    <Card>
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-bold">{name}</p>
        <p className="tabular text-lg font-bold">{eur(s.total)}</p>
      </div>
      <p className="text-sm text-muted">
        {eur(s.perDay)} a day over {s.days} {s.days === 1 ? 'day' : 'days'}
        {s.budget !== undefined && ` · budget ${eur(s.budget)} a day`}
      </p>
      {s.budget !== undefined && <BudgetBar spent={s.perDay} budget={s.budget} />}
      {cats.length > 0 && (
        <p className="mt-2 text-sm">{cats.map(([c, v]) => `${CATEGORY_LABELS[c as ExpenseCategory]} ${eur(v)}`).join(' · ')}</p>
      )}
      {s.unknown > 0 && <p className="mt-1 text-sm text-warn">{s.unknown} without a rate — not counted.</p>}
      {s.country !== 'NL' && <BudgetEditor country={s.country} budget={s.budget} />}
    </Card>
  );
}

export function MoneyScreen() {
  const expenses = useExpenses();
  const budgets = useBudgets();
  const trip = useTrip();
  const today = useToday();
  const here = useCurrentCountry().code;
  const { rate } = useRateTable();
  if (!expenses || !budgets) return null;

  const summary = summarise(expenses, rate, (c) => daysInCountry(trip, c, today), budgets);
  const todaySpent = spentOn(expenses, today, rate);
  const todayBudget = here ? budgets[here] : undefined;
  const byDate = new Map<string, Expense[]>();
  for (const e of expenses.slice(0, 40)) byDate.set(e.date, [...(byDate.get(e.date) ?? []), e]);
  const routeWithoutSpend = [...new Set(trip?.stays.map((s) => s.country) ?? [])].filter((c) => !summary.countries.some((s) => s.country === c));

  return (
    <>
      <PageTitle sub="Expenses and budgets in EUR. Stays on this phone.">Money</PageTitle>
      <Card>
        <p className="text-sm font-bold uppercase tracking-wide text-muted">Today</p>
        <p className="tabular text-3xl font-bold">{eur(todaySpent)}</p>
        {todayBudget !== undefined && (
          <>
            <BudgetBar spent={todaySpent} budget={todayBudget} />
            <p className="mt-1 text-sm text-muted">
              {todaySpent <= todayBudget ? `${eur(todayBudget - todaySpent)} left of ${eur(todayBudget)}` : `${eur(todaySpent - todayBudget)} over the ${eur(todayBudget)} budget`}
            </p>
          </>
        )}
        <LinkButton href="#/money/add" variant="primary" className="mt-3 w-full">
          <PlusIcon /> Add expense
        </LinkButton>
      </Card>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <LinkButton href="#/money/convert">Converter</LinkButton>
        <Button
          disabled={!expenses.length}
          onClick={() => void shareFile(new Blob([expensesCsv(expenses, rate)], { type: 'text/csv' }), 'expenses.csv', 'download')}
        >
          <DownloadIcon size={18} /> CSV
        </Button>
      </div>

      <SectionTitle action={<span className="tabular font-bold">{eur(summary.total)}</span>}>Per country</SectionTitle>
      {summary.countries.length === 0 && routeWithoutSpend.length === 0 && <p className="text-muted">No expenses yet.</p>}
      <div className="space-y-2">
        {summary.countries.map((s) => (
          <CountryCard key={s.country} s={s} />
        ))}
        {routeWithoutSpend.length > 0 && (
          <Card className="py-1">
            <ul>
              {routeWithoutSpend.map((c) => (
                <li key={c} className="flex items-center justify-between gap-2 border-b border-line py-1.5 last:border-b-0">
                  <span>{getCountry(c)?.name ?? c}</span>
                  <BudgetEditor country={c} />
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>

      {byDate.size > 0 && (
        <>
          <SectionTitle>Latest</SectionTitle>
          <Card className="py-1">
            {[...byDate.entries()].map(([date, list]) => (
              <div key={date}>
                <p className="pt-2 text-sm font-bold text-muted">{formatDate(date)}</p>
                {list.map((e) => (
                  <RowLink
                    key={e.id}
                    href={`#/money/expense/${e.id}`}
                    title={
                      <span className="flex justify-between gap-2">
                        <span className="truncate">{e.note || CATEGORY_LABELS[e.category]}</span>
                        <span className="tabular shrink-0">{formatMoney(e.amount, e.currency)}</span>
                      </span>
                    }
                    sub={`${CATEGORY_LABELS[e.category]} · ${getCountry(e.country)?.name ?? e.country}${e.currency !== 'EUR' && eurOf(e, rate) !== undefined ? ` · ${eur(eurOf(e, rate)!)}` : ''}`}
                  />
                ))}
              </div>
            ))}
          </Card>
        </>
      )}
    </>
  );
}

const LAST_CURRENCY = 'tc-last-currency';

function lastCurrency(): string | null {
  try {
    return localStorage.getItem(LAST_CURRENCY);
  } catch {
    return null;
  }
}

export function ExpenseScreen({ id }: { id?: string }) {
  const existing = useLiveQuery(async () => (id ? ((await db.expenses.get(id)) ?? null) : null), [id]);
  if (id && existing === undefined) return null;
  if (id && existing === null) return <Notice tone="warn" title="This expense no longer exists" />;
  return <ExpenseForm key={id ?? 'new'} existing={existing ?? undefined} />;
}

function ExpenseForm({ existing }: { existing?: Expense | undefined }) {
  const today = useToday();
  const here = useCurrentCountry().code;
  const trip = useTrip();
  const { rate } = useRateTable();
  const hereCurrency = getCountry(here)?.currency;
  const [amount, setAmount] = useState(existing ? String(existing.amount) : '');
  const [currency, setCurrency] = useState(existing?.currency ?? hereCurrency ?? lastCurrency() ?? 'EUR');
  const [category, setCategory] = useState<ExpenseCategory>(existing?.category ?? 'food');
  const [date, setDate] = useState(existing?.date ?? today);
  const [country, setCountry] = useState(existing?.country ?? here ?? 'NL');
  const [note, setNote] = useState(existing?.note ?? '');
  const [error, setError] = useState('');

  const n = parseAmount(amount);
  const eurValue = n > 0 ? convert(n, currency, 'EUR', rate) : undefined;
  const route = new Set(trip?.stays.map((s) => s.country) ?? []);
  const countries = [
    ...allCountries().filter((c) => route.has(c.country) || !route.size),
    ...allCountries().filter((c) => route.size && !route.has(c.country)),
  ];

  async function submit() {
    if (!(n > 0)) return setError('Enter an amount.');
    const keepEur = existing && existing.amount === n && existing.currency === currency ? existing.eur : eurValue;
    await saveExpense(
      {
        date,
        amount: n,
        currency,
        category,
        country,
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(keepEur !== undefined ? { eur: Math.round(keepEur * 100) / 100 } : {}),
      },
      existing?.id,
    );
    try {
      localStorage.setItem(LAST_CURRENCY, currency);
    } catch {
      // Private mode: just don't remember.
    }
    go('/money');
  }

  return (
    <>
      <PageTitle>{existing ? 'Edit expense' : 'Add expense'}</PageTitle>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Card>
          <div className="flex gap-2">
            <Field label="Amount">
              {(fid) => (
                <input id={fid} inputMode="decimal" className={inputClass} value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus={!existing} />
              )}
            </Field>
            <Field label="Currency">
              {(fid) => (
                <select id={fid} className={`${inputClass} w-28`} value={currency} onChange={(e) => setCurrency(e.target.value)}>
                  {CURRENCIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              )}
            </Field>
          </div>
          {currency !== 'EUR' && <p className="-mt-2 mb-3 text-muted">{eurValue !== undefined ? `≈ ${eur(eurValue)}` : 'No rate for this currency yet'}</p>}

          <p className="mb-1 font-bold">Category</p>
          <div className="mb-3.5 flex flex-wrap gap-2" role="radiogroup" aria-label="Category">
            {ExpenseCategory.options.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={c === category}
                onClick={() => setCategory(c)}
                className={cx('min-h-11 rounded-full border px-3.5 font-bold', c === category ? 'border-ink bg-ink text-paper' : 'border-line bg-card')}
              >
                {CATEGORY_LABELS[c]}
              </button>
            ))}
          </div>

          <TextField label="Date" type="date" value={date} onChange={setDate} />
          <SelectField
            label="Country"
            value={country}
            onChange={setCountry}
            options={[...countries.map((c) => ({ value: c.country, label: c.name })), { value: 'NL', label: 'Netherlands (before you leave)' }]}
          />
          <TextField label="Note (optional)" value={note} onChange={setNote} placeholder="e.g. night market, slow boat ticket" />
          <ErrorText>{error}</ErrorText>
          <Button type="submit" variant="primary" className="mt-1 w-full">
            Save
          </Button>
        </Card>
      </form>
      {existing && (
        <Button
          variant="danger"
          className="mt-4 w-full"
          onClick={() => {
            if (confirm('Delete this expense?')) void deleteExpense(existing.id).then(() => go('/money'));
          }}
        >
          Delete expense
        </Button>
      )}
    </>
  );
}
