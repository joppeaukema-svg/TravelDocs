/**
 * Locks the vault after inactivity and after the app has been in the
 * background for longer than a grace period. While the user is in the
 * system file picker or camera (which sends the page to the background),
 * a much longer grace applies so they don't come back to a locked vault.
 */
export const PICKER_GRACE_MS = 10 * 60_000;

let pickerUntil = 0;

/** Call right before opening a file picker or the camera. */
export function beginExternalPick(): void {
  pickerUntil = Date.now() + PICKER_GRACE_MS;
}

/** Call when the picker returns (change or cancel). */
export function endExternalPick(): void {
  pickerUntil = 0;
}

function pickerActive(now: number): boolean {
  return now < pickerUntil;
}

export interface AutoLockOptions {
  idleMs: number;
  backgroundGraceMs: number;
  lock: () => void;
  now?: () => number;
  checkEveryMs?: number;
}

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'] as const;

export function startAutoLock({
  idleMs,
  backgroundGraceMs,
  lock,
  now = Date.now,
  checkEveryMs = 5_000,
}: AutoLockOptions): () => void {
  let lastActivity = now();
  let hiddenAt: number | null = null;
  let backgroundTimer: ReturnType<typeof setTimeout> | undefined;

  const graceNow = () => (pickerActive(now()) ? PICKER_GRACE_MS : backgroundGraceMs);
  const onActivity = () => {
    lastActivity = now();
  };

  const onVisibility = () => {
    if (document.visibilityState === 'hidden') {
      hiddenAt = now();
      clearTimeout(backgroundTimer);
      // Timers may be frozen in the background; the check on return covers that.
      backgroundTimer = setTimeout(lock, graceNow());
      return;
    }
    clearTimeout(backgroundTimer);
    if (hiddenAt !== null && now() - hiddenAt > graceNow()) lock();
    hiddenAt = null;
    lastActivity = now();
  };

  const interval = setInterval(() => {
    const t = now();
    if (!pickerActive(t) && t - lastActivity > idleMs) lock();
  }, checkEveryMs);

  for (const type of ACTIVITY_EVENTS) window.addEventListener(type, onActivity, { passive: true, capture: true });
  document.addEventListener('visibilitychange', onVisibility);

  return () => {
    clearInterval(interval);
    clearTimeout(backgroundTimer);
    for (const type of ACTIVITY_EVENTS) window.removeEventListener(type, onActivity, { capture: true });
    document.removeEventListener('visibilitychange', onVisibility);
  };
}
