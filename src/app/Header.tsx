import { getCountry } from '../content';
import { clock } from '../lib/format';
import { useCurrentCountry } from '../rules/useRules';
import { CloudOffIcon, LockIcon, PhoneIcon, UnlockIcon } from '../ui/icons';
import { cx } from '../ui/kit';
import { vaultSession } from '../vault/session';
import { useNow, useOnline, useVaultState } from './hooks';

export function Header({ emergencyActive }: { emergencyActive: boolean }) {
  const online = useOnline();
  const vault = useVaultState();
  const country = getCountry(useCurrentCountry().code);
  const now = useNow();

  return (
    <header className="no-print safe-top sticky top-0 z-30 border-b border-line bg-paper/92 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-xl items-center gap-2 px-4">
        <a href="#/today" className="flex min-w-0 items-center gap-2 text-ink no-underline" aria-label="Today">
          {country ? (
            <span className="flex items-center gap-2">
              <span className="rounded-md border-2 border-ink px-1.5 py-px font-mono text-sm font-medium leading-5">
                {country.country}
              </span>
              <span className="tabular truncate font-bold">{clock(country.timeZone, now).time}</span>
            </span>
          ) : (
            <span className="font-bold tracking-tight">Travel Companion</span>
          )}
        </a>
        <div className="ml-auto flex items-center gap-1.5">
          {!online && (
            <span className="flex items-center gap-1 rounded-full bg-sunk px-2.5 py-1 text-sm font-bold text-muted" role="status">
              <CloudOffIcon size={16} /> Offline
            </span>
          )}
          {vault === 'unlocked' && (
            <button
              type="button"
              onClick={() => vaultSession.lock()}
              className="grid h-11 w-11 place-items-center rounded-full text-accent active:bg-sunk"
              aria-label="Lock the vault"
              title="Lock the vault"
            >
              <UnlockIcon />
            </button>
          )}
          {vault === 'locked' && (
            <a
              href="#/docs"
              className="grid h-11 w-11 place-items-center rounded-full text-muted active:bg-sunk"
              aria-label="Vault is locked"
              title="Vault is locked"
            >
              <LockIcon />
            </a>
          )}
          <a
            href="#/emergency"
            className={cx(
              'flex h-11 items-center gap-1.5 rounded-full px-3.5 font-bold text-white no-underline shadow-sm',
              'bg-sos active:scale-95',
              emergencyActive && 'ring-4 ring-sos/30',
            )}
            aria-label="Emergency"
          >
            <PhoneIcon size={18} />
            SOS
          </a>
        </div>
      </div>
    </header>
  );
}
