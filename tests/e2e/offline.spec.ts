import { createVault, expect, test } from './fixtures';

// Offline support comes from the service worker's precache, which behaves the
// same on every platform. Playwright only drives service workers reliably in
// Chromium, so this runs there; the phone checklist in the README covers iOS.
test.skip(({ browserName }) => browserName !== 'chromium', 'service workers are driven via Chromium');

test('works in airplane mode after the first load', async ({ page, context }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload(); // now controlled by the service worker
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await createVault(page);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText('Offline', { exact: true })).toBeVisible();

  for (const [path, heading] of [
    ['/#/today', 'Today'],
    ['/#/docs', 'Documents'],
    ['/#/countries', 'Countries'],
    ['/#/countries/LA', 'Laos'],
    ['/#/emergency', 'Emergency'],
    ['/#/settings', 'Settings'],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
  }
  // Live data downloaded while online is still there.
  await page.goto('/#/countries/LA/safety');
  await expect(page.getByText(/Dutch travel advice, last changed/)).toBeVisible();
  await page.goto('/#/money/convert');
  await expect(page.getByText(/offline, using the last rates/).first()).toBeVisible();
  await expect(page.locator('[data-currency=THB]')).not.toHaveText('—');
  await page.goto('/#/phrases/th');
  await expect(page.getByRole('heading', { level: 1, name: 'Thai' })).toBeVisible();

  // The vault still unlocks offline.
  await page.goto('/#/docs');
  await page.getByLabel('Passphrase').fill('orange lantern river piano');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('link', { name: 'Add document' })).toBeVisible();
  await context.setOffline(false);
});
