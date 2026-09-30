import { Fragment, useEffect, useRef } from 'react';
import type { Advice, Block, Representation } from '../../live/schema';
import { adviceState, changedParts, markAdviceSeen, partKey, SUMMARY_PART, useAdvice, useAdviceSeen } from '../../live/useLive';
import { formatDateTime } from '../../lib/format';
import { ExternalIcon } from '../../ui/icons';
import { Card, cx, LinkButton, Notice, Pill } from '../../ui/kit';
import { CallButton } from '../emergency/CallButton';

type Colour = Advice['colours'][number];

const COLOURS: Record<Colour, { label: string; cls: string }> = {
  red: { label: 'Red · don’t travel', cls: 'bg-[#c62828] text-white' },
  orange: { label: 'Orange · essential travel only', cls: 'bg-[#ef6c00] text-white' },
  yellow: { label: 'Yellow · take care', cls: 'bg-[#fdd835] text-[#1a1a1a]' },
  green: { label: 'Green · no special risks', cls: 'bg-[#2e7d32] text-white' },
};

export function ColourChips({ colours, short }: { colours: Colour[]; short?: boolean }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {colours.map((c) => (
        <span key={c} className={cx('rounded-full px-2.5 py-0.5 text-sm font-bold', COLOURS[c].cls)}>
          {short ? COLOURS[c].label.split(' · ')[0] : COLOURS[c].label}
        </span>
      ))}
    </span>
  );
}

export function useCountryAdvice(code: string | null | undefined): { advice: Advice | null | undefined; fetchedAt?: string } {
  const all = useAdvice();
  if (all === undefined) return { advice: undefined };
  if (!all || !code) return { advice: null };
  return { advice: all.countries.find((a) => a.country === code) ?? null, fetchedAt: all.fetchedAt };
}

/** "Changed" / "Not read yet" for a country's advice. */
export function AdviceBadge({ advice }: { advice: Advice }) {
  const seen = useAdviceSeen();
  if (!seen) return null;
  const state = adviceState(advice, seen);
  if (state === 'changed') return <Pill tone="warn">Advice changed</Pill>;
  if (state === 'unread') return <Pill tone="muted">Not read yet</Pill>;
  return null;
}

function Blocks({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((b, i) =>
        b.type === 'h' ? (
          <p key={i} className="mt-3 font-bold first:mt-0">
            {b.text}
          </p>
        ) : b.type === 'li' ? (
          <p key={i} className="mt-1 pl-4 -indent-3">
            • {b.text}
          </p>
        ) : (
          <p key={i} className="mt-2 first:mt-0">
            {b.text}
          </p>
        ),
      )}
    </>
  );
}

/** The live Dutch travel advice for a country: colour, what changed, full text, maps. */
export function AdvicePanel({ code }: { code: string }) {
  const { advice, fetchedAt } = useCountryAdvice(code);
  const seen = useAdviceSeen();
  // It counts as read when you leave this view, so the highlights stay while you read.
  const latest = useRef(advice);
  useEffect(() => {
    latest.current = advice;
  });
  useEffect(
    () => () => {
      if (latest.current) void markAdviceSeen(latest.current);
    },
    [code],
  );
  const opened = advice && seen ? { state: adviceState(advice, seen), changed: changedParts(advice, seen) } : null;

  if (advice === undefined) return null;
  if (!advice) {
    return (
      <Notice tone="warn" title="The live advice hasn't been downloaded yet">
        Open the app once while online and it's stored for offline use.
      </Notice>
    );
  }
  const base = import.meta.env.BASE_URL;

  return (
    <div className="space-y-3">
      <Card>
        <ColourChips colours={advice.colours} />
        <p className="mt-2 text-sm text-muted">
          Dutch travel advice, last changed {formatDateTime(advice.lastModified)}
          {fetchedAt && <> · downloaded {formatDateTime(fetchedAt)}</>}
        </p>
        {opened?.state === 'changed' && (
          <div className="mt-3">
            <Notice tone="warn" title="Changed since you last read it">
              {opened.changed.length
                ? `Changed: ${opened.changed.join('; ')}. These parts are marked below.`
                : 'Read the summary and the sections below again.'}
            </Notice>
          </div>
        )}
        {opened?.changed.includes(SUMMARY_PART) && <Pill tone="warn">Summary changed</Pill>}
        <div className="mt-3" lang="nl">
          <Blocks blocks={advice.summary} />
        </div>
        <LinkButton href={advice.url} external variant="ghost" className="mt-2 w-full">
          Open on nederlandwereldwijd.nl <ExternalIcon size={18} />
        </LinkButton>
      </Card>

      {advice.maps.length > 0 && (
        <details className="rounded-2xl border border-line bg-card p-4">
          <summary className="cursor-pointer font-bold">Map of the colour codes</summary>
          {advice.maps.map((m) => (
            <a key={m.file} href={`${base}live/${m.file}`} target="_blank" rel="noreferrer" className="mt-3 block">
              <img src={`${base}live/${m.file}`} alt={m.title} loading="lazy" className="w-full rounded-lg border border-line bg-white" />
            </a>
          ))}
        </details>
      )}

      {advice.sections.map((s) => {
        const changed = s.parts.filter((p) => opened?.changed.includes(partKey(s.title, p.title))).map((p) => p.title);
        return (
        <details
          key={s.title}
          open={changed.length > 0}
          className={cx('rounded-2xl border bg-card p-4', changed.length ? 'border-warn' : 'border-line')}
          lang="nl"
        >
          <summary className="cursor-pointer font-bold">
            {s.title} {changed.length > 0 && <Pill tone="warn">Changed</Pill>}
          </summary>
          {s.parts.map((p) => (
            <Fragment key={p.title}>
              <h4 className={cx('mt-4 text-sm font-bold uppercase tracking-wide', changed.includes(p.title) ? 'text-warn' : 'text-muted')}>
                {p.title}
                {changed.includes(p.title) && ' · changed'}
              </h4>
              <div className="mt-1">
                <Blocks blocks={p.blocks} />
              </div>
            </Fragment>
          ))}
        </details>
        );
      })}
      <p className="text-sm text-muted">The advice text is in Dutch, as published by the Dutch government (open data, CC0).</p>
    </div>
  );
}

const BZ = /^\+31 ?247 ?247 ?247$/;

export function Representations({ reps }: { reps: Representation[] }) {
  if (!reps.length) return null;
  const sorted = [...reps].sort((a, b) => Number(b.embassy) - Number(a.embassy));
  return (
    <div className="space-y-3">
      {sorted.map((r) => (
        <Card key={r.id}>
          <p className="font-bold">{r.title}</p>
          {r.address.length > 0 && <p className="mt-1 text-sm text-muted">{r.address.filter(Boolean).join(', ')}</p>}
          <div className="mt-2 space-y-2">
            {r.phones
              .filter((p) => !BZ.test(p))
              .map((p) => (
                <CallButton key={p} label="Call (local rate)" number={p} />
              ))}
          </div>
          {r.openingTimes.length > 0 && (
            <details className="mt-2" lang="nl">
              <summary className="cursor-pointer text-sm font-bold text-muted">Opening times</summary>
              <div className="mt-1 text-sm">
                <Blocks blocks={r.openingTimes} />
              </div>
            </details>
          )}
          <a href={r.url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-sm font-bold text-accent">
            Details online <ExternalIcon size={14} />
          </a>
        </Card>
      ))}
    </div>
  );
}
