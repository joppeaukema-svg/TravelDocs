import { readFileSync } from 'node:fs';
import { createVault, dumpIndexedDb, expect, PASSPHRASE, test } from './fixtures';

test('vault data is unreadable without the passphrase; export → wipe → import restores everything', async ({ page }, testInfo) => {
  await createVault(page);

  // A document with a photo.
  await page.getByRole('link', { name: 'Add document' }).click();
  await page.getByLabel('Title').fill('Demo passport');
  await page.getByLabel('Document number').fill('DEMO123456');
  await page.getByLabel('Expiry date').fill('2031-05-01');
  await page.getByRole('button', { name: 'Save and add files' }).click();
  await expect(page.getByRole('heading', { name: 'Demo passport' })).toBeVisible();
  await page.locator('input[type=file][accept="image/*,application/pdf,.pdf"]').setInputFiles({
    name: 'passport-photo-page.png',
    mimeType: 'image/png',
    buffer: readFileSync('public/icons/icon-512.png'),
  });
  await expect(page.getByRole('button', { name: 'Open passport-photo-page.png' })).toBeVisible();

  // Insurance, which also feeds the emergency card.
  await page.goto('/#/insurance');
  await page.getByLabel('Insurer').fill('Demo Insurer');
  await page.getByLabel('Policy number').fill('POLICY-777');
  await page.getByLabel('24/7 assistance number').fill('+31 20 000 0000');
  await page.getByRole('button', { name: 'Save insurance' }).click();
  await expect(page.getByRole('button', { name: 'Saved' })).toBeVisible();

  // Locked: the vault gate shows, the emergency card still works, nothing is readable at rest.
  await page.getByRole('button', { name: 'Lock the vault' }).click();
  await page.goto('/#/docs');
  await expect(page.getByRole('heading', { name: 'Vault locked' })).toBeVisible();
  await page.goto('/#/emergency');
  await expect(page.getByText('POLICY-777')).toBeVisible();
  const raw = await dumpIndexedDb(page);
  for (const secret of ['Demo passport', 'DEMO123456', 'passport-photo-page']) {
    expect(raw).not.toContain(secret);
  }
  // Only the fields chosen for the emergency card (insurer and policy number by default) are in plaintext.
  expect(raw).toContain('POLICY-777');
  expect(raw).toContain('Demo Insurer');

  // Export.
  await page.goto('/#/backup');
  await page.getByLabel('Passphrase').fill(PASSPHRASE);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await page.getByRole('button', { name: 'Create backup' }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^travel-companion-\d{4}-\d{2}-\d{2}\.tcbackup$/);
  const backupPath = testInfo.outputPath('backup.tcbackup');
  await download.saveAs(backupPath);
  expect(readFileSync(backupPath).toString('latin1')).not.toContain('Demo passport');

  // Wipe.
  await page.goto('/#/settings');
  await page.getByRole('button', { name: 'Erase all data on this phone' }).click();
  await page.getByLabel('Type "ERASE" to confirm').fill('ERASE');
  await page.getByRole('button', { name: 'Erase', exact: true }).click();
  // The app returns to Today once erasing has finished.
  await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
  await page.goto('/#/docs');
  await expect(page.getByRole('heading', { name: 'Create your vault' })).toBeVisible();

  // Import.
  await page.goto('/#/backup');
  await page.getByTestId('restore-input').setInputFiles(backupPath);
  await page.getByLabel('Passphrase used for this backup').fill('wrong passphrase here');
  await page.getByRole('button', { name: 'Replace everything with this backup' }).click();
  await expect(page.getByText('Wrong passphrase for this backup.')).toBeVisible();
  await page.getByLabel('Passphrase used for this backup').fill(PASSPHRASE);
  await page.getByRole('button', { name: 'Replace everything with this backup' }).click();
  await expect(page.getByText('Restored', { exact: true })).toBeVisible();

  // Everything is back.
  await page.goto('/#/docs');
  await page.getByRole('link', { name: /Demo passport/ }).click();
  await expect(page.getByLabel('Document number')).toHaveValue('DEMO123456');
  await page.getByRole('button', { name: 'Open passport-photo-page.png' }).click();
  await expect(page.getByRole('dialog').getByRole('img', { name: 'passport-photo-page.png' })).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();
  await page.goto('/#/emergency');
  await expect(page.getByText('POLICY-777')).toBeVisible();
  await page.goto('/#/insurance');
  await expect(page.getByLabel('Insurer')).toHaveValue('Demo Insurer');
});
