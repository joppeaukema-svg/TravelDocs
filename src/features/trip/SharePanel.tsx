import { useLiveQuery } from 'dexie-react-hooks';
import { useRef, useState, type FormEvent } from 'react';
import { db, META, setMeta } from '../../db/db';
import { formatDateTime, plural } from '../../lib/format';
import { shareFile } from '../../lib/share';
import {
  decryptShare,
  encryptShare,
  InvalidShareError,
  isValidCode,
  newTripCode,
  normaliseCode,
  shareFileName,
  sharePayload,
  WrongTripCodeError,
  type MergeStats,
} from '../../trip/share';
import { applySharedTrip, getTombstones, loadTrip } from '../../trip/store';
import { beginExternalPick, endExternalPick } from '../../vault/autoLock';
import { ShareIcon, UploadIcon } from '../../ui/icons';
import { Button, Card, ErrorText, inputClass, Notice } from '../../ui/kit';

const pretty = (code: string) => normaliseCode(code).replace(/(.{4})(?=.)/g, '$1-');

function useTripCode(): string | null | undefined {
  return useLiveQuery(async () => ((await db.meta.get(META.shareCode))?.value as string | undefined) ?? null, []);
}

/**
 * Travelling together: the shared part of the trip (stays, bookings for both,
 * days) goes to the other phone as a file encrypted with a trip code that you
 * tell each other in person. Receiving merges; personal data never leaves.
 */
export function SharePanel({ hasTrip }: { hasTrip: boolean }) {
  const code = useTripCode();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function send() {
    if (!code) return;
    setBusy(true);
    setError('');
    try {
      const trip = await loadTrip();
      if (!trip) return;
      const blob = await encryptShare(sharePayload(trip, await getTombstones()), code);
      await shareFile(blob, shareFileName());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (code === undefined) return null;
  return (
    <Card>
      <p>
        Share stays, flights, hotels and tours with your travel companion. Passports, documents, insurance, your passport
        stamps, checklist ticks and bookings marked “just me” stay on this phone.
      </p>

      {hasTrip && (
        <div className="mt-3">
          {code ? (
            <>
              <p className="text-sm font-bold uppercase tracking-wide text-muted">Trip code</p>
              <p className="font-mono text-2xl font-medium tracking-wider" data-testid="trip-code">
                {pretty(code)}
              </p>
              <p className="text-sm text-muted">Tell it to your companion in person. It is never sent with the file.</p>
              <Button variant="primary" className="mt-3 w-full" disabled={busy} onClick={() => void send()}>
                <ShareIcon /> {busy ? 'Encrypting…' : 'Send trip'}
              </Button>
            </>
          ) : (
            <Button variant="primary" className="w-full" onClick={() => void setMeta(META.shareCode, newTripCode())}>
              Create a trip code
            </Button>
          )}
        </div>
      )}
      <ErrorText>{error}</ErrorText>
      <ReceiveTrip knownCode={code} />
    </Card>
  );
}

function ReceiveTrip({ knownCode }: { knownCode: string | null }) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ bytes: Uint8Array; name: string } | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<{ stats: MergeStats; sentAt: string } | null>(null);

  async function receive(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    const useCode = code || knownCode || '';
    if (!isValidCode(useCode)) return setError('A trip code has 12 letters and digits, like 7K4Q-M2PX-9RTB.');
    setBusy(true);
    setError('');
    try {
      const { payload, createdAt } = await decryptShare(file.bytes, useCode);
      const stats = await applySharedTrip(payload);
      await setMeta(META.shareCode, normaliseCode(useCode));
      setDone({ stats, sentAt: createdAt });
      setFile(null);
      setCode('');
    } catch (err) {
      setError(
        err instanceof WrongTripCodeError || err instanceof InvalidShareError ? err.message : err instanceof Error ? err.message : String(err),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 border-t border-line pt-4">
      <input
        ref={input}
        type="file"
        hidden
        data-testid="share-input"
        onChange={(e) => {
          endExternalPick();
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          setDone(null);
          setError('');
          void f.arrayBuffer().then((b) => setFile({ bytes: new Uint8Array(b), name: f.name }));
        }}
      />
      <Button
        className="w-full"
        onClick={() => {
          beginExternalPick();
          input.current?.click();
        }}
      >
        <UploadIcon /> Receive a shared trip
      </Button>
      {file && (
        <form onSubmit={receive} className="mt-3">
          <p className="mb-2 font-bold">{file.name}</p>
          <label htmlFor="trip-code" className="mb-1 block font-bold">
            Trip code
          </label>
          <input
            id="trip-code"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            placeholder={knownCode ? pretty(knownCode) : 'XXXX-XXXX-XXXX'}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className={`${inputClass} font-mono tracking-wider`}
          />
          {knownCode && <p className="mt-1 text-sm text-muted">Leave empty to use this phone's trip code.</p>}
          <Button type="submit" variant="primary" className="mt-3 w-full" disabled={busy}>
            {busy ? 'Opening…' : 'Merge into my trip'}
          </Button>
        </form>
      )}
      <ErrorText>{error}</ErrorText>
      {done && (
        <div className="mt-3">
          <Notice tone="ok" title="Trip merged">
            From the share of {formatDateTime(done.sentAt)}: {plural(done.stats.added, 'item')} added, {done.stats.updated} updated,{' '}
            {done.stats.removed} removed. Your own passport stamps, documents and notes are unchanged.
          </Notice>
        </div>
      )}
    </div>
  );
}
