import { createVault, expect, PASSPHRASE, test } from './fixtures';

test('expenses: add, budget, edit, delete, CSV', async ({ page }) => {
  await page.goto('/#/money');
  await expect(page.getByRole('heading', { level: 1, name: 'Money' })).toBeVisible();
  await page.getByRole('link', { name: 'Add expense' }).click();
  await page.getByLabel('Amount').fill('20');
  await page.getByLabel('Currency').selectOption('EUR');
  await page.getByRole('radio', { name: 'Transport' }).click();
  await page.getByLabel('Country').selectOption('TH');
  await page.getByLabel('Note (optional)').fill('Airport taxi');
  await page.getByRole('button', { name: 'Save' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Money' })).toBeVisible();
  await expect(page.getByText('Airport taxi')).toBeVisible();
  await expect(page.getByText('Transport EUR 20.00')).toBeVisible();

  await page.getByRole('button', { name: 'Set daily budget' }).first().click();
  await page.getByLabel(/Daily budget for Thailand/).fill('50');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('budget EUR 50.00 a day')).toBeVisible();

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'CSV' }).click();
  expect((await download).suggestedFilename()).toBe('expenses.csv');

  await page.getByRole('link', { name: /Airport taxi/ }).click();
  await page.getByLabel('Amount').fill('25');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Transport EUR 25.00')).toBeVisible();
  await page.getByRole('link', { name: /Airport taxi/ }).click();
  await page.getByRole('button', { name: 'Delete expense' }).click();
  await expect(page.getByText('Airport taxi')).toHaveCount(0);
});

test('paper backup: numbers, insurance after unlocking, bookings; prints without app chrome', async ({ page }) => {
  await page.goto('/#/trip');
  await page.getByRole('button', { name: 'Try the demo trip' }).click();
  await createVault(page);
  await page.goto('/#/insurance');
  await page.getByLabel('Insurer').fill('Print Test Insurer');
  await page.getByLabel(/Policy number/).fill('PT-123');
  await page.getByRole('button', { name: 'Save insurance' }).click();
  await expect(page.getByRole('button', { name: 'Saved' })).toBeVisible();

  await page.goto('/#/print');
  const sheet = page.getByRole('article', { name: 'Paper backup' });
  await expect(sheet).toContainText('+31 247 247 247');
  await expect(sheet).toContainText('Print Test Insurer');
  await expect(sheet).toContainText('PT-123');
  await expect(sheet).toContainText('General emergency 1191');
  await expect(sheet).toContainText('Itinerary');

  await page.emulateMedia({ media: 'print' });
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Print or save as PDF' })).toBeHidden();
  await expect(sheet).toBeVisible();
});

test('demo mode uses its own data and leaves yours alone', async ({ page }) => {
  await createVault(page);
  await page.goto('/#/settings');
  await page.getByRole('button', { name: 'Try demo mode' }).click();

  await expect(page.getByText('Demo mode', { exact: true })).toBeVisible({ timeout: 15_000 });
  await page.goto('/#/money');
  await expect(page.getByText('Street food and coffee')).toBeVisible();
  await page.goto('/#/docs');
  await page.getByLabel('Passphrase').fill('demo demo demo');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByText('Passport (demo)')).toBeVisible();

  await page.getByRole('button', { name: 'Leave demo' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
  await expect(page.getByText('Demo mode', { exact: true })).toHaveCount(0);
  await page.goto('/#/docs');
  await page.getByLabel('Passphrase').fill(PASSPHRASE);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('link', { name: 'Add document' })).toBeVisible();
  await expect(page.getByText('Passport (demo)')).toHaveCount(0);
  const dbs = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
  expect(dbs).not.toContain('travel-companion-demo');
});
