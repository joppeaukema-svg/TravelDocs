import type { ReactNode } from 'react';
import { useNow } from '../../app/hooks';
import { allCountries, getCountry, globalContent, officialLinks, phrasebook } from '../../content';
import type { CountryContent, Fact, FactTopic, Source } from '../../content/schema';
import { clock, formatDate } from '../../lib/format';
import { rulesContent } from '../../rules/content';
import { useCurrentCountry, useRules } from '../../rules/useRules';
import { updateSettings } from '../../settings/settings';
import { ExternalIcon } from '../../ui/icons';
import { Button, Card, cx, LinkButton, Notice, PageTitle, Pill, RowLink, SectionTitle } from '../../ui/kit';
import { FactList, UnverifiedBadge } from '../content/Facts';
import { CallButton } from '../emergency/CallButton';
import { PhraseList } from '../phrases/PhrasesScreen';
import { SourceLinks } from '../trip/parts';
import { MiniConverter } from '../money/Converter';
import { AdviceBadge, AdvicePanel, ColourChips, Representations, useCountryAdvice } from './LiveAdvice';
import { useAdvice } from '../../live/useLive';
import type { z } from 'zod';

type Topic = z.infer<typeof FactTopic>;

export const GUIDE_TABS = [
  { id: 'entry', label: 'Entry & forms' },
  { id: 'safety', label: 'Safety & live advice' },
  { id: 'emergency', label: 'Emergency' },
  { id: 'health', label: 'Health & medicines' },
  { id: 'money', label: 'Money' },
  { id: 'transport', label: 'Transport' },
  { id: 'connectivity', label: 'Connectivity' },
  { id: 'laws', label: 'Laws & culture' },
  { id: 'phrases', label: 'Phrases' },
  { id: 'apps', label: 'Useful apps' },
  { id: 'sources', label: 'Sources' },
] as const;
type TabId = (typeof GUIDE_TABS)[number]['id'];

const byTopic = (c: CountryContent, ...topics: Topic[]) => c.facts.filter((f) => topics.includes(f.topic));

export function CountriesScreen() {
  const now = useNow();
  const here = useCurrentCountry().code;
  const rules = useRules();
  const advice = useAdvice();
  const onRoute = new Set(rules?.result.stays.map((s) => s.stay.country) ?? []);
  const countries = allCountries().sort((a, b) => Number(onRoute.has(b.country)) - Number(onRoute.has(a.country)));

  return (
    <>
      <PageTitle sub="Guides with sources, and the live Dutch travel advice.">Countries</PageTitle>
      <Card className="py-1">
        {countries.map((c) => {
          const a = advice?.countries.find((x) => x.country === c.country);
          return (
            <RowLink
              key={c.country}
              href={`#/countries/${c.country}`}
              icon={<span className="font-mono text-sm font-medium">{c.country}</span>}
              title={c.name}
              sub={
                <span className="flex flex-wrap items-center gap-1.5">
                  {clock(c.timeZone, now).time} · {c.currency}
                  {a && <ColourChips colours={a.colours} short />}
                </span>
              }
              trailing={
                <span className="flex flex-col items-end gap-1">
                  {c.country === here && <Pill tone="ok">Here now</Pill>}
                  {a && onRoute.has(c.country) && <AdviceBadge advice={a} />}
                </span>
              }
            />
          );
        })}
      </Card>
      <LinkButton href="#/sources" variant="ghost" className="mt-4 w-full">
        All sources and when they were checked
      </LinkButton>
    </>
  );
}

function Tabs({ code, active }: { code: string; active: TabId }) {
  return (
    <nav className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1" aria-label="Guide sections">
      {GUIDE_TABS.map((t) => (
        <a
          key={t.id}
          href={`#/countries/${code}/${t.id}`}
          aria-current={t.id === active ? 'page' : undefined}
          className={cx(
            'flex min-h-11 shrink-0 items-center rounded-full border px-4 font-bold no-underline',
            t.id === active ? 'border-ink bg-ink text-paper' : 'border-line bg-card text-ink',
          )}
        >
          {t.label}
        </a>
      ))}
    </nav>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <SectionTitle>{title}</SectionTitle>
      {children}
    </>
  );
}

function daysText(r: { maxDays?: number | undefined; maxHours?: number | undefined }) {
  if (r.maxDays) return `${r.maxDays} days`;
  if (r.maxHours) return `${r.maxHours} hours`;
  return '';
}

