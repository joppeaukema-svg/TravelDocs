import { allCountries, globalContent, officialLinks } from '../../content';
import type { Source } from '../../content/schema';
import { useAdvice, useRates } from '../../live/useLive';
import { formatDate, formatDateTime } from '../../lib/format';
import { rulesContent } from '../../rules/content';
import { ExternalIcon } from '../../ui/icons';
import { Card, Notice, PageTitle, Pill, SectionTitle } from '../../ui/kit';
import { UnverifiedBadge } from '../content/Facts';

interface Row {
  source: Source;
  verifiedAt: string;
  unverified: boolean;
  uses: number;
}

function collect(items: { sources: Source[]; verifiedAt: string; unverified?: boolean | undefined }[]): Row[] {
  const rows = new Map<string, Row>();
  for (const x of items) {
    for (const s of x.sources) {
      const r = rows.get(s.url) ?? { source: s, verifiedAt: x.verifiedAt, unverified: false, uses: 0 };
      r.uses++;
      if (x.verifiedAt < r.verifiedAt) r.verifiedAt = x.verifiedAt;
      r.unverified ||= !!x.unverified;
      rows.set(s.url, r);
    }
  }
  return [...rows.values()].sort((a, b) => Number(a.unverified) - Number(b.unverified) || b.uses - a.uses);
}

function SourceRows({ rows }: { rows: Row[] }) {
  return (
    <Card className="py-1">
      <ul>
        {rows.map((r) => (
          <li key={r.source.url} className="border-b border-line py-2.5 last:border-b-0">
            <a href={r.source.url} target="_blank" rel="noreferrer" className="inline-flex items-start gap-1 font-bold text-accent">
              <ExternalIcon size={16} className="mt-1 shrink-0" /> {r.source.title}
            </a>
            <p className="text-sm text-muted">
              {r.uses} {r.uses === 1 ? 'item' : 'items'} · checked {formatDate(r.verifiedAt)} {r.unverified && <UnverifiedBadge />}
            </p>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function SourcesScreen() {
  const advice = useAdvice();
  const rates = useRates();
  const countries = allCountries();
  const facts = [...countries.flatMap((c) => c.facts), ...globalContent().facts];
  const unverified = facts.filter((f) => f.unverified).length;
  const ruleSources = Object.entries(rulesContent.sources).map(([, s]) => ({
    sources: [{ title: s.title, url: s.url }],
    verifiedAt: s.verifiedAt,
    unverified: s.unverified,
  }));

  return (
    <>
      <PageTitle sub={`${facts.length} facts; every one has a source and a check date.`}>Sources</PageTitle>
      {unverified > 0 && (
        <Notice tone="warn" title={`${unverified} facts couldn't be confirmed by an official source`}>
          They're marked <UnverifiedBadge /> wherever they appear. Double-check them before relying on them.
        </Notice>
      )}

      <SectionTitle>Live data</SectionTitle>
      <Card>
        <p className="font-bold">Dutch travel advice and embassies</p>
        {advice ? (
          <>
            <p className="text-sm text-muted">Downloaded {formatDateTime(advice.fetchedAt)} · NederlandWereldwijd open data (CC0)</p>
            <ul className="mt-2 text-sm">
              {advice.countries.map((a) => (
                <li key={a.country}>
                  {countries.find((c) => c.country === a.country)?.name ?? a.country}: last changed {formatDateTime(a.lastModified)}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-sm text-warn">Not downloaded yet.</p>
        )}
        <p className="mt-3 font-bold">Exchange rates</p>
        {rates ? (
          <p className="text-sm text-muted">
            {formatDateTime(rates.providerUpdated)} ·{' '}
            <a href={rates.source.url} target="_blank" rel="noreferrer">
              {rates.source.title}
            </a>
          </p>
        ) : (
          <p className="text-sm text-warn">Not downloaded yet.</p>
        )}
        <p className="mt-2 text-sm text-muted">Both are refreshed daily on the server and whenever the app opens online.</p>
      </Card>

      {countries.map((c) => (
        <section key={c.country}>
          <SectionTitle action={<Pill tone="muted">{c.facts.length} facts</Pill>}>{c.name}</SectionTitle>
          <SourceRows rows={collect([...c.facts, ...c.emergencyNumbers])} />
          {officialLinks(c.country).length > 0 && (
            <p className="mt-1 text-sm text-muted">
              Official links: <a href={`#/countries/${c.country}/sources`}>in the {c.name} guide</a>
            </p>
          )}
        </section>
      ))}

      <SectionTitle>General</SectionTitle>
      <SourceRows rows={collect([...globalContent().facts, ...globalContent().emergencyNumbers])} />

      <SectionTitle>Entry rules and reminders</SectionTitle>
      <SourceRows rows={collect(ruleSources)} />
    </>
  );
}
