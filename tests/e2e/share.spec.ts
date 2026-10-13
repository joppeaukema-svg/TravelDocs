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
  // …and leave a note on a day, for both of us.
  await page.goto('/#/trip');
  const laosA = page.locator('details').filter({ has: page.locator('summary', { hasText: 'Laos' }) });
  await laosA.locator('summary').click();
  await laosA.getByRole('button', { name: 'Plan and notes for Fri 28 Apr' }).click();
  await laosA.getByRole('textbox', { name: 'Notes' }).fill('Buy the train tickets to Vientiane');
  await laosA.getByRole('button', { name: 'Save' }).click();
  await expect(laosA.getByRole('textbox', { name: 'Notes' })).toHaveCount(0);
  await expect(laosA.getByText('Buy the train tickets to Vientiane', { exact: true })).toBeVisible();

  // …and an e-sim for one of us, with our names.
  await page.goto('/#/money/add');
  await page.getByLabel('Amount').fill('12');
  await page.getByLabel('Currency').selectOption('EUR');
  await page.getByRole('radio', { name: 'E-sims' }).click();
  await page.getByRole('button', { name: 'Set your names' }).click();
  await page.getByLabel('Name 1').fill('Alex');
  await page.getByLabel('Name 2').fill('Robin');
  await page.getByRole('button', { name: 'Save names' }).click();
  await page.getByRole('radio', { name: 'Robin' }).click();
  await page.getByLabel('Note (optional)').fill('Data for Laos');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Money' })).toBeVisible();

  await page.goto('/#/together');
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
  await b.goto('/#/together');
  await b.getByTestId('share-paste').fill(message);
  await b.getByLabel('Trip code').fill('wrong-code-abcd');
  await b.getByRole('button', { name: 'Merge into my trip' }).click();
  await expect(b.getByText(/12 letters and digits|does not open/)).toBeVisible();
  await b.getByLabel('Trip code').fill(code.toLowerCase());
  await b.getByRole('button', { name: 'Merge into my trip' }).click();
  await expect(b.getByText('Trip merged')).toBeVisible();
  await b.goto('/#/trip');
  const laosB = b.locator('details').filter({ has: b.locator('summary', { hasText: 'Laos' }) });
  await laosB.locator('summary').click();
  await expect(laosB.getByText('Buy the train tickets to Vientiane')).toBeVisible();
  // The expense came along, still for Robin.
  await b.goto('/#/money');
  await expect(b.getByText('Data for Laos')).toBeVisible();
  await expect(b.getByText(/^Robin · E-sims/)).toBeVisible();
  // A's personal booking didn't travel.
  await b.goto('/#/trip/booking/a-parkrun-osaka');
  await expect(b.getByText('This booking no longer exists')).toBeVisible();

  // B books the Ha Long cruise and sends it back.
  await b.goto('/#/trip/booking/tour-halong');
  await b.getByLabel('Status').selectOption('booked');
  await b.getByLabel('Confirmation code').fill('HALONG-42');
  await b.getByRole('button', { name: 'Save booking' }).click();
  await expect(b.getByRole('button', { name: 'Saved' })).toBeVisible();
  await b.goto('/#/together');
  await expect(b.getByTestId('trip-code')).toHaveText(code);
  // The status shows the link, what was received and what hasn't been sent yet.
  const status = b.getByTestId('share-status');
  await expect(status.getByText('Linked')).toBeVisible();
  await expect(status.getByText('Last received')).toBeVisible();
  await expect(status.getByText('not yet')).toHaveCount(1); // last sent
  await expect(b.getByTestId('unsent')).toHaveText('1 change on this phone not sent yet.');
  // Opening the app with unsent changes asks to send them.
  await b.goto('/#/today');
  await b.reload();
  const prompt = b.getByRole('dialog', { name: 'Your travel companion doesn’t have your latest changes' });
  await expect(prompt).toContainText('1 change to the trip on this phone');
  await prompt.getByRole('button', { name: 'Send now' }).click();
  await expect(b.getByRole('heading', { level: 1, name: 'Travelling together' })).toBeVisible();
  await b.getByRole('button', { name: 'Prepare trip to send' }).click();
  const back = b.waitForEvent('download');
  await b.getByRole('button', { name: 'Save as a text file instead' }).click();
  const fileB = testInfo.outputPath('from-b.txt');
  await (await back).saveAs(fileB);
  await expect(b.getByTestId('unsent')).toHaveCount(0);
  await expect(status.getByText('not yet')).toHaveCount(0);
  await phoneB.close();

  // Phone A merges: B's booking arrives, A's personal booking is still there.
  expect(readFileSync(fileB, 'utf8')).toContain('TC1.');
  await page.goto('/#/together');
  await page.getByTestId('share-input').setInputFiles(fileB);
  await page.getByRole('button', { name: 'Merge into my trip' }).click();
  await expect(page.getByText('Trip merged')).toBeVisible();
  await page.goto('/#/trip/booking/tour-halong');
  await expect(page.getByLabel('Confirmation code')).toHaveValue('HALONG-42');
  await page.goto('/#/trip/booking/a-parkrun-osaka');
  await expect(page.getByLabel('Who')).toHaveValue('me');
});
