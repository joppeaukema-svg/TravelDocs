import { expect, test } from './fixtures';

test('tabs and the emergency button work on every screen', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();

  for (const [tab, heading] of [
    ['Trip', 'Trip'],
    ['Docs', 'Documents'],
    ['Countries', 'Countries'],
    ['More', 'More'],
    ['Today', 'Today'],
  ] as const) {
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: tab }).click();
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Emergency', exact: true })).toBeVisible();
  }

  await page.getByRole('link', { name: 'Emergency', exact: true }).click();
  await page.getByRole('tab', { name: 'Japan' }).click();
  const police = page.getByRole('link', { name: /Police.*110/ });
  await expect(police).toHaveAttribute('href', 'tel:110');
  await expect(page.getByRole('link', { name: /Foreign Affairs \(24\/7\)/ })).toHaveAttribute('href', 'tel:+31247247247');
});

test('choosing a country shows its local time and Dutch time', async ({ page }) => {
  await page.goto('/#/today');
  await page.getByRole('button', { name: 'Vietnam' }).click();
  await expect(page.getByText('You are in')).toBeVisible();
  await expect(page.getByText('Netherlands')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Today' }).first()).toContainText('VN');
});

test('is installable: manifest, icons and service worker', async ({ page }) => {
  await page.goto('/');
  const manifestHref = await page.locator('link[rel=manifest]').getAttribute('href');
  const manifest = await (await page.request.get(new URL(manifestHref!, page.url()).href)).json();
  expect(manifest.display).toBe('standalone');
  expect(manifest.icons.map((i: { sizes: string }) => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
  for (const icon of manifest.icons) {
    expect((await page.request.get(new URL(icon.src, page.url()).href)).ok()).toBe(true);
  }
  expect((await page.request.get('/apple-touch-icon.png')).ok()).toBe(true);
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
  expect(scope).toBe(new URL('/', page.url()).href);
});
