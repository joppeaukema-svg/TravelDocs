import { useState } from 'react';
import { formatDateTime } from '../../lib/format';
import { setSyncEnabled, SYNC_AVAILABLE, syncNow, useSyncState } from '../../sync/sync';
import { Button, Card, SectionTitle, Toggle } from '../../ui/kit';
import { useTripCode } from '../trip/SharePanel';

/** The switch for automatic sync, once this phone is linked with a trip code. */
export function SyncPanel() {
  const code = useTripCode();
  const state = useSyncState();
  const [busy, setBusy] = useState(false);
  if (!SYNC_AVAILABLE || !code || !state) return null;

  return (
    <>
      <SectionTitle>Sync automatically</SectionTitle>
      <Card>
        <Toggle
          label="Sync automatically"
          hint="Changes reach your travel companion's phone within a few minutes, without sending messages. Turn it on on both phones. The trip is encrypted on this phone with your trip code; the relay on your Cloudflare account only keeps scrambled data and never sees the code."
          checked={state.enabled}
          onChange={(on) => {
            setBusy(true);
            void setSyncEnabled(on).finally(() => setBusy(false));
          }}
        />
        {state.enabled && (
          <>
            <p className="mt-1 text-sm text-muted" aria-live="polite">
              {busy
                ? 'Syncing…'
                : state.lastSyncAt
                  ? `Last synced ${formatDateTime(state.lastSyncAt)}${state.lastReceivedAt ? ` · changes came in ${formatDateTime(state.lastReceivedAt)}` : ''}.`
                  : 'Not synced yet.'}
            </p>
            {state.error && (
              <p className="mt-1 text-sm font-bold text-warn" role="alert">
                Last try didn't work: {state.error} It tries again by itself.
              </p>
            )}
            <Button
              className="mt-3 w-full"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void syncNow().finally(() => setBusy(false));
              }}
            >
              Sync now
            </Button>
          </>
        )}
      </Card>
    </>
  );
}
