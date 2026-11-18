import { expect, test } from './fixtures';

test('where you are comes first everywhere; the countries behind you fold away', async ({ page }) => {
  // The demo trip, in Laos: Japan, Vietnam and Thailand are behind you; China comes back at the end.
  await page.clock.setFixedTime(new Date('2028-04-27T10:00:00'));
  await page.goto('/#/trip');
  await page.getByRole('button', { name: 'Try the demo trip' }).click();
  await expect(page.getByText('Imported 7 stays')).toBeVisible();
  const earlier = page.locator('summary', { hasText: 'Earlier on this trip' });

  // Trip: Laos on top and open; the stays behind you folded under Earlier.
  const legs = page.locator('details.group');
  await expect(legs.first()).toContainText('Laos');
  await expect(legs.first()).toHaveAttribute('open', '');
  await expect(legs.filter({ hasText: 'Japan' })).toBeHidden();
  await earlier.click();
  await expect(legs.filter({ hasText: 'Japan' })).toBeVisible();
  await expect(legs.filter({ hasText: 'Japan' })).not.toHaveAttribute('open', '');

  // Countries: Laos first, then the rest of the route.
  await page.goto('/#/countries');
  const countries = page.locator('a[href^="#/countries/"]');
  await expect(countries.first()).toHaveAttribute('href', '#/countries/LA');
  await expect(countries.nth(1)).toHaveAttribute('href', '#/countries/PH');
  await expect(page.locator('a[href="#/countries/JP"]')).toBeHidden();
  await expect(earlier).toHaveText(/Earlier on this trip · 3/);
  await earlier.click();
  await expect(page.locator('a[href="#/countries/JP"]')).toBeVisible();

  // Phrases: Lao first; Japanese behind you.
  await page.goto('/#/phrases');
  await expect(page.locator('a[href^="#/phrases/"]').first()).toHaveAttribute('href', '#/phrases/lo');
  await expect(page.locator('a[href="#/phrases/ja"]')).toBeHidden();

  // SOS: Laos is the first tab, and chosen.
  await page.goto('/#/emergency');
  const tabs = page.getByRole('tablist', { name: 'Country' }).getByRole('tab');
  await expect(tabs.first()).toHaveText('Laos');
  await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');

  // Money: Laos on top; Japan's costs folded under Earlier.
  for (const country of ['JP', 'LA']) {
    await page.goto('/#/money/add');
    await page.getByLabel('Amount').fill('10');
    await page.getByLabel('Country').selectOption(country);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Money' })).toBeVisible();
  }
  await expect(page.getByRole('list', { name: 'Laos per category' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Japan per category' })).toBeHidden();
  await earlier.click();
  await expect(page.getByRole('list', { name: 'Japan per category' })).toBeVisible();
  // The country list of a new expense starts with where you are.
  await page.goto('/#/money/add');
  await expect(page.getByLabel('Country').locator('option').first()).toHaveAttribute('value', 'LA');
});
