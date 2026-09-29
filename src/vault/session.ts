/**
 * Holds the unwrapped vault key in memory only. Locking drops the reference;
 * nothing about the key is ever written to storage.
 */
let key: CryptoKey | null = null;
let version = 0;
const listeners = new Set<() => void>();
const lockHooks = new Set<() => void>();

function emit() {
  version++;
  for (const listener of listeners) listener();
}

export class VaultLockedError extends Error {
  constructor() {
    super('The vault is locked.');
    this.name = 'VaultLockedError';
  }
}

export const vaultSession = {
  isUnlocked(): boolean {
    return key !== null;
  },
  requireKey(): CryptoKey {
    if (!key) throw new VaultLockedError();
    return key;
  },
  open(k: CryptoKey): void {
    key = k;
    emit();
  },
  lock(): void {
    if (!key) return;
    key = null;
    // Let views revoke object URLs and drop decrypted data they hold.
    for (const hook of lockHooks) hook();
    emit();
  },
  /** Run `hook` whenever the vault locks. Returns an unsubscribe function. */
  onLock(hook: () => void): () => void {
    lockHooks.add(hook);
    return () => lockHooks.delete(hook);
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  snapshot(): number {
    return version;
  },
};
