import { useEffect } from 'react';
import { useShareStatus } from '../trip/store';
import { syncNow, useSyncState } from './sync';

const EVERY_MS = 2 * 60_000;
const AFTER_EDIT_MS = 4_000;

/**
 * Keeps the phones in step while sync is on: when the app opens or comes back,
 * when the phone gets a connection, every two minutes while it's on screen, and
 * a few seconds after a change here.
 */
export function useAutoSync(): void {
  const on = !!useSyncState()?.enabled;
  const unsent = useShareStatus()?.unsent ?? 0;

  useEffect(() => {
    if (!on) return;
    const visible = () => document.visibilityState === 'visible';
    const nudge = () => visible() && void syncNow();
    void syncNow();
    document.addEventListener('visibilitychange', nudge);
    window.addEventListener('online', nudge);
    const timer = setInterval(nudge, EVERY_MS);
    return () => {
      document.removeEventListener('visibilitychange', nudge);
      window.removeEventListener('online', nudge);
      clearInterval(timer);
    };
  }, [on]);

  useEffect(() => {
    if (!on || !unsent) return;
    const t = setTimeout(() => void syncNow(), AFTER_EDIT_MS);
    return () => clearTimeout(t);
  }, [on, unsent]);
}
