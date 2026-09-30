import { expect, test } from './fixtures';

test('push: off and explained when the build has no push server; handlers ship with the service worker', async ({ page }) => {
  await page.goto('/#/settings');
  await expect(page.getByText('Push notifications', { exact: true })).toBeVisible();
  await expect(page.getByText(/Not set up for this copy of the app/)).toBeVisible();

  const sw = await (await page.request.get('/sw.js')).text();
  expect(sw).toContain('push-sw.js');
  const handlers = await page.request.get('/push-sw.js');
  expect(handlers.ok()).toBe(true);
  expect(await handlers.text()).toContain("addEventListener('push'");
});
