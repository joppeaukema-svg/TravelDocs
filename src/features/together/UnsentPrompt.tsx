import { useEffect, useState } from 'react';
import { go, usePath } from '../../app/hooks';
import { db, META } from '../../db/db';
import { plural } from '../../lib/format';
import { getShareStatus, loadTrip } from '../../trip/store';
import { Button } from '../../ui/kit';

/** Back after this long in the background counts as opening the app again. */
const REOPEN_AFTER_MS = 30 * 60_000;

/** Changes not sent yet, if this phone is linked with a travel companion. */
async function unsentChanges(): Promise<number> {
  const [code, trip, status] = await Promise.all([db.meta.get(META.shareCode), loadTrip(), getShareStatus()]);
  return code?.value && trip ? status.unsent : 0;
}

/**
 * When the app opens with trip changes the travel companion doesn't have yet,
 * asks once whether to send them. Never while you're editing.
 */
export function UnsentPrompt() {
  const path = usePath();
  const [unsent, setUnsent] = useState(0);

  useEffect(() => {
    let hiddenAt = 0;
    const check = () => void unsentChanges().then(setUnsent);
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') hiddenAt = Date.now();
      else if (hiddenAt && Date.now() - hiddenAt > REOPEN_AFTER_MS) check();
    };
    check();
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  if (!unsent || path.startsWith('/together')) return null;
  return (
    <div className="no-print fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" role="presentation">
      <div role="dialog" aria-modal="true" aria-labelledby="unsent-title" className="w-full max-w-md rounded-2xl border border-line bg-card p-5 shadow-xl">
        <h2 id="unsent-title" className="text-lg font-bold">
          Your travel companion doesn’t have your latest changes
        </h2>
        <p className="mt-2 text-muted">
          {plural(unsent, 'change')} to the trip on this phone since you last sent it. Send the trip so you both have the same plan.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button onClick={() => setUnsent(0)}>Later</Button>
          <Button
            variant="primary"
            onClick={() => {
              setUnsent(0);
              go('/together');
            }}
          >
            Send now
          </Button>
        </div>
      </div>
    </div>
  );
}
