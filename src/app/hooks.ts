import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { db, META } from '../db/db';
import { vaultSession } from '../vault/session';

// --- Hash router -------------------------------------------------------------
// Hash routes survive any static host (and a GitHub Pages sub-path) without
// server rewrites, and work offline from the precached index.html.

function subscribeHash(cb: () => void) {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
}

export const DEFAULT_PATH = '/today';

export function currentPath(): string {
  const path = window.location.hash.replace(/^#/, '');
  return path.startsWith('/') ? path : DEFAULT_PATH;
}

export function usePath(): string {
  return useSyncExternalStore(subscribeHash, currentPath, () => DEFAULT_PATH);
}

export function go(path: string): void {
  window.location.hash = path;
}

/** Matches "/docs/:id" against "/docs/abc" → { id: "abc" }. */
export function matchPath(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split('/');
  const a = path.split('?')[0]!.split('/');
  if (p.length !== a.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    const seg = p[i]!;
    if (seg.startsWith(':')) params[seg.slice(1)] = decodeURIComponent(a[i]!);
    else if (seg !== a[i]) return null;
  }
  return params;
}

// --- Vault state -------------------------------------------------------------

export type VaultState = 'loading' | 'none' | 'locked' | 'unlocked';

export function useVaultState(): VaultState {
  useSyncExternalStore(vaultSession.subscribe, vaultSession.snapshot);
  const keys = useLiveQuery(async () => (await db.meta.get(META.vaultKeys)) ?? null, []);
  if (keys === undefined) return 'loading';
  if (keys === null) return 'none';
  return vaultSession.isUnlocked() ? 'unlocked' : 'locked';
}

// --- Environment -------------------------------------------------------------

function subscribeOnline(cb: () => void) {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
}

export function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
}

/** Current time, refreshed every `everyMs`. */
export function useNow(everyMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}
