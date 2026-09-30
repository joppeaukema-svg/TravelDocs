import { expect, test } from './fixtures';

test('country guide: tabs, live advice with change highlighting, embassies, sources', async ({ page }) => {
  await page.goto('/#/countries');
  await expect(page.getByRole('heading', { level: 1, name: 'Countries' })).toBeVisible();
  await page.getByRole('link', { name: /Laos/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Laos' })).toBeVisible();

  // Entry & forms: the e-visa port list and the LDIF.
  await expect(page.getByText('Lao–Thai Friendship Bridge IV (Bokeo)')).toBeVisible();
  await expect(page.getByText('Laos Digital Immigration Form (arrival)')).toBeVisible();

  // Safety: the live advice and sourced facts; unverified facts carry a warning.
  await page.getByRole('link', { name: 'Safety & live advice' }).click();
  await expect(page.getByText(/Dutch travel advice, last changed/)).toBeVisible();
  await expect(page.getByText('Orange · essential travel only')).toBeVisible();
  await expect(page.locator('[data-fact=la-methanol]')).toContainText('sealed bottles');

  // Pretend the advice changed since it was read: that section gets highlighted.
  await page.getByRole('link', { name: 'Emergency', exact: true }).first().click(); // leave: marks as read
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open('travel-companion');
      r.onsuccess = () => resolve(r.result);
    });
    const tx = db.transaction('meta', 'readwrite');
    const store = tx.objectStore('meta');
    const row = await new Promise<{ key: string; value: Record<string, { hash: string; parts: Record<string, string> }> }>((resolve) => {
      const r = store.get('adviceSeen');
      r.onsuccess = () => resolve(r.result);
    });
    row.value.LA!.hash = 'old';
    row.value.LA!.parts['In het kort'] = 'old';
    store.put(row);
    await new Promise((r) => (tx.oncomplete = r));
    db.close();
  });
  await page.goto('/#/countries/LA');
  await expect(page.getByText('Advice changed')).toBeVisible();
  await page.goto('/#/countries/LA/safety');
  await expect(page.getByText('Changed since you last read it')).toBeVisible();
  await expect(page.getByText('Summary changed')).toBeVisible();

  // Emergency: numbers plus the embassy in Bangkok that covers Laos.
  await page.goto('/#/countries/LA/emergency');
  await expect(page.getByRole('link', { name: /General emergency.*1191/ })).toHaveAttribute('href', 'tel:1191');
  await expect(page.getByText('Nederlandse ambassade in Bangkok, Thailand')).toBeVisible();

  // Sources.
  await page.goto('/#/countries/LA/sources');
  await expect(page.getByRole('link', { name: 'Lao e-visa — official portal' }).first()).toBeVisible();
  await expect(page.getByText('unverified').first()).toBeVisible();
});

test('money: converter with downloaded rates and your own rate', async ({ page }) => {
  await page.goto('/#/money/convert');
  await expect(page.locator('[data-currency=THB]')).not.toHaveText('—');
  await page.getByLabel('Amount').fill('10');
  await page.getByRole('listitem').filter({ hasText: 'Thai baht' }).first().waitFor();
  const own = page.getByRole('listitem').filter({ hasText: 'Thailand' });
  await own.getByRole('button', { name: 'Set' }).click();
  await page.getByLabel('THB per euro').fill('40');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('[data-currency=THB]')).toHaveText('THB 400.00');
  await expect(page.getByText('your rate')).toBeVisible();
});

test('phrases: show-this cards in the local script', async ({ page }) => {
  await page.goto('/#/phrases');
  await page.getByRole('link', { name: /Lao/ }).click();
  await expect(page.getByText('ສະບາຍດີ')).toBeVisible();
  await page.getByRole('button', { name: 'shrimp and crab' }).click();
  await page.getByRole('button', { name: 'Show allergy card' }).click();
  const card = page.getByRole('dialog', { name: 'Show this' });
  await expect(card).toContainText('ຂ້ອຍແພ້ກຸ້ງ ແລະ ປູ');
  await expect(card).toContainText('I am allergic to shrimp and crab.');
  await card.getByRole('button', { name: 'Close' }).click();

  await page.getByLabel(/Address/).fill('ບ້ານ ວັດແສນ, ຫຼວງພະບາງ');
  await page.getByRole('button', { name: 'Show address' }).click();
  await expect(page.getByRole('dialog')).toContainText('ບ້ານ ວັດແສນ');
});

test('packing list and sources screen', async ({ page }) => {
  await page.goto('/#/checklists/packing');
  await expect(page.getByRole('heading', { level: 1, name: 'Packing' })).toBeVisible();
  const adapter = page.getByRole('checkbox', { name: 'Packed: Universal plug adapter' });
  await adapter.click();
  await expect(adapter).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: /Two spare passport photos/ }).click();
  await expect(page.locator('[data-fact=la-voa]')).toBeVisible();

  await page.goto('/#/sources');
  await expect(page.getByRole('heading', { level: 1, name: 'Sources' })).toBeVisible();
  await expect(page.getByText(/facts couldn't be confirmed/)).toBeVisible();
});

test('weather is off until you turn it on', async ({ page }) => {
  const calls: string[] = [];
  page.on('request', (r) => r.url().includes('open-meteo') && calls.push(r.url()));
  await page.goto('/#/trip');
  await page.getByRole('button', { name: 'Try the demo trip' }).click();
  await page.goto('/#/weather');
  await expect(page.getByRole('switch', { name: /Weather forecasts/ })).not.toBeChecked();
  await page.goto('/#/today');
  await page.waitForTimeout(500);
  expect(calls).toEqual([]);
});
