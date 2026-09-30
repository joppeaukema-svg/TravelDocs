import { useState } from 'react';
import { useOnline } from '../../app/hooks';
import { allCountries } from '../../content';
import { formatDateTime } from '../../lib/format';
import { setRateOverride, useRateOverrides, useRates } from '../../live/useLive';
import { Button, Card, inputClass, Notice, PageTitle, Pill, SectionTitle } from '../../ui/kit';

export const CURRENCIES = ['EUR', 'CNY', 'JPY', 'VND', 'THB', 'LAK', 'PHP', 'USD'] as const;

const NAMES: Record<string, string> = {
  EUR: 'Euro',
  CNY: 'Chinese yuan',
  JPY: 'Japanese yen',
  VND: 'Vietnamese dong',
  THB: 'Thai baht',
  LAK: 'Lao kip',
  PHP: 'Philippine peso',
  USD: 'US dollar',
};

/** Units per 1 EUR: your own rate wins over the downloaded one. */
export function useRateTable(): { rate: (c: string) => number | undefined; fetchedAt?: string; providerUpdated?: string; overrides: Record<string, number>; loaded: boolean } {
  const rates = useRates();
  const overrides = useRateOverrides() ?? {};
  return {
    rate: (c) => (c === 'EUR' ? 1 : (overrides[c] ?? rates?.rates[c])),
    ...(rates ? { fetchedAt: rates.fetchedAt, providerUpdated: rates.providerUpdated } : {}),
    overrides,
    loaded: rates !== undefined,
  };
}

export function convert(amount: number, from: string, to: string, rate: (c: string) => number | undefined): number | undefined {
  const f = rate(from);
  const t = rate(to);
  if (!f || !t) return undefined;
  return (amount / f) * t;
}

export function formatMoney(amount: number, currency: string): string {
  const big = ['VND', 'LAK', 'JPY'].includes(currency) || Math.abs(amount) >= 1000;
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency,
    currencyDisplay: 'code',
    maximumFractionDigits: big ? 0 : 2,
    minimumFractionDigits: big ? 0 : 2,
  }).format(amount);
}

const parseAmount = (s: string) => {
  const n = Number(s.replace(/[\s,]/g, ''));
  return Number.isFinite(n) ? n : NaN;
};

function RatesNote({ fetchedAt, providerUpdated }: { fetchedAt?: string | undefined; providerUpdated?: string | undefined }) {
  const online = useOnline();
  if (!fetchedAt) return <p className="mt-2 text-sm text-warn">No rates downloaded yet — open the app once online, or set your own rate below.</p>;
  return (
    <p className="mt-2 text-sm text-muted">
      Rates from {formatDateTime(providerUpdated ?? fetchedAt)}
      {!online && ' · offline, using the last rates'} · indicative mid-market rates, not what your bank charges.
    </p>
  );
}

/** A local-currency ↔ EUR converter for one country. */
export function MiniConverter({ currency }: { currency: string }) {
  const { rate, fetchedAt, providerUpdated } = useRateTable();
  const [amount, setAmount] = useState('');
  const [dir, setDir] = useState<'toEur' | 'fromEur'>('toEur');
  const from = dir === 'toEur' ? currency : 'EUR';
  const to = dir === 'toEur' ? 'EUR' : currency;
  const n = parseAmount(amount);
  const result = amount && !Number.isNaN(n) ? convert(n, from, to, rate) : undefined;
  const one = convert(1, 'EUR', currency, rate);

  return (
    <Card>
      <label className="font-bold" htmlFor={`mini-${currency}`}>
        {from} → {to}
      </label>
      <div className="mt-1 flex gap-2">
        <input
          id={`mini-${currency}`}
          inputMode="decimal"
          className={inputClass}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder={`Amount in ${from}`}
        />
        <Button onClick={() => setDir(dir === 'toEur' ? 'fromEur' : 'toEur')} aria-label="Swap currencies">
          ⇄
        </Button>
      </div>
      <p className="tabular mt-2 text-2xl font-bold" aria-live="polite">
        {result !== undefined ? formatMoney(result, to) : '—'}
      </p>
      {one && <p className="text-sm text-muted">1 EUR = {formatMoney(one, currency)}</p>}
      <RatesNote fetchedAt={fetchedAt} providerUpdated={providerUpdated} />
    </Card>
  );
}

export function MoneyScreen() {
  const { rate, fetchedAt, providerUpdated, overrides } = useRateTable();
  const [amount, setAmount] = useState('100');
  const [from, setFrom] = useState<string>('EUR');
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const n = parseAmount(amount);
  const currencyCountries = (c: string) => allCountries().filter((x) => x.currency === c).map((x) => x.name).join(', ');

  return (
    <>
      <PageTitle sub="Works offline with the last downloaded rates.">Money</PageTitle>
      <Card>
        <div className="flex gap-2">
          <input
            aria-label="Amount"
            inputMode="decimal"
            className={inputClass}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <select aria-label="Currency" className={`${inputClass} w-32`} value={from} onChange={(e) => setFrom(e.target.value)}>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <ul className="mt-3">
          {CURRENCIES.filter((c) => c !== from).map((c) => {
            const v = Number.isNaN(n) ? undefined : convert(n, from, c, rate);
            return (
              <li key={c} className="flex items-baseline justify-between gap-2 border-b border-line py-2 last:border-b-0">
                <span>
                  <span className="font-bold">{c}</span> <span className="text-sm text-muted">{NAMES[c]}</span>
                  {overrides[c] && (
                    <>
                      {' '}
                      <Pill tone="info">your rate</Pill>
                    </>
                  )}
                </span>
                <span className="tabular text-lg font-bold" data-currency={c}>
                  {v !== undefined ? formatMoney(v, c) : '—'}
                </span>
              </li>
            );
          })}
        </ul>
        <RatesNote fetchedAt={fetchedAt} providerUpdated={providerUpdated} />
      </Card>

      <SectionTitle>Your own rates</SectionTitle>
      <p className="mb-2 text-muted">Got a better rate at an exchange office, or no network? Set it here; it wins over the downloaded rate.</p>
      <Card className="py-1">
        <ul>
          {CURRENCIES.filter((c) => c !== 'EUR').map((c) => (
            <li key={c} className="border-b border-line py-2 last:border-b-0">
              {editing === c ? (
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const v = parseAmount(draft);
                    if (v > 0) void setRateOverride(c, v).then(() => setEditing(null));
                  }}
                >
                  <input
                    aria-label={`${c} per euro`}
                    inputMode="decimal"
                    className={inputClass}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    autoFocus
                  />
                  <Button type="submit" variant="primary">
                    Save
                  </Button>
                </form>
              ) : (
                <div className="flex items-center justify-between gap-2">
                  <span>
                    1 EUR = <span className="tabular font-bold">{rate(c) ? formatMoney(rate(c)!, c) : '—'}</span>
                    <span className="block text-sm text-muted">{currencyCountries(c) || NAMES[c]}</span>
                  </span>
                  <span className="flex gap-1">
                    {overrides[c] && (
                      <Button variant="ghost" onClick={() => void setRateOverride(c, null)}>
                        Reset
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setEditing(c);
                        setDraft(String(rate(c) ?? ''));
                      }}
                    >
                      Set
                    </Button>
                  </span>
                </div>
              )}
            </li>
          ))}
        </ul>
      </Card>
      <Notice tone="info">Expenses and daily budgets come in phase 4.</Notice>
    </>
  );
}
