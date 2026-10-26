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
  // Marking as read is written in the background: wait for it.
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve) => {
          const r = indexedDB.open('travel-companion');
          r.onsuccess = () => resolve(r.result);
        });
        const row = await new Promise<{ value?: Record<string, unknown> } | undefined>((resolve) => {
          const r = db.transaction('meta').objectStore('meta').get('adviceSeen');
          r.onsuccess = () => resolve(r.result);
        });
        db.close();
        return !!row?.value?.LA;
      }),
    )
    .toBe(true);
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
  await page.getByRole('button', { name: 'Show gluten allergy card' }).click();
  const card = page.getByRole('dialog', { name: 'Show this' });
  await expect(card).toContainText('ຂ້ອຍແພ້ກລູເຕນ');
  await expect(card).toContainText('ເຂົ້າສາລີ');
  await expect(card).toContainText('I am allergic to gluten (wheat, barley, rye and everything made with them');
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
  // Today offers it; "Not now" hides the offer, and still nothing is sent.
  await expect(page.getByText('Weather is off on this phone')).toBeVisible();
  await page.getByRole('button', { name: 'Not now' }).click();
  await expect(page.getByText('Weather is off on this phone')).toHaveCount(0);
  await page.waitForTimeout(500);
  expect(calls).toEqual([]);
});

test('weather on Today sits between the day card and Next', async ({ page }) => {
  // Fake Open-Meteo: one place, a sunny week.
  await page.route('https://geocoding-api.open-meteo.com/**', (r) =>
    r.fulfill({ json: { results: [{ latitude: 52.37, longitude: 4.89, name: 'Amsterdam', country: 'Netherlands' }] } }),
  );
  await page.route('https://api.open-meteo.com/**', (r) =>
    r.fulfill({
      json: {
        daily: {
          time: ['2028-02-01', '2028-02-02'],
          weather_code: [0, 3],
          temperature_2m_max: [21, 19],
          temperature_2m_min: [12, 11],
          precipitation_probability_max: [0, 20],
        },
      },
    }),
  );
  await page.clock.setFixedTime(new Date('2028-02-01T10:00:00'));
  await page.goto('/#/trip');
  await page.getByRole('button', { name: 'Try the demo trip' }).click();
  await expect(page.getByText('Imported 7 stays')).toBeVisible();
  // Turned on from Today's offer.
  await page.goto('/#/today');
  await page.getByRole('button', { name: 'Turn on' }).click();
  await expect(page.getByText('Clear')).toBeVisible();
  const headings = await page.getByRole('heading', { level: 2 }).allTextContents();
  const at = (name: string) => headings.findIndex((h) => h.toLowerCase() === name.toLowerCase());
  expect(at('First day of the trip')).toBeGreaterThanOrEqual(0);
  expect(at('Weather')).toBe(at('First day of the trip') + 1);
  expect(at('Next')).toBeGreaterThan(at('Weather'));
});

test('weather: each day folds open to its hours, from now on for today', async ({ page }) => {
  const hours = (date: string) => Array.from({ length: 24 }, (_, i) => `${date}T${String(i).padStart(2, '0')}:00`);
  const time = [...hours('2028-02-01'), ...hours('2028-02-02')];
  await page.route('https://geocoding-api.open-meteo.com/**', (r) =>
    r.fulfill({ json: { results: [{ latitude: 52.37, longitude: 4.89, name: 'Amsterdam', country: 'Netherlands' }] } }),
  );
  await page.route('https://api.open-meteo.com/**', (r) =>
    r.fulfill({
      json: {
        timezone: 'Europe/Amsterdam',
        daily: { time: ['2028-02-01', '2028-02-02'], weather_code: [0, 61], temperature_2m_max: [9, 7], temperature_2m_min: [2, 3], precipitation_probability_max: [0, 80] },
        hourly: {
          time,
          weather_code: time.map((_, i) => (i < 24 ? 0 : 61)),
          temperature_2m: time.map((_, i) => i % 24),
          precipitation_probability: time.map((_, i) => (i < 24 ? 0 : 70)),
          is_day: time.map((_, i) => (i % 24 >= 8 && i % 24 < 17 ? 1 : 0)),
        },
      },
    }),
  );
  await page.clock.setFixedTime(new Date('2028-02-01T10:30:00+01:00'));
  await page.goto('/#/trip');
  await page.getByRole('button', { name: 'Try the demo trip' }).click();
  await expect(page.getByText('Imported 7 stays')).toBeVisible();
  await page.goto('/#/weather');
  await page.getByText('Weather forecasts', { exact: true }).click();

  // Where you are now; today from 10:00 on.
  const here = page.locator('section').filter({ hasText: 'Now ·' });
  await here.getByLabel('1 Feb, hour by hour').click();
  const today = here.locator('details[open] ol');
  await expect(today.getByRole('listitem').first()).toContainText('10:00');
  await expect(today.getByRole('listitem')).toHaveCount(14);
  await expect(today.getByRole('listitem').last()).toContainText('🌙');
  // Tomorrow: all 24 hours, with the rain chance.
  await here.getByLabel('2 Feb, hour by hour').click();
  const tomorrow = here.locator('details[open]').last().locator('ol');
  await expect(tomorrow.getByRole('listitem')).toHaveCount(24);
  await expect(tomorrow.getByRole('listitem').nth(13)).toContainText('13:00');
  await expect(tomorrow.getByRole('listitem').nth(13)).toContainText('70%');
});
