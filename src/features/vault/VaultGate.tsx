import { useState, type FormEvent, type ReactNode } from 'react';
import { WrongPassphraseError } from '../../crypto/keys';
import { useVaultState } from '../../app/hooks';
import { requestPersistentStorage } from '../../lib/storage';
import { LockIcon, ShieldIcon } from '../../ui/icons';
import { Button, Card, ErrorText, inputClass, Notice } from '../../ui/kit';
import { passphraseProblem, setUpVault, unlockVault } from '../../vault/vault';

/** Renders `children` only while the vault is unlocked; otherwise set-up or unlock. */
export function VaultGate({ children, what }: { children: ReactNode; what: string }) {
  const state = useVaultState();
  if (state === 'loading') return null;
  if (state === 'none') return <SetUpVault what={what} />;
  if (state === 'locked') return <UnlockVault what={what} />;
  return <>{children}</>;
}

// A hidden username helps password managers (iCloud Keychain, Google) offer to
// save and fill the passphrase.
function UsernameHint() {
  return (
    <input
      type="text"
      name="username"
      autoComplete="username"
      value="Travel Companion vault"
      readOnly
      hidden
    />
  );
}

export function UnlockVault({ what }: { what: string }) {
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await unlockVault(passphrase);
    } catch (err) {
      setError(err instanceof WrongPassphraseError ? 'That passphrase is not right.' : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mt-2">
      <form onSubmit={submit}>
        <div className="mb-3 flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-accent-soft text-accent">
            <LockIcon />
          </span>
          <div>
            <h2 className="text-lg font-bold">Vault locked</h2>
            <p className="text-muted">Unlock to see {what}.</p>
          </div>
        </div>
        <UsernameHint />
        <label htmlFor="vault-pass" className="mb-1 block font-bold">
          Passphrase
        </label>
        <input
          id="vault-pass"
          type="password"
          autoComplete="current-password"
          autoFocus
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          className={inputClass}
        />
        <ErrorText>{error}</ErrorText>
        <Button type="submit" variant="primary" className="mt-3 w-full" disabled={busy || !passphrase}>
          {busy ? 'Unlocking…' : 'Unlock'}
        </Button>
      </form>
    </Card>
  );
}

export function SetUpVault({ what }: { what: string }) {
  const [passphrase, setPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    const problem = passphraseProblem(passphrase);
    if (problem) return setError(problem);
    if (passphrase !== confirm) return setError('The two passphrases are different.');
    setBusy(true);
    setError('');
    try {
      await setUpVault(passphrase);
      await requestPersistentStorage();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mt-2">
      <form onSubmit={submit}>
        <div className="mb-3 flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-accent-soft text-accent">
            <ShieldIcon />
          </span>
          <div>
            <h2 className="text-lg font-bold">Create your vault</h2>
            <p className="text-muted">Needed for {what}.</p>
          </div>
        </div>
        <p className="mb-3">
          Passport scans, visas, insurance papers and personal details are encrypted on this phone with a key made from
          your passphrase. Nothing leaves the phone.
        </p>
        <UsernameHint />
        <label htmlFor="new-pass" className="mb-1 block font-bold">
          Passphrase
        </label>
        <input
          id="new-pass"
          type="password"
          autoComplete="new-password"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          className={inputClass}
        />
        <p className="mb-3 mt-1 text-sm text-muted">At least 10 characters. Four random words are strong and easy to type.</p>
        <label htmlFor="confirm-pass" className="mb-1 block font-bold">
          Passphrase again
        </label>
        <input
          id="confirm-pass"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className={inputClass}
        />
        <div className="mt-4">
          <Notice tone="warn" title="There is no reset">
            If you forget the passphrase, the vault and every backup made with it can't be opened — not by anyone.
          </Notice>
        </div>
        <label className="mt-3 flex min-h-12 items-center gap-3">
          <input
            type="checkbox"
            checked={understood}
            onChange={(e) => setUnderstood(e.target.checked)}
            className="h-6 w-6 accent-accent"
          />
          <span>I've stored the passphrase somewhere safe</span>
        </label>
        <ErrorText>{error}</ErrorText>
        <Button type="submit" variant="primary" className="mt-3 w-full" disabled={busy || !understood}>
          {busy ? 'Creating…' : 'Create vault'}
        </Button>
      </form>
    </Card>
  );
}
