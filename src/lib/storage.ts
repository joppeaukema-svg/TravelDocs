/** Asks the browser not to evict our data under storage pressure. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (await navigator.storage?.persisted?.()) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

export interface StorageStatus {
  persisted: boolean | null;
  usage: number | null;
  quota: number | null;
}

export async function storageStatus(): Promise<StorageStatus> {
  try {
    const [persisted, estimate] = await Promise.all([
      navigator.storage?.persisted?.() ?? Promise.resolve(null),
      navigator.storage?.estimate?.() ?? Promise.resolve(undefined),
    ]);
    return { persisted, usage: estimate?.usage ?? null, quota: estimate?.quota ?? null };
  } catch {
    return { persisted: null, usage: null, quota: null };
  }
}
