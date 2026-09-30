import { useState } from 'react';
import { formatDateTime } from '../../lib/format';
import { disablePush, enablePush, pushSupport, testPush, usePushState } from '../../push/push';
import { usePushSchedule } from '../../push/usePush';
import { Button, Card, ErrorText, Notice, Toggle } from '../../ui/kit';

export function PushSettings() {
  const state = usePushState();
  const schedule = usePushSchedule();
  const support = pushSupport();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [tested, setTested] = useState(false);

  const run = (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    void fn()
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  if (support === 'unconfigured') {
    return (
      <Card>
        <p className="font-bold">Push notifications</p>
        <p className="mt-1 text-muted">
          Not set up for this copy of the app: it needs its own small push server (see “Push notifications” in the README). The
          calendar export under Trip gives you the same reminders as alarms.
        </p>
      </Card>
    );
  }
  if (support === 'demo') {
    return <Notice title="Push notifications are off in demo mode">They would reach your phone like real reminders.</Notice>;
  }
  if (support === 'needs-install') {
    return (
      <Notice title="Add the app to your Home Screen first">
        On iPhone, notifications only work from the installed app (iOS 16.4 or later): Safari → Share → Add to Home Screen, then open it
        from there.
      </Notice>
    );
  }
  if (support === 'unsupported') {
    return <Notice title="This browser can't receive push notifications">Use the calendar export under Trip for alarms instead.</Notice>;
  }
  if (state === undefined) return null;

  return (
    <Card>
      <Toggle
        label="Push notifications"
        hint="Sends your prep reminders to the push server as times with short titles like “Laos prep: 3 tasks due” — no names, documents, bookings or places."
        checked={!!state}
        onChange={(on) => run(() => (on ? enablePush(schedule) : disablePush()))}
      />
      {state && (
        <>
          <p className="mt-2 text-sm text-muted">
            {state.lastSync
              ? `${state.lastSync.entries} upcoming ${state.lastSync.entries === 1 ? 'reminder' : 'reminders'} · synced ${formatDateTime(state.lastSync.at)}`
              : 'Not synced yet.'}{' '}
            Reminders never arrive between 22:00 and 08:00 local time.
          </p>
          {state.error && <p className="mt-1 text-sm font-bold text-warn">{state.error}</p>}
          <Button
            className="mt-3 w-full"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await testPush();
                setTested(true);
              })
            }
          >
            Send a test notification
          </Button>
          {tested && <p className="mt-2 text-sm text-muted">Sent — it should arrive within a few seconds.</p>}
        </>
      )}
      <ErrorText>{error}</ErrorText>
    </Card>
  );
}
