import { useEffect, useState, type FormEvent } from 'react';
import { go, useVaultState } from '../../app/hooks';
import { WrongPassphraseError } from '../../crypto/keys';
import { eraseAllData } from '../../db/db';
import { formatBytes } from '../../lib/format';
import { requestPersistentStorage, storageStatus, type StorageStatus } from '../../lib/storage';
import { updateSettings, useSettings, type Settings } from '../../settings/settings';
import { LockIcon } from '../../ui/icons';
import {
  Button,
  Card,
  ErrorText,
  LinkButton,
  Notice,
  PageTitle,
  SectionTitle,
  SelectField,
  TextField,
} from '../../ui/kit';
import { vaultSession } from '../../vault/session';
import { DemoCard } from '../../demo/DemoBanner';
import { PushSettings } from './PushSettings';
import { changePassphrase } from '../../vault/vault';

const LOCK_OPTIONS = [1, 2, 5, 10, 15, 30].map((m) => ({ value: String(m), label: `After ${m} min without use` }));
const GRACE_OPTIONS = [
  { value: '0', label: 'Immediately' },
  { value: '30', label: 'After 30 seconds' },
  { value: '60', label: 'After 1 minute' },
  { value: '300', label: 'After 5 minutes' },
];

export function SettingsScreen() {
  const settings = useSettings();
  const vault = useVaultState();

  return (
    <>
      <PageTitle>Settings</PageTitle>

      <SectionTitle>Vault</SectionTitle>
      <Card>
        {vault === 'unlocked' && (
          <Button className="mb-4 w-full" onClick={() => vaultSession.lock()}>
            <LockIcon /> Lock now
          </Button>
        )}
        <SelectField
          label="Auto-lock"
          value={String(settings.autoLockMinutes)}
          onChange={(v) => void updateSettings({ autoLockMinutes: Number(v) })}
          options={LOCK_OPTIONS}
        />
        <SelectField
          label="Lock when the app is in the background"
          value={String(settings.backgroundGraceSeconds)}
          onChange={(v) => void updateSettings({ backgroundGraceSeconds: Number(v) })}
          options={
            GRACE_OPTIONS.some((o) => o.value === String(settings.backgroundGraceSeconds))
              ? GRACE_OPTIONS
              : [...GRACE_OPTIONS, { value: String(settings.backgroundGraceSeconds), label: `${settings.backgroundGraceSeconds} s` }]
          }
          hint="Picking a photo or file doesn't count: the vault stays open for that."
        />
        {vault !== 'none' && <ChangePassphrase />}
      </Card>

      <SectionTitle>Appearance</SectionTitle>
      <Card>
        <SelectField<Settings['theme']>
          label="Theme"
          value={settings.theme}
          onChange={(theme) => void updateSettings({ theme })}
          options={[
            { value: 'system', label: 'Same as the phone' },
            { value: 'light', label: 'Light — best in sunlight' },
            { value: 'dark', label: 'Dark' },
          ]}
        />
      </Card>

      <SectionTitle>Storage</SectionTitle>
      <StoragePanel />

      <SectionTitle>Notifications</SectionTitle>
      <PushSettings />

      <SectionTitle>Demo</SectionTitle>
      <DemoCard />

      <SectionTitle>Data</SectionTitle>
      <Card>
        <LinkButton href="#/backup" className="w-full">
          Backup & restore
        </LinkButton>
        <EraseAll />
      </Card>

      <SectionTitle>What is encrypted</SectionTitle>
      <Card>
        <p>
          <strong>Encrypted with your passphrase:</strong> document titles, numbers, notes and files; personal and
          medical details; insurance details.
        </p>
        <p className="mt-2">
          <strong>Readable on this phone without it:</strong> document types and expiry dates, the fields you put on the
          emergency card, your insurance coverage limits (for the checks), settings — and from phase 2 your itinerary.
        </p>
        <p className="mt-2 text-muted">Nothing is sent anywhere. Backups encrypt everything.</p>
      </Card>
      <p className="mt-6 text-center text-sm text-muted">Travel Companion {__APP_VERSION__}</p>
    </>
  );
}

function ChangePassphrase() {
  const [open, setOpen] = useState(false);
  const [oldP, setOldP] = useState('');
  const [newP, setNewP] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  if (!open) {
    return (
      <Button variant="ghost" className="w-full" onClick={() => setOpen(true)}>
        Change passphrase
      </Button>
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (newP !== confirm) return setError('The new passphrases are different.');
    setBusy(true);
    setError('');
    try {
      await changePassphrase(oldP, newP);
      setDone(true);
      setOldP('');
      setNewP('');
      setConfirm('');
    } catch (err) {
      setError(err instanceof WrongPassphraseError ? 'The current passphrase is not right.' : err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-2 border-t border-line pt-4">
      <TextField label="Current passphrase" type="password" autoComplete="current-password" value={oldP} onChange={setOldP} />
      <TextField label="New passphrase" type="password" autoComplete="new-password" value={newP} onChange={setNewP} />
      <TextField label="New passphrase again" type="password" autoComplete="new-password" value={confirm} onChange={setConfirm} />
      <Notice tone="warn">Backups you made earlier still open with the old passphrase only. Make a new backup afterwards.</Notice>
      <ErrorText>{error}</ErrorText>
      {done && <p className="mt-2 font-bold text-ok">Passphrase changed.</p>}
      <Button type="submit" variant="primary" className="mt-3 w-full" disabled={busy || !oldP || !newP}>
        {busy ? 'Changing…' : 'Change passphrase'}
      </Button>
    </form>
  );
}

function StoragePanel() {
  const [status, setStatus] = useState<StorageStatus | null>(null);
  const refresh = () => void storageStatus().then(setStatus);
  useEffect(refresh, []);
  if (!status) return null;
  return (
    <Card>
      <p>
        <strong>Used:</strong> {status.usage !== null ? formatBytes(status.usage) : 'unknown'}
        {status.quota !== null && <span className="text-muted"> of {formatBytes(status.quota)} available</span>}
      </p>
      <p className="mt-1">
        <strong>Protected from clean-up:</strong>{' '}
        {status.persisted === null ? 'unknown' : status.persisted ? 'yes' : 'not yet'}
      </p>
      {status.persisted === false && (
        <>
          <p className="mt-2 text-muted">
            Browsers may clear data of sites you don't use for a while. Installing the app on your home screen and
            allowing persistent storage prevents that.
          </p>
          <Button className="mt-3 w-full" onClick={() => void requestPersistentStorage().then(refresh)}>
            Ask for persistent storage
          </Button>
        </>
      )}
    </Card>
  );
}

function EraseAll() {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  if (!open) {
    return (
      <Button variant="danger" className="mt-3 w-full" onClick={() => setOpen(true)}>
        Erase all data on this phone
      </Button>
    );
  }
  return (
    <div className="mt-4 border-t border-line pt-4">
      <Notice tone="crit" title="This deletes everything on this phone">
        Documents, trip, settings and the vault itself. Only a backup file can bring it back.
      </Notice>
      <div className="mt-3">
        <TextField label='Type "ERASE" to confirm' value={typed} onChange={setTyped} />
      </div>
      <div className="flex gap-2">
        <Button className="flex-1" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button
          variant="danger"
          className="flex-1"
          disabled={typed !== 'ERASE'}
          onClick={async () => {
            vaultSession.lock();
            await eraseAllData();
            go('/today');
          }}
        >
          Erase
        </Button>
      </div>
    </div>
  );
}
