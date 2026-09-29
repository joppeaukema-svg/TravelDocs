import { expect, test as base, type Page } from '@playwright/test';

export const PASSPHRASE = 'orange lantern river piano';

/** Fails the test on any CSP violation or uncaught error. */
export const test = base.extend<{ problems: string[] }>({
  problems: [
    async ({ page }, use) => {
      const problems: string[] = [];
      page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
      page.on('console', (m) => {
        if (m.type() === 'error' && /Content Security Policy|Refused to/i.test(m.text())) problems.push(m.text());
      });
      page.on('dialog', (d) => void d.accept());
      await use(problems);
      expect(problems).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

export async function createVault(page: Page) {
  await page.goto('/#/docs');
  await page.getByLabel('Passphrase', { exact: true }).fill(PASSPHRASE);
  await page.getByLabel('Passphrase again').fill(PASSPHRASE);
  await page.getByText("I've stored the passphrase somewhere safe").click();
  await page.getByRole('button', { name: 'Create vault' }).click();
  await expect(page.getByRole('link', { name: 'Add document' })).toBeVisible();
}

/** Raw IndexedDB contents as text (binary fields as byte values), for leak checks. */
export async function dumpIndexedDb(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('travel-companion');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const out: unknown[] = [];
    for (const name of Array.from(db.objectStoreNames)) {
      const rows = await new Promise<unknown[]>((resolve, reject) => {
        const req = db.transaction(name).objectStore(name).getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      out.push(rows);
    }
    db.close();
    return JSON.stringify(out, (_k, v) =>
      v instanceof Uint8Array ? new TextDecoder('latin1').decode(v) : v,
    );
  });
}
