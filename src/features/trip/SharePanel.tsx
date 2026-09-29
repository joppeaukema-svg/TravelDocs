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
  shareBytesFrom,
  shareFileName,
  sharePayload,
  shareText,
  WrongTripCodeError,
  type MergeStats,
} from '../../trip/share';
import { applySharedTrip, getTombstones, loadTrip } from '../../trip/store';
import { beginExternalPick, endExternalPick } from '../../vault/autoLock';
import { DownloadIcon, FileIcon, ShareIcon } from '../../ui/icons';
import { Button, Card, ErrorText, inputClass, Notice } from '../../ui/kit';

const pretty = (code: string) => normaliseCode(code).replace(/(.{4})(?=.)/g, '$1-');

function useTripCode(): string | null | undefined {
  return useLiveQuery(async () => ((await db.meta.get(META.shareCode))?.value as string | undefined) ?? null, []);
}

/**
 * Travelling together: the shared part of the trip (stays, bookings for both,
 * days) goes to the other phone as an encrypted text message, locked with a trip
 * code you tell each other in person. Receiving merges; personal data never leaves.
 */
export function SharePanel({ hasTrip }: { hasTrip: boolean }) {
  const code = useTripCode();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [sent, setSent] = useState('');

  // Two taps on purpose: phones only open the share sheet right after a tap, and
  // encrypting takes a moment. Tap 1 prepares the message, tap 2 sends it.
  async function prepare() {
    if (!code) return;
    setBusy(true);
    setError('');
    setSent('');
    try {
      const trip = await loadTrip();
      if (!trip) return;
      const blob = await encryptShare(sharePayload(trip, await getTombstones()), code);
      setMessage(shareText(new Uint8Array(await blob.arrayBuffer())));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function copy(text: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }

  async function sendMessage() {
    if (!message) return;
    setError('');
    if (navigator.share) {
      beginExternalPick();
      try {
        await navigator.share({ text: message });
        setSent('Sent. Your companion copies the whole message and pastes it under “Receive a shared trip”.');
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
      } finally {
        endExternalPick();
      }
    }
    // No share sheet (or it was refused): copy instead.
    setSent((await copy(message)) ? 'Copied. Paste it into WhatsApp (or any chat) and send it.' : 'Select the text below, copy it and paste it into a chat.');
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
              <p className="text-sm text-muted">Tell it to your companion in person. It is never sent with the trip.</p>
              {message ? (
                <>
                  <div className="mt-3 flex gap-2">
                    <Button variant="primary" className="flex-1" onClick={() => void sendMessage()}>
                      <ShareIcon /> Send as message
                    </Button>
                    <Button className="flex-1" onClick={() => void copy(message).then((ok) => setSent(ok ? 'Copied. Paste it into a chat and send it.' : 'Copying failed — select the text below and copy it.'))}>
                      Copy
                    </Button>
                  </div>
                  <textarea
                    readOnly
                    aria-label="Encrypted trip message"
                    data-testid="share-message"
                    value={message}
                    rows={3}
                    onFocus={(e) => e.currentTarget.select()}
                    className={`${inputClass} mt-2 font-mono text-xs`}
                  />
                  <Button variant="ghost" className="w-full" onClick={() => void shareFile(new Blob([message], { type: 'text/plain' }), shareFileName(), 'download')}>
                    <DownloadIcon /> Save as a text file instead
                  </Button>
                </>
              ) : (
                <Button variant="primary" className="mt-3 w-full" disabled={busy} onClick={() => void prepare()}>
                  <ShareIcon /> {busy ? 'Encrypting…' : 'Prepare trip to send'}
                </Button>
              )}
              {sent && <p className="mt-2 font-bold text-ok">{sent}</p>}
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
  const [pasted, setPasted] = useState('');
  const [file, setFile] = useState<{ bytes: Uint8Array; name: string } | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<{ stats: MergeStats; sentAt: string } | null>(null);

  async function receive(e: FormEvent) {
    e.preventDefault();
    setError('');
    const useCode = code || knownCode || '';
    if (!isValidCode(useCode)) return setError('A trip code has 12 letters and digits, like 7K4Q-M2PX-9RTB.');
    setBusy(true);
    try {
      const bytes = shareBytesFrom(file ? file.bytes : pasted);
      const { payload, createdAt } = await decryptShare(bytes, useCode);
      const stats = await applySharedTrip(payload);
      await setMeta(META.shareCode, normaliseCode(useCode));
      setDone({ stats, sentAt: createdAt });
      setFile(null);
      setPasted('');
      setCode('');
    } catch (err) {
      setError(
        err instanceof InvalidShareError
          ? 'That is not a shared trip. Paste the whole message, including the line starting with TC1.'
          : err instanceof WrongTripCodeError
            ? err.message
            : err instanceof Error
              ? err.message
              : String(err),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={receive} className="mt-4 border-t border-line pt-4">
      <p className="mb-1 font-bold">Receive a shared trip</p>
      <label htmlFor="share-paste" className="mb-1 block text-sm text-muted">
        Copy the whole message from your companion and paste it here.
      </label>
      <textarea
        id="share-paste"
        data-testid="share-paste"
        rows={3}
        value={file ? `(file: ${file.name})` : pasted}
        readOnly={!!file}
        onChange={(e) => {
          setDone(null);
          setPasted(e.target.value);
        }}
        placeholder="Travel Companion — our trip (encrypted)…"
        className={`${inputClass} font-mono text-xs`}
      />
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
        variant="ghost"
        className="w-full"
        onClick={() => {
          if (file) return setFile(null);
          beginExternalPick();
          input.current?.click();
        }}
      >
        <FileIcon /> {file ? 'Paste a message instead' : 'Or choose a file'}
      </Button>
      {(pasted.trim() || file) && (
        <>
          <label htmlFor="trip-code" className="mb-1 mt-2 block font-bold">
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
        </>
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
    </form>
  );
}
