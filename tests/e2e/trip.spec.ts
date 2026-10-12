import { readFileSync } from 'node:fs';
import { expect, test } from './fixtures';

test('import the demo trip, see stays, checklists and export the calendar', async ({ page }, testInfo) => {
  await page.goto('/#/trip');
  await page.getByTestId('trip-input').setInputFiles('demo/trip.demo.json');
  await expect(page.getByText('Imported 7 stays')).toBeVisible();

  // Day by day: one fold per country with every day; visa counters aren't on this screen.
  const japan = page.locator('details').filter({ has: page.locator('summary', { hasText: 'Japan' }) });
  await japan.locator('summary').click();
  await expect(japan.getByRole('list', { name: 'Japan, day by day' }).getByRole('listitem')).toHaveCount(23);
  await expect(japan.getByText('Flight: Fukuoka (FUK) → Okinawa Naha (OKA)').first()).toBeVisible();
  await expect(page.getByText(/of 90 days/)).toHaveCount(0);
  // Checks show per country; the full list is in Checklists.
  const vietnam = page.locator('details').filter({ has: page.locator('summary', { hasText: 'Vietnam' }) });
  await expect(vietnam.locator('summary')).toContainText('to check');
  await vietnam.locator('summary').click();
  await expect(vietnam.getByText('To check', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Checks' })).toHaveCount(0);
  await page.goto('/#/today');
  await expect(page.getByRole('heading', { name: 'Checks' })).toHaveCount(0);

  // Checklists, with the checks and the Laos entry decision.
  await page.goto('/#/checklists');
  await expect(page.getByRole('heading', { name: 'Checks' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Before you leave/ })).toBeVisible();
  await page.getByRole('link', { name: /^Laos/ }).click();
  const decide = page.getByRole('button', { name: /Laos: e-visa or visa on arrival/ });
  await expect(decide).toBeVisible();
  await decide.click();
  await expect(page.getByText('laoevisa.gov.la').first()).toBeVisible();
  await page.getByRole('checkbox', { name: /Done: Laos: e-visa or visa on arrival/ }).click();
  await expect(page.getByRole('checkbox', { name: /Done: Laos: e-visa or visa on arrival/ })).toHaveAttribute('aria-checked', 'true');

  // Calendar export.
  await page.goto('/#/trip');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Calendar with prep reminders (.ics)' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('trip-prep.ics');
  const path = testInfo.outputPath('trip.ics');
  await download.saveAs(path);
  const ics = readFileSync(path, 'utf8');
  expect(ics).toMatch(/^BEGIN:VCALENDAR\r\n/);
  expect(ics).toContain('SUMMARY:Laos–China Railway sales open for Vang Vieng → Vientiane');
  expect(ics).toContain('BEGIN:VALARM');
});

test('editing a stay: the stamped date wins', async ({ page }) => {
  await page.goto('/#/trip');
  await page.getByRole('button', { name: 'Try the demo trip' }).click();
  const ph = page.locator('details').filter({ has: page.locator('summary', { hasText: 'Philippines' }) });
  await ph.locator('summary').click();
  await ph.getByRole('link', { name: 'Edit stay' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Philippines' })).toBeVisible();
  const from = await page.getByLabel('Planned arrival').inputValue();
  // A stamp 10 days after arrival makes the planned 22-day stay too long.
  const stamp = new Date(Date.parse(from) + 9 * 86_400_000).toISOString().slice(0, 10);
  await page.getByLabel('Valid until (stamped in your passport)').fill(stamp);
  await page.getByRole('button', { name: 'Save stay' }).click();
  await expect(page.getByText('(from your passport stamp)')).toBeVisible();
  await expect(page.getByRole('button', { name: /longer than the 30-day limit|allows/ }).first()).toBeVisible();
});

test('a flight across time zones shows local times at both ends', async ({ page }) => {
  await page.goto('/#/trip');
  await page.getByRole('button', { name: 'Try the demo trip' }).click();
  await expect(page.getByText('Imported 7 stays')).toBeVisible();
  await page.goto('/#/trip/booking/f-fuk-han');
  await expect(page.getByText(/08:55 Tokyo \(UTC\+9\)/)).toBeVisible();
  await expect(page.getByText(/12:25 Ho Chi Minh \(UTC\+7\)/)).toBeVisible();
  await expect(page.getByText('Takes 5 h 30 min')).toBeVisible();
});

test('an update file changes only what it lists, after a preview', async ({ page }) => {
  await page.goto('/#/trip');
  await page.getByRole('button', { name: 'Try the demo trip' }).click();
  await expect(page.getByText('Day by day')).toBeVisible();

  const update = {
    format: 'travel-companion-update/1',
    title: 'Flights',
    bookings: [
      { id: 'f-fuk-oka', status: 'booked', title: 'XX123 Fukuoka → Okinawa', provider: 'Test Air' },
      { id: 'test-ferry', type: 'ferry', status: 'planned', from: 'Harbour A', to: 'Harbour B', title: 'Test ferry' },
    ],
  };
  await page.goto('/#/together');
  await page.getByTestId('trip-input').setInputFiles({
    name: 'flights-update.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(update)),
  });

  const changes = page.getByRole('list', { name: 'Changes' });
  await expect(changes).toContainText('XX123 Fukuoka → Okinawa');
  await expect(changes).toContainText('status');
  await expect(changes).toContainText('Test ferry');
  await page.getByRole('button', { name: 'Apply 2 changes' }).click();
  await expect(page.getByText('Trip updated: 2 changes')).toBeVisible();

  await page.goto('/#/trip/booking/f-fuk-oka');
  await expect(page.getByLabel('Title')).toHaveValue('XX123 Fukuoka → Okinawa');
  await expect(page.getByLabel('From')).toHaveValue('Fukuoka (FUK)');
});

test('notes on a day: added on Trip, shown on Today', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2028-03-20T10:00:00'));
  await page.goto('/#/trip');
  await page.getByRole('button', { name: 'Try the demo trip' }).click();
  await expect(page.getByText('Imported 7 stays')).toBeVisible();

  // The fold of the country you're in is open.
  const japan = page.locator('details').filter({ has: page.locator('summary', { hasText: 'Japan' }) });
  await expect(japan).toHaveAttribute('open', '');
  await japan.getByRole('button', { name: 'Plan and notes for Mon 20 Mar' }).click();
  await japan.getByRole('textbox', { name: 'Place' }).fill('Kyoto');
  await japan.getByRole('textbox', { name: 'Notes' }).fill('Book the train ticket today');
  await japan.getByRole('button', { name: 'Save' }).click();
  await expect(japan.getByRole('textbox', { name: 'Notes' })).toHaveCount(0);
  await expect(japan.getByText('Book the train ticket today', { exact: true })).toBeVisible();

  await page.goto('/#/today');
  await expect(page.getByRole('heading', { name: "Today's plan" })).toBeVisible();
  const plan = page.locator('section').filter({ hasText: 'Book the train ticket today' });
  await expect(plan).toBeVisible();
  await expect(plan.getByText('Kyoto', { exact: true })).toBeVisible();
});
