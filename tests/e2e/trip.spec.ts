import { readFileSync } from 'node:fs';
import { expect, test } from './fixtures';

test('import the demo trip, see stays, checklists and export the calendar', async ({ page }, testInfo) => {
  await page.goto('/#/trip');
  await page.getByTestId('trip-input').setInputFiles('demo/trip.demo.json');
  await expect(page.getByText('Imported 7 stays')).toBeVisible();

  // Stay counters.
  await expect(page.getByRole('link', { name: /Japan.*23 of 90 days/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Vietnam.*20 of 45 days/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Laos.*24 of 30 days/ })).toBeVisible();

  // Checklists, with the Laos entry decision.
  await page.goto('/#/checklists');
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
  await page.getByRole('link', { name: /Philippines/ }).first().click();
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
