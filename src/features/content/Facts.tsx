import type { Fact, Source } from '../../content/schema';
import { formatDate } from '../../lib/format';
import { AlertIcon, ExternalIcon } from '../../ui/icons';
import { cx } from '../../ui/kit';

const severityTone = {
  critical: 'border-crit/40 bg-crit-soft',
  important: 'border-warn/30 bg-warn-soft',
  info: 'border-line bg-card',
};

export function UnverifiedBadge() {
  return (
    <span className="inline-flex items-center gap-0.5 text-sm font-bold text-warn" title="Couldn't be checked against an official source">
      <AlertIcon size={14} /> unverified
    </span>
  );
}

export function SourceList({ sources, verifiedAt, unverified }: { sources: Source[]; verifiedAt: string; unverified?: boolean | undefined }) {
  return (
    <ul className="mt-2 space-y-1 text-sm">
      {sources.map((s) => (
        <li key={s.url}>
          <a href={s.url} target="_blank" rel="noreferrer" className="inline-flex items-start gap-1 text-accent">
            <ExternalIcon size={14} className="mt-1 shrink-0" />
            <span>{s.title}</span>
          </a>
        </li>
      ))}
      <li className="text-muted">
        Checked {formatDate(verifiedAt)} {unverified && <UnverifiedBadge />}
      </li>
    </ul>
  );
}

export function FactCard({ fact }: { fact: Fact }) {
  return (
    <article className={cx('rounded-2xl border p-3.5', severityTone[fact.severity ?? 'info'])} data-fact={fact.id}>
      <h3 className="font-bold">{fact.title}</h3>
      <p className="mt-1">{fact.body}</p>
      {fact.unverified && (
        <p className="mt-2 flex items-start gap-1.5 text-sm font-bold text-warn">
          <AlertIcon size={16} className="mt-0.5 shrink-0" />
          Not confirmed by an official source — double-check before relying on it.
        </p>
      )}
      <details className="mt-1">
        <summary className="cursor-pointer text-sm font-bold text-muted">Sources</summary>
        <SourceList sources={fact.sources} verifiedAt={fact.verifiedAt} unverified={fact.unverified} />
      </details>
    </article>
  );
}

export function FactList({ facts, empty }: { facts: Fact[]; empty?: string }) {
  if (!facts.length) return empty ? <p className="text-muted">{empty}</p> : null;
  const order = { critical: 0, important: 1, info: 2 };
  const sorted = [...facts].sort((a, b) => order[a.severity ?? 'info'] - order[b.severity ?? 'info']);
  return (
    <div className="space-y-2">
      {sorted.map((f) => (
        <FactCard key={f.id} fact={f} />
      ))}
    </div>
  );
}
