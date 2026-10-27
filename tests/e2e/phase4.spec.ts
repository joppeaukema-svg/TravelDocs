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
  // For both of us, by default.
  await expect(page.getByRole('radio', { name: 'Samen' })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Money' })).toBeVisible();
  await expect(page.getByText('Airport taxi')).toBeVisible();
  const thailand = page.getByRole('list', { name: 'Thailand per category' });
  await expect(thailand.getByRole('listitem').filter({ hasText: 'Transport' })).toContainText('EUR 20.00');

  // An e-sim for one of us: names are set once, in the form.
  await page.getByRole('link', { name: 'Add expense' }).click();
  await page.getByLabel('Amount').fill('12');
  await page.getByLabel('Currency').selectOption('EUR');
  await expect(page.getByRole('radio', { name: 'Flights' })).toBeVisible();
  await page.getByRole('radio', { name: 'E-sims' }).click();
  await page.getByRole('button', { name: 'Set your names' }).click();
  await page.getByLabel('Name 1').fill('Alex');
  await page.getByLabel('Name 2').fill('Robin');
  await page.getByRole('button', { name: 'Save names' }).click();
  await page.getByRole('radio', { name: 'Robin' }).click();
  await page.getByLabel('Country').selectOption('TH');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const perPerson = page.getByRole('list', { name: 'Per person' });
  await expect(perPerson.getByRole('listitem').filter({ hasText: 'Samen' })).toContainText('EUR 20.00');
  await expect(perPerson.getByRole('listitem').filter({ hasText: 'Robin' })).toContainText('EUR 12.00');
  await expect(page.getByText('With half of Samen each: Alex EUR 10.00 · Robin EUR 22.00')).toBeVisible();
  await expect(page.getByText('Robin · E-sims · Thailand')).toBeVisible();

  // Per country, per category; tapping the country shows every cost under its category.
  await expect(thailand.getByRole('listitem').filter({ hasText: 'E-sims' })).toContainText('EUR 12.00');
  await expect(thailand.getByRole('link')).toHaveCount(0);
  await page.getByRole('button', { name: /^Thailand/ }).click();
  await expect(thailand.getByRole('link', { name: /Airport taxi/ })).toBeVisible();
  await expect(thailand.getByRole('link', { name: /E-sims.*Robin/ })).toBeVisible();
  await page.getByRole('button', { name: 'Hide the costs' }).click();
  await expect(thailand.getByRole('link')).toHaveCount(0);

  await page.getByRole('button', { name: 'Set daily budget' }).first().click();
  await page.getByLabel(/Daily budget for Thailand/).fill('50');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('budget EUR 50.00 a day')).toBeVisible();

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'CSV' }).click();
  expect((await download).suggestedFilename()).toBe('expenses.csv');

  await page.getByRole('link', { name: /Airport taxi/ }).click();
  await page.getByLabel('Amount').fill('25');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(thailand.getByRole('listitem').filter({ hasText: 'Transport' })).toContainText('EUR 25.00');
  await page.getByRole('link', { name: /Airport taxi/ }).click();
  await page.getByRole('button', { name: 'Delete expense' }).click();
  await expect(page.getByText('Airport taxi')).toHaveCount(0);
});

test('Latest added shows the three expenses entered last, whatever date they are for', async ({ page }) => {
  // The last one is for a day long ago: it was still added last.
  for (const [amount, note, date] of [['1', 'First', ''], ['2', 'Second', ''], ['3', 'Third', ''], ['4', 'Fourth', '2026-01-05']]) {
    await page.goto('/#/money/add');
    await page.getByLabel('Amount').fill(amount!);
    await page.getByLabel('Currency').selectOption('EUR');
    if (date) await page.getByLabel('Date').fill(date);
    await page.getByLabel('Note (optional)').fill(note!);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Money' })).toBeVisible();
  }
  await expect(page.getByRole('heading', { name: 'Latest added' })).toBeVisible();
  // Country cards are folded, so these are the Latest rows.
  const rows = page.locator('a[href^="#/money/expense/"]');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('Fourth');
  await expect(rows.nth(0)).toContainText('5 Jan');
  await expect(rows.nth(1)).toContainText('Third');
  await expect(page.getByRole('link', { name: /First/ })).toHaveCount(0);
});

test('a new expense starts in the country you are in, in euros', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2028-04-27T10:00:00'));
  await page.goto('/#/trip');
  await page.getByRole('button', { name: 'Try the demo trip' }).click();
  await expect(page.getByText('Imported 7 stays')).toBeVisible();
  // Straight to the form, as when the app opens there: the trip is read a moment later.
  await page.goto('/#/money/add');
  await page.reload();
  await expect(page.getByLabel('Country')).toHaveValue('LA');
  await expect(page.getByLabel('Currency')).toHaveValue('EUR');
  // Another country keeps the currency; one you pick stays too, also for the next expense.
  await page.getByLabel('Country').selectOption('TH');
  await expect(page.getByLabel('Currency')).toHaveValue('EUR');
  await page.getByLabel('Amount').fill('300');
  await page.getByLabel('Currency').selectOption('THB');
  await page.getByLabel('Country').selectOption('VN');
  await expect(page.getByLabel('Currency')).toHaveValue('THB');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Latest added')).toBeVisible();
  await page.goto('/#/money/add');
  await expect(page.getByLabel('Currency')).toHaveValue('EUR');
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
