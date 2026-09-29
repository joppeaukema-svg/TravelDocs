import { useLiveQuery } from 'dexie-react-hooks';
import { useRef, useState, type FormEvent } from 'react';
import {
  backupFileName,
  backupIsDue,
  createBackup,
  InvalidBackupError,
  markBackedUp,
  parseBackup,
  restoreBackup,
  type BackupHeader,
} from '../../backup/backup';
import { DecryptionError } from '../../crypto/aead';
import { WrongPassphraseError } from '../../crypto/keys';
import { db, META } from '../../db/db';
import { formatBytes, formatDateTime } from '../../lib/format';
import { canShareFiles, shareFile } from '../../lib/share';
import { beginExternalPick, endExternalPick } from '../../vault/autoLock';
import { DownloadIcon, ShareIcon, UploadIcon } from '../../ui/icons';
import { Button, Card, ErrorText, inputClass, Notice, PageTitle, SectionTitle } from '../../ui/kit';
import { VaultGate } from '../vault/VaultGate';

export function BackupScreen() {
  const last = useLiveQuery(() => db.meta.get(META.lastBackupAt), [])?.value as string | undefined;
  return (
    <>
      <PageTitle sub="One encrypted file with everything: trip, documents, settings.">Backup & restore</PageTitle>
      {backupIsDue(last) ? (
        <Notice tone="warn" title={last ? `Last backup: ${formatDateTime(last)}` : 'No backup yet'}>
          Back up at least weekly and keep the file off this phone — in your own cloud storage or email.
        </Notice>
      ) : (
        <Notice tone="ok" title={`Last backup: ${formatDateTime(last!)}`} />
      )}

      <SectionTitle>Make a backup</SectionTitle>
      <VaultGate what="make a backup">
        <ExportPanel />
      </VaultGate>

      <SectionTitle>Restore</SectionTitle>
      <RestorePanel />
    </>
  );
}

function ExportPanel() {
  const [backup, setBackup] = useState<{ blob: Blob; name: string; at: Date } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  async function make() {
    setBusy(true);
    setError('');
    setDone('');
    try {
      const at = new Date();
      setBackup({ blob: await createBackup(at), name: backupFileName(at), at });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function save(mode: 'share' | 'download') {
    if (!backup) return;
    setError('');
    try {
      const result = await shareFile(backup.blob, backup.name, mode);
      if (result !== 'cancelled') {
        await markBackedUp(backup.at);
        setDone(result === 'shared' ? 'Backup shared.' : 'Backup downloaded.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <Card>
      <p>The file is encrypted with your vault key: it opens only with your current passphrase.</p>
      {!backup ? (
        <Button variant="primary" className="mt-3 w-full" onClick={() => void make()} disabled={busy}>
          {busy ? 'Encrypting…' : 'Create backup'}
        </Button>
      ) : (
        <>
          <p className="mt-3 font-bold">
            {backup.name} · {formatBytes(backup.blob.size)}
          </p>
          <div className="mt-3 flex gap-2">
            {canShareFiles() && (
              <Button variant="primary" className="flex-1" onClick={() => void save('share')}>
                <ShareIcon /> Share / Save
              </Button>
            )}
            <Button className="flex-1" onClick={() => void save('download')}>
              <DownloadIcon /> Download
            </Button>
          </div>
        </>
      )}
      <ErrorText>{error}</ErrorText>
      {done && <p className="mt-2 font-bold text-ok">{done}</p>}
    </Card>
  );
}

function RestorePanel() {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ bytes: Uint8Array; header: BackupHeader; name: string } | null>(null);
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [restored, setRestored] = useState<string | null>(null);

  async function pick(f: File) {
    setError('');
    setRestored(null);
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      setFile({ bytes, header: parseBackup(bytes).header, name: f.name });
    } catch (err) {
      setFile(null);
      setError(err instanceof InvalidBackupError ? err.message : 'Could not read that file.');
    }
  }

  async function restore(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    if (!window.confirm('Replace everything on this phone with this backup?')) return;
    setBusy(true);
    setError('');
    try {
      const header = await restoreBackup(file.bytes, passphrase);
      setRestored(header.createdAt);
      setFile(null);
      setPassphrase('');
    } catch (err) {
      if (err instanceof WrongPassphraseError) setError('Wrong passphrase for this backup.');
      else if (err instanceof DecryptionError) setError('This backup file is damaged.');
      else setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <p>On a new phone: install the app, then restore the file here. Everything on this phone is replaced.</p>
      <input
        ref={input}
        type="file"
        hidden
        data-testid="restore-input"
        onChange={(e) => {
          endExternalPick();
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void pick(f);
        }}
      />
      <Button
        className="mt-3 w-full"
        onClick={() => {
          beginExternalPick();
          input.current?.click();
        }}
      >
        <UploadIcon /> Choose backup file
      </Button>

      {file && (
        <form onSubmit={restore} className="mt-4">
          <p className="mb-3">
            <span className="font-bold">{file.name}</span>
            <br />
            Made {formatDateTime(file.header.createdAt)}
          </p>
          <label htmlFor="restore-pass" className="mb-1 block font-bold">
            Passphrase used for this backup
          </label>
          <input
            id="restore-pass"
            type="password"
            autoComplete="current-password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            className={inputClass}
          />
          <Button type="submit" variant="danger" className="mt-3 w-full" disabled={busy || !passphrase}>
            {busy ? 'Restoring…' : 'Replace everything with this backup'}
          </Button>
        </form>
      )}
      <ErrorText>{error}</ErrorText>
      {restored && (
        <div className="mt-3">
          <Notice tone="ok" title="Restored">
            Everything from the backup of {formatDateTime(restored)} is back, and the vault is unlocked.
          </Notice>
        </div>
      )}
    </Card>
  );
}
