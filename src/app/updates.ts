import { useEffect, useSyncExternalStore } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { externalPickActive } from '../vault/autoLock';

/**
 * App updates install themselves: a new version waits until you leave the app
 * (switch apps, lock the phone) and is applied then, so it never reloads the
 * screen under your thumb and never needs a prompt. Not while a file picker or
 * share sheet is open, since that also sends the app to the background.
 */
let ready = false;
let apply: (() => Promise<void>) | null = null;
const listeners = new Set<() => void>();

function setReady(value: boolean) {
  ready = value;
  for (const l of listeners) l();
}

/** Whether a new version is downloaded and waiting. */
export function useUpdateReady(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => ready,
  );
}

/** Installs the waiting version now (reloads the app). */
export function updateNow(): void {
  void apply?.();
}

const CHECK_EVERY_MS = 60 * 60_000;

/** Registers the service worker; call once, in the app shell. */
export function useAutoUpdate(): void {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      // Look for a new version now and then while the app stays open for days.
      if (registration) setInterval(() => void registration.update().catch(() => undefined), CHECK_EVERY_MS);
    },
  });

  useEffect(() => {
    apply = () => updateServiceWorker(true);
    setReady(needRefresh);
    if (!needRefresh) return;
    const onHidden = () => {
      if (document.visibilityState === 'hidden' && !externalPickActive()) void updateServiceWorker(true);
    };
    document.addEventListener('visibilitychange', onHidden);
    return () => document.removeEventListener('visibilitychange', onHidden);
  }, [needRefresh, updateServiceWorker]);
}
