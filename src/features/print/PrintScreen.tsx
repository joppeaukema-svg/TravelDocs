import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState, type ReactNode } from 'react';
import { useVaultState } from '../../app/hooks';
import { allCountries, getCountry, globalContent } from '../../content';
import { db, META } from '../../db/db';
import { DOC_TYPE_LABELS, readDocument, type DocSecret } from '../../docs/docs';
import { parseCard } from '../../emergency/card';
import { useAdvice } from '../../live/useLive';
import { formatDate, formatDateTime } from '../../lib/format';
import { readInsurance, type Insurance } from '../../profile/insurance';
import { readPersonal, type Personal } from '../../profile/personal';
import { ENTRY_TYPE_LABELS, bookingLabel } from '../../trip/schema';
import { useTrip } from '../../trip/store';
import { Button, Card, cx, Notice, Toggle } from '../../ui/kit';
import { UnlockVault } from '../vault/VaultGate';
import type { DocIndexRow } from '../../db/db';
import { vaultSession } from '../../vault/session';

function P({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-5">
      <h2 className="mb-1 border-b-2 border-ink pb-0.5 text-sm font-bold uppercase tracking-wide">{title}</h2>
      {children}
    </section>
  );
}

function Table({ rows }: { rows: ReactNode[][] }) {
  return (
    <table className="w-full border-collapse text-[0.95em]">
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-b border-line align-top">
            {r.map((c, j) => (
              <td
                key={j}
                className={cx('py-1 pr-3', j === 0 && 'font-bold', typeof c === 'string' && /^\+?[\d ]+$/.test(c) && 'whitespace-nowrap')}
              >
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Decrypted details, read only while the vault is unlocked and only for this page. */
function useVaultDetails(unlocked: boolean, withDocs: boolean) {
  const [data, setData] = useState<{ insurance: Insurance; personal: Personal; docs: { index: DocIndexRow; secret: DocSecret }[] } | null>(null);
  const docIndex = useLiveQuery(() => db.docs.toArray(), []);
  // Drop decrypted details as soon as the vault locks.
  useEffect(() => vaultSession.onLock(() => setData(null)), []);
  useEffect(() => {
    if (!unlocked) return;
    let live = true;
    void (async () => {
      const [insurance, personal] = await Promise.all([readInsurance(), readPersonal()]);
      const docs = withDocs ? (await Promise.all((docIndex ?? []).map((d) => readDocument(d.id)))).filter((d) => d !== undefined) : [];
      if (live) setData({ insurance, personal, docs });
    })();
    return () => {
      live = false;
    };
  }, [unlocked, withDocs, docIndex]);
  return unlocked ? data : null;
}

export function PrintScreen() {
  const trip = useTrip();
  const advice = useAdvice();
  const card = parseCard(useLiveQuery(() => db.meta.get(META.emergencyCard), [])?.value);
  const vault = useVaultState();
  const [withDocs, setWithDocs] = useState(false);
  const details = useVaultDetails(vault === 'unlocked', withDocs);

  const route = trip ? [...new Set(trip.stays.map((s) => s.country))] : allCountries().map((c) => c.country);
  const insurer = details?.insurance.insurer || card.insurer;
  const policy = details?.insurance.policyNumber || card.policyNumber;
  const assistance = details?.insurance.assistancePhone || card.assistancePhone;
  const ice = details?.personal.iceContacts.length ? details.personal.iceContacts : (card.iceContacts ?? []);
  const name = details?.personal.fullName || card.fullName;
  const refs = (trip?.bookings ?? [])
    .filter((b) => b.status !== 'idea' && (b.confirmation || b.addressLocal || b.address))
    .sort((a, b) => (a.depart?.date ?? '').localeCompare(b.depart?.date ?? ''));

  return (
    <>
      <div className="no-print space-y-3">
        <h1 className="text-[1.7rem] font-bold leading-tight tracking-tight">Paper backup</h1>
        <p className="text-muted">
          One page to print or save as PDF, for when the phone is lost, broken or flat. Keep it apart from your passport.
        </p>
        {vault === 'locked' && (
          <Notice title="Unlock to add your insurance, ICE contacts and documents">
            Without unlocking, the page shows what's on your emergency card.
          </Notice>
        )}
        {vault === 'locked' && <UnlockVault what="the paper backup" />}
        {vault === 'unlocked' && (
          <Card>
            <Toggle
              label="Include document numbers"
              hint="Passport and visa numbers on paper help at an embassy, but anyone who finds the page can read them."
              checked={withDocs}
              onChange={setWithDocs}
            />
          </Card>
        )}
        <Button variant="primary" className="w-full" onClick={() => window.print()}>
          Print or save as PDF
        </Button>
        <p className="pb-2 text-sm text-muted">Preview below.</p>
      </div>

      <article className="print-page rounded-2xl border border-line bg-card p-4 print:border-0 print:p-0" aria-label="Paper backup">
        <header>
          <p className="text-xl font-bold">{name ? `${name} — travel paper backup` : 'Travel paper backup'}</p>
          <p className="text-sm text-muted">
            Printed {formatDateTime(new Date().toISOString())}
            {trip && ` · ${trip.meta.title}, ${formatDate(trip.meta.depart)} – ${formatDate(trip.meta.return)}`}
          </p>
        </header>

        <P title="Dutch government, 24/7">
          <Table rows={globalContent().emergencyNumbers.map((n) => [n.label, n.number])} />
        </P>

        {(insurer || policy || assistance) && (
          <P title="Travel insurance">
            <Table
              rows={[
                ...(insurer ? [['Insurer', insurer]] : []),
                ...(policy ? [['Policy number', policy]] : []),
                ...(assistance ? [['24/7 assistance', assistance]] : []),
              ]}
            />
          </P>
        )}

        {ice.length > 0 && (
          <P title="In case of emergency">
            <Table rows={ice.map((c) => [c.relation ? `${c.name} (${c.relation})` : c.name, c.phone])} />
          </P>
        )}

        <P title="Emergency numbers">
          <Table
            rows={route.map((c) => {
              const country = getCountry(c);
              return [country?.name ?? c, country?.emergencyNumbers.map((n) => `${n.label} ${n.number}`).join(' · ') ?? ''];
            })}
          />
        </P>

        <P title="Dutch embassies and consulates">
          {advice ? (
            <Table
              rows={route.flatMap((c) =>
                (advice.countries.find((a) => a.country === c)?.representations ?? []).map((r) => [
                  r.title,
                  <>
                    {r.address.filter(Boolean).join(', ')}
                    <br />
                    {r.phones.filter((p) => !/^\+31 ?247/.test(p)).join(', ')}
                  </>,
                ]),
              ).filter((row, i, all) => all.findIndex((x) => x[0] === row[0]) === i)}
            />
          ) : (
            <p>Not downloaded yet — open the app online once, then print again.</p>
          )}
        </P>

        {trip && (
          <P title="Itinerary">
            <Table
              rows={trip.stays
                .slice()
                .sort((a, b) => a.from.localeCompare(b.from))
                .map((s) => [
                  getCountry(s.country)?.name ?? s.country,
                  `${formatDate(s.from)} – ${formatDate(s.to)} · ${ENTRY_TYPE_LABELS[s.entryType]} · in: ${s.entry.point} · out: ${s.exit.point}${s.places.length ? ` · ${s.places.join(', ')}` : ''}`,
                ])}
            />
          </P>
        )}

        {refs.length > 0 && (
          <P title="Bookings">
            <Table
              rows={refs.map((b) => [
                b.depart ? formatDate(b.depart.date) : '',
                <>
                  {bookingLabel(b)}
                  {b.provider && ` · ${b.provider}`}
                  {b.confirmation && (
                    <>
                      {' · '}
                      <span className="font-mono font-bold">{b.confirmation}</span>
                    </>
                  )}
                  {(b.addressLocal || b.address) && (
                    <>
                      <br />
                      {[b.address, b.addressLocal].filter(Boolean).join(' / ')}
                    </>
                  )}
                </>,
              ])}
            />
          </P>
        )}

        {withDocs && details && details.docs.length > 0 && (
          <P title="Documents">
            <Table
              rows={details.docs.map(({ index, secret }) => [
                DOC_TYPE_LABELS[index.type as keyof typeof DOC_TYPE_LABELS] ?? index.type,
                [secret.title, secret.number && `no. ${secret.number}`, secret.issuer, index.expiresAt && `valid until ${formatDate(index.expiresAt)}`]
                  .filter(Boolean)
                  .join(' · '),
              ])}
            />
          </P>
        )}
      </article>
    </>
  );
}
