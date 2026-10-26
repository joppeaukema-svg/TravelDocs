import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { go } from '../../app/hooks';
import { allCountries, getCountry } from '../../content';
import { db } from '../../db/db';
import { formatDayRange } from '../../lib/format';
import { shareFile } from '../../lib/share';
import {
  CATEGORY_LABELS,
  deleteExpense,
  ExpenseCategory,
  expensesCsv,
  eurOf,
  forWhomOf,
  ForWhom,
  saveExpense,
  setBudget,
  setTravellers,
  spentOn,
  summarise,
  useBudgets,
  useExpenses,
  useTravellers,
  whoLabel,
  type CountrySummary,
  type Expense,
  type Travellers,
} from '../../money/expenses';
import { diffDays, minDate, stayEnd, stayStart } from '../../rules/itinerary';
import { useCurrentCountry, useToday } from '../../rules/useRules';
import { useTrip } from '../../trip/store';
import type { TripData } from '../../trip/io';
import { ChevronRightIcon, DownloadIcon, PlusIcon } from '../../ui/icons';
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

/** A country's costs per category; tap the country to see every expense under its category. */
function CountryCard({
  s,
  expenses,
  travellers,
  rate,
}: {
  s: CountrySummary;
  expenses: Expense[];
  travellers: Travellers;
  rate: (c: string) => number | undefined;
}) {
  const [open, setOpen] = useState(false);
  const name = s.country === 'NL' ? 'Netherlands (before you leave)' : (getCountry(s.country)?.name ?? s.country);
  const mine = expenses.filter((e) => e.country === s.country);
  const cats = ExpenseCategory.options
    .filter((c) => mine.some((e) => e.category === c))
    .sort((a, b) => (s.byCategory[b] ?? 0) - (s.byCategory[a] ?? 0));
  return (
    <Card>
      <button
        type="button"
        aria-expanded={open}
        disabled={!mine.length}
        onClick={() => setOpen(!open)}
        className="flex w-full items-baseline justify-between gap-2 text-left"
      >
        <span className="font-bold">{name}</span>
        <span className="flex shrink-0 items-center gap-1">
          <span className="tabular text-lg font-bold">{eur(s.total)}</span>
          {mine.length > 0 && <ChevronRightIcon size={18} className={cx('self-center text-muted transition', open && 'rotate-90')} />}
        </span>
      </button>
      <p className="text-sm text-muted">
        {eur(s.perDay)} a day over {s.days} {s.days === 1 ? 'day' : 'days'}
        {s.budget !== undefined && ` · budget ${eur(s.budget)} a day`}
      </p>
      {s.budget !== undefined && <BudgetBar spent={s.perDay} budget={s.budget} />}
      {cats.length > 0 && (
        <ul className="mt-2" aria-label={`${name} per category`}>
          {cats.map((c) => (
            <li key={c} className="border-b border-line py-1.5 last:border-b-0">
              <p className="flex justify-between gap-2">
                <span>{CATEGORY_LABELS[c]}</span>
                <span className="tabular font-bold">{eur(s.byCategory[c] ?? 0)}</span>
              </p>
              {open && (
                <ul className="mb-1 mt-0.5 border-l-2 border-line pl-3">
                  {mine
                    .filter((e) => e.category === c)
                    .map((e) => {
                      const value = e.currency !== 'EUR' ? eurOf(e, rate) : undefined;
                      return (
                        <li key={e.id}>
                          <a href={`#/money/expense/${e.id}`} className="flex min-h-10 items-center justify-between gap-2 text-sm text-ink no-underline">
                            <span className="min-w-0">
                              <span className="block truncate">{e.note || CATEGORY_LABELS[e.category]}</span>
                              <span className="block text-muted">
                                {formatDayRange(e.date, e.date)} · {whoLabel(forWhomOf(e), travellers)}
                              </span>
                            </span>
                            <span className="shrink-0 text-right">
                              <span className="tabular block">{formatMoney(e.amount, e.currency)}</span>
                              {value !== undefined && <span className="tabular block text-muted">{eur(value)}</span>}
                            </span>
                          </a>
                        </li>
                      );
                    })}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
      {mine.length > 0 && (
        <Button variant="ghost" className="min-h-10 px-0 text-sm" onClick={() => setOpen(!open)}>
          {open ? 'Hide the costs' : `Show all ${mine.length} ${mine.length === 1 ? 'cost' : 'costs'}`}
        </Button>
      )}
      {s.unknown > 0 && <p className="mt-1 text-sm text-warn">{s.unknown} without a rate — not counted.</p>}
      {s.country !== 'NL' && <BudgetEditor country={s.country} budget={s.budget} />}
    </Card>
  );
}

/** The two names for "for whom". Saved on this phone only. */
function NamesEditor({ travellers, onDone }: { travellers: Travellers; onDone: () => void }) {
  const [a, setA] = useState(travellers.a);
  const [b, setB] = useState(travellers.b);
  return (
    // Not a <form>: it also sits inside the expense form.
    <div className="mt-2">
      <div className="grid grid-cols-2 gap-2">
        <TextField label="Name 1" value={a} onChange={setA} autoComplete="off" />
        <TextField label="Name 2" value={b} onChange={setB} autoComplete="off" />
      </div>
      <p className="-mt-1 mb-3 text-sm text-muted">They go along when you send the trip, so set them on one phone.</p>
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" onClick={onDone}>
          Cancel
        </Button>
        <Button type="button" variant="primary" onClick={() => void setTravellers({ a, b }).then(onDone)}>
          Save names
        </Button>
      </div>
    </div>
  );
}

function PerPerson({ byWho, travellers }: { byWho: Record<ForWhom, number>; travellers: Travellers }) {
  const [editing, setEditing] = useState(false);
  const half = byWho.both / 2;
  return (
    <>
      <SectionTitle
        action={
          !editing && (
            <button type="button" className="min-h-10 text-sm font-bold text-accent" onClick={() => setEditing(true)}>
              {travellers.a || travellers.b ? 'Names' : 'Set names'}
            </button>
          )
        }
      >
        Per person
      </SectionTitle>
      <Card className="py-1">
        {editing ? (
          <div className="py-2">
            <NamesEditor travellers={travellers} onDone={() => setEditing(false)} />
          </div>
        ) : (
          <>
            <ul aria-label="Per person">
              {ForWhom.options.map((w) => (
                <li key={w} className="flex justify-between gap-2 border-b border-line py-2">
                  <span>{whoLabel(w, travellers)}</span>
                  <span className="tabular font-bold">{eur(byWho[w])}</span>
                </li>
              ))}
            </ul>
            <p className="py-2 text-sm text-muted">
              With half of Samen each: {whoLabel('a', travellers)} {eur(byWho.a + half)} · {whoLabel('b', travellers)} {eur(byWho.b + half)}
            </p>
          </>
        )}
      </Card>
    </>
  );
}

export function MoneyScreen() {
  const expenses = useExpenses();
  const budgets = useBudgets();
  const travellers = useTravellers();
  const trip = useTrip();
  const today = useToday();
  const here = useCurrentCountry().code;
  const { rate } = useRateTable();
  if (!expenses || !budgets || !travellers) return null;

  const summary = summarise(expenses, rate, (c) => daysInCountry(trip, c, today), budgets);
  const todaySpent = spentOn(expenses, today, rate);
  const todayBudget = here ? budgets[here] : undefined;
  // The three added last (on either phone), whatever date they're for.
  const latest = [...expenses].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 3);
  const routeWithoutSpend = [...new Set(trip?.stays.map((s) => s.country) ?? [])].filter((c) => !summary.countries.some((s) => s.country === c));

  return (
    <>
      <PageTitle sub="Expenses and budgets in EUR. Shared with your travel companion when you send the trip.">Money</PageTitle>
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
          onClick={() => void shareFile(new Blob([expensesCsv(expenses, rate, travellers)], { type: 'text/csv' }), 'expenses.csv', 'download')}
        >
          <DownloadIcon size={18} /> CSV
        </Button>
      </div>

      {expenses.length > 0 && <PerPerson byWho={summary.byWho} travellers={travellers} />}

      <SectionTitle action={<span className="tabular font-bold">{eur(summary.total)}</span>}>Per country</SectionTitle>
      {summary.countries.length === 0 && routeWithoutSpend.length === 0 && <p className="text-muted">No expenses yet.</p>}
      <div className="space-y-2">
        {summary.countries.map((s) => (
          <CountryCard key={s.country} s={s} expenses={expenses} travellers={travellers} rate={rate} />
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

      {latest.length > 0 && (
        <>
          <SectionTitle>Latest added</SectionTitle>
          <Card className="py-1">
            {latest.map((e) => (
              <RowLink
                key={e.id}
                href={`#/money/expense/${e.id}`}
                title={
                  <span className="flex justify-between gap-2">
                    <span className="truncate">{e.note || CATEGORY_LABELS[e.category]}</span>
                    <span className="tabular shrink-0">{formatMoney(e.amount, e.currency)}</span>
                  </span>
                }
                sub={`${whoLabel(forWhomOf(e), travellers)} · ${CATEGORY_LABELS[e.category]} · ${getCountry(e.country)?.name ?? e.country}${e.currency !== 'EUR' && eurOf(e, rate) !== undefined ? ` · ${eur(eurOf(e, rate)!)}` : ''} · ${formatDayRange(e.date, e.date)}`}
              />
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
  const [amount, setAmount] = useState(existing ? String(existing.amount) : '');
  // Only what you pick is kept. Until then the country is where you are (known a moment after the
  // form opens, once the trip is read) and the currency is that country's.
  const [pickedCountry, setCountry] = useState<string | null>(existing?.country ?? null);
  const [pickedCurrency, setCurrency] = useState<string | null>(existing?.currency ?? null);
  const country = pickedCountry ?? here ?? 'NL';
  const currency = pickedCurrency ?? (country === 'NL' ? 'EUR' : getCountry(country)?.currency) ?? lastCurrency() ?? 'EUR';
  const [category, setCategory] = useState<ExpenseCategory>(existing?.category ?? 'food');
  const [forWhom, setForWhom] = useState<ForWhom>(existing ? forWhomOf(existing) : 'both');
  const travellers = useTravellers();
  const [naming, setNaming] = useState(false);
  const [date, setDate] = useState(existing?.date ?? today);
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
        forWhom,
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

          <p className="mb-1 font-bold">For</p>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="For">
            {ForWhom.options.map((w) => (
              <button
                key={w}
                type="button"
                role="radio"
                aria-checked={w === forWhom}
                onClick={() => setForWhom(w)}
                className={cx('min-h-11 rounded-full border px-3.5 font-bold', w === forWhom ? 'border-ink bg-ink text-paper' : 'border-line bg-card')}
              >
                {whoLabel(w, travellers)}
              </button>
            ))}
          </div>
          {travellers && !naming && !(travellers.a && travellers.b) && (
            <Button variant="ghost" className="min-h-10 px-0 text-sm" onClick={() => setNaming(true)}>
              Set your names
            </Button>
          )}
          {travellers && naming && <NamesEditor travellers={travellers} onDone={() => setNaming(false)} />}
          <div className="mb-3.5" />

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
