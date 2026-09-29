import { readFileSync } from 'node:fs';
import { expect, test } from './fixtures';

// Two phones: separate browser contexts have separate storage, like two devices.
test('share the trip with a travel companion and merge their changes back', async ({ page, browser }, testInfo) => {
  // Phone A: import the trip, mark one booking as personal, create a trip code, send.
  await page.goto('/#/trip');
  await page.getByRole('button', { name: 'Try the demo trip' }).click();
  await expect(page.getByText('Imported 7 stays')).toBeVisible();
  await page.goto('/#/trip/booking/a-parkrun-osaka');
  await page.getByLabel('Who').selectOption('me');
  await page.getByRole('button', { name: 'Save booking' }).click();
  await expect(page.getByRole('button', { name: 'Saved' })).toBeVisible();

  await page.goto('/#/trip');
  await page.getByRole('button', { name: 'Create a trip code' }).click();
  const code = (await page.getByTestId('trip-code').textContent())!.trim();
  expect(code).toMatch(/^\w{4}-\w{4}-\w{4}$/);
  await page.getByRole('button', { name: 'Prepare trip to send' }).click();
  const message = await page.getByTestId('share-message').inputValue();
  expect(message).toMatch(/^Travel Companion — our trip \(encrypted\)/);
  expect(message).not.toContain('Tokashiki');

  // Phone B: receive with the code into an empty app.
  const phoneB = await browser.newContext(testInfo.project.use);
  const b = await phoneB.newPage();
  b.on('dialog', (d) => void d.accept());
  await b.goto('/#/trip');
  await b.getByTestId('share-paste').fill(message);
  await b.getByLabel('Trip code').fill('wrong-code-abcd');
  await b.getByRole('button', { name: 'Merge into my trip' }).click();
  await expect(b.getByText(/12 letters and digits|does not open/)).toBeVisible();
  await b.getByLabel('Trip code').fill(code.toLowerCase());
  await b.getByRole('button', { name: 'Merge into my trip' }).click();
  await expect(b.getByRole('link', { name: /Laos.*24 of 30 days/ })).toBeVisible();
  // A's personal booking didn't travel.
  await b.goto('/#/trip/booking/a-parkrun-osaka');
  await expect(b.getByText('This booking no longer exists')).toBeVisible();

  // B books the Ha Long cruise and sends it back.
  await b.goto('/#/trip/booking/tour-halong');
  await b.getByLabel('Status').selectOption('booked');
  await b.getByLabel('Confirmation code').fill('HALONG-42');
  await b.getByRole('button', { name: 'Save booking' }).click();
  await expect(b.getByRole('button', { name: 'Saved' })).toBeVisible();
  await b.goto('/#/trip');
  await expect(b.getByTestId('trip-code')).toHaveText(code);
  await b.getByRole('button', { name: 'Prepare trip to send' }).click();
  const back = b.waitForEvent('download');
  await b.getByRole('button', { name: 'Save as a text file instead' }).click();
  const fileB = testInfo.outputPath('from-b.txt');
  await (await back).saveAs(fileB);
  await phoneB.close();

  // Phone A merges: B's booking arrives, A's personal booking is still there.
  expect(readFileSync(fileB, 'utf8')).toContain('TC1.');
  await page.goto('/#/trip');
  await page.getByTestId('share-input').setInputFiles(fileB);
  await page.getByRole('button', { name: 'Merge into my trip' }).click();
  await expect(page.getByText('Trip merged')).toBeVisible();
  await page.goto('/#/trip/booking/tour-halong');
  await expect(page.getByLabel('Confirmation code')).toHaveValue('HALONG-42');
  await page.goto('/#/trip/booking/a-parkrun-osaka');
  await expect(page.getByLabel('Who')).toHaveValue('me');
});