function EntryTab({ c }: { c: CountryContent }) {
  const regimes = rulesContent.stayRegimes.filter((r) => r.country === c.country);
  const passport = rulesContent.passport.filter((r) => r.country === c.country);
  const forms = rulesContent.forms.filter((f) => f.country === c.country);
  const evisa = rulesContent.evisa.find((e) => e.country === c.country);
  return (
    <>
      <FactList facts={byTopic(c, 'entry')} />
      <Section title="How long you can stay">
        <Card className="py-1">
          <ul>
            {regimes.map((r) => (
              <li key={r.id} className="border-b border-line py-2.5 last:border-b-0">
                <p className="font-bold">
                  {r.title} {daysText(r) && <Pill tone="muted">{daysText(r)}</Pill>}
                </p>
                <p className="text-sm text-muted">
                  {[r.arrivalFrom && `arrivals from ${formatDate(r.arrivalFrom)}`, r.arrivalUntil && `until ${formatDate(r.arrivalUntil)}`]
                    .filter(Boolean)
                    .join(' ')}
                </p>
                {r.note && <p className="mt-1">{r.note}</p>}
                <SourceLinks ids={r.sourceIds} />
              </li>
            ))}
          </ul>
        </Card>
        {passport.map((p, i) => (
          <p key={i} className="mt-2">
            <span className="font-bold">Passport: </span>
            {p.basis === 'stay'
              ? 'valid for the whole stay'
              : `valid for at least ${p.months} months after ${p.basis === 'arrival' ? 'arrival' : 'leaving'}`}
            {p.blankPages ? `, ${p.blankPages} blank pages` : ''}
            {p.entryTypes && ` (${p.entryTypes.join(', ')})`}.
          </p>
        ))}
      </Section>
      {evisa && (
        <Section title="E-visa">
          <Card>
            <p>{evisa.processing}.</p>
            <p className="mt-2 font-bold">Only accepted at:</p>
            <ul className="mt-1 list-disc pl-5">
              {evisa.ports.map((p) => (
                <li key={p.name}>{p.name}</li>
              ))}
            </ul>
            <LinkButton href={evisa.applyUrl} external className="mt-3 w-full">
              Apply at {new URL(evisa.applyUrl).hostname} <ExternalIcon size={18} />
            </LinkButton>
            <SourceLinks ids={evisa.sourceIds} />
          </Card>
        </Section>
      )}
      {forms.length > 0 && (
        <Section title="Forms">
          <div className="space-y-2">
            {forms.map((f) => (
              <Card key={f.id}>
                <p className="font-bold">
                  {f.name} <Pill tone={f.mandatory ? 'warn' : 'muted'}>{f.mandatory ? 'Mandatory' : 'Optional'}</Pill>
                </p>
                <p className="mt-1">{f.detail}</p>
                <a href={f.url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 font-bold text-accent">
                  {new URL(f.url).hostname} <ExternalIcon size={16} />
                </a>
                <SourceLinks ids={f.sourceIds} />
              </Card>
            ))}
          </div>
        </Section>
      )}
      {forms.length === 0 && <FactList facts={byTopic(c, 'forms')} />}
      <Notice tone="info">Your own dates and forms per border are in Trip and Checklists.</Notice>
    </>
  );
}

function SafetyTab({ c }: { c: CountryContent }) {
  const holidays = rulesContent.holidays.filter((h) => h.country === c.country);
  return (
    <>
      <AdvicePanel code={c.country} />
      <Section title="Good to know">
        <FactList facts={byTopic(c, 'safety')} />
      </Section>
      <Section title="Weather and seasons">
        <FactList facts={byTopic(c, 'weather')} empty="No seasonal notes." />
        <LinkButton href="#/weather" variant="ghost" className="mt-1 w-full">
          7-day forecast
        </LinkButton>
      </Section>
      {(holidays.length > 0 || byTopic(c, 'holidays').length > 0) && (
        <Section title="Holidays">
          <FactList facts={byTopic(c, 'holidays')} />
          {holidays.map((h) => (
            <Card key={h.id} className="mt-2">
              <p className="font-bold">
                {h.name} · {formatDate(h.from)}
                {h.to !== h.from && ` – ${formatDate(h.to)}`}
              </p>
              <p className="mt-1">{h.detail}</p>
              <SourceLinks ids={h.sourceIds} />
            </Card>
          ))}
        </Section>
      )}
    </>
  );
}

function EmergencyTab({ c }: { c: CountryContent }) {
  const { advice } = useCountryAdvice(c.country);
  return (
    <>
      <div className="space-y-2">
        {c.emergencyNumbers.map((n, i) => (
          <CallButton key={n.id} label={n.label} number={n.number} note={n.note} unverified={n.unverified} prominent={i === 0} />
        ))}
      </div>
      <Section title="Dutch government, 24/7">
        <div className="space-y-2">
          {globalContent().emergencyNumbers.map((n) => (
            <CallButton key={n.id} label={n.label} number={n.number} kind={n.kind} />
          ))}
        </div>
      </Section>
      <FactList facts={byTopic(c, 'emergency')} />
      <Section title="Dutch embassy and consulates">
        {advice ? (
          <Representations reps={advice.representations} />
        ) : (
          <Notice tone="warn">Not downloaded yet — open the app once while online.</Notice>
        )}
      </Section>
    </>
  );
}

function MoneyTab({ c }: { c: CountryContent }) {
  return (
    <>
      <MiniConverter currency={c.currency} />
      <div className="mt-3">
        <FactList facts={byTopic(c, 'money')} empty="Nothing specific — cards and cash both work in the usual places." />
      </div>
    </>
  );
}

function PhrasesTab({ c }: { c: CountryContent }) {
  const book = phrasebook();
  const lang = Object.entries(book.languages).find(([, l]) => l.countries.includes(c.country))?.[0];
  if (!lang) return <Notice>No phrases for this country.</Notice>;
  return (
    <>
      <PhraseList lang={lang as keyof typeof book.languages} />
      <LinkButton href={`#/phrases/${lang}`} className="mt-3 w-full">
        “Show this” cards
      </LinkButton>
    </>
  );
}

/** Every source this guide cites, plus the official links, with dates. */
function SourcesTab({ c }: { c: CountryContent }) {
  const cited = new Map<string, { source: Source; facts: Fact[]; verifiedAt: string; unverified: boolean }>();
  for (const x of [...c.facts, ...c.emergencyNumbers]) {
    for (const s of x.sources) {
      const e = cited.get(s.url) ?? { source: s, facts: [], verifiedAt: x.verifiedAt, unverified: false };
      if ('topic' in x) e.facts.push(x);
      if (x.verifiedAt < e.verifiedAt) e.verifiedAt = x.verifiedAt;
      e.unverified ||= !!x.unverified;
      cited.set(s.url, e);
    }
  }
  const links = officialLinks(c.country);
  return (
    <>
      <Section title="Official links">
        <Card className="py-1">
          <ul>
            {links.map((l) => (
              <li key={l.url} className="border-b border-line py-2.5 last:border-b-0">
                <a href={l.url} target="_blank" rel="noreferrer" className="inline-flex items-start gap-1 font-bold text-accent">
                  <ExternalIcon size={16} className="mt-1 shrink-0" /> {l.title}
                </a>
                <p className="text-sm text-muted">
                  {l.topic} · checked {formatDate(l.verifiedAt)} {l.unverified && <UnverifiedBadge />}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      </Section>
      <Section title="Cited in this guide">
        <Card className="py-1">
          <ul>
            {[...cited.values()].map((e) => (
              <li key={e.source.url} className="border-b border-line py-2.5 last:border-b-0">
                <a href={e.source.url} target="_blank" rel="noreferrer" className="inline-flex items-start gap-1 font-bold text-accent">
                  <ExternalIcon size={16} className="mt-1 shrink-0" /> {e.source.title}
                </a>
                <p className="text-sm text-muted">
                  {e.facts.length ? `${e.facts.length} ${e.facts.length === 1 ? 'fact' : 'facts'}` : 'Emergency numbers'} · checked{' '}
                  {formatDate(e.verifiedAt)} {e.unverified && <UnverifiedBadge />}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      </Section>
    </>
  );
}

function TabBody({ c, tab }: { c: CountryContent; tab: TabId }) {
  switch (tab) {
    case 'entry':
      return <EntryTab c={c} />;
    case 'safety':
      return <SafetyTab c={c} />;
    case 'emergency':
      return <EmergencyTab c={c} />;
    case 'health':
      return <FactList facts={[...byTopic(c, 'health'), ...globalContent().facts.filter((f) => f.topic === 'health')]} />;
    case 'money':
      return <MoneyTab c={c} />;
    case 'transport':
      return <FactList facts={byTopic(c, 'transport')} empty="No transport notes yet." />;
    case 'connectivity':
      return <FactList facts={byTopic(c, 'connectivity')} empty="No connectivity notes yet." />;
    case 'laws':
      return <FactList facts={byTopic(c, 'laws', 'culture')} />;
    case 'phrases':
      return <PhrasesTab c={c} />;
    case 'apps':
      return <FactList facts={byTopic(c, 'apps')} empty="No app tips yet." />;
    case 'sources':
      return <SourcesTab c={c} />;
  }
}

export function CountryScreen({ code, tab }: { code: string; tab?: string | undefined }) {
  const country = getCountry(code.toUpperCase());
  const now = useNow();
  const here = useCurrentCountry().code;
  const { advice } = useCountryAdvice(country?.country);
  if (!country) return <Notice tone="warn" title="Unknown country" />;
  const active: TabId = GUIDE_TABS.some((t) => t.id === tab) ? (tab as TabId) : 'entry';
  const local = clock(country.timeZone, now);

  return (
    <>
      <PageTitle
        sub={
          <span className="flex flex-wrap items-center gap-1.5">
            {local.day}, {local.time} local · {country.currency}
            {advice && <ColourChips colours={advice.colours} short />}
            {advice && <AdviceBadge advice={advice} />}
          </span>
        }
      >
        {country.name}
      </PageTitle>
      {country.country !== here && (
        <Button className="mb-4 w-full" onClick={() => void updateSettings({ countryOverride: country.country })}>
          I'm in {country.name} now
        </Button>
      )}
      <Tabs code={country.country} active={active} />
      <TabBody c={country} tab={active} />
    </>
  );
}
