import { test, expect } from '@playwright/test';

test('history preserves saved records beside a corrupt live record and adds numeric counters', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('occulert-session-history', JSON.stringify([{ id: 'a', name: 'Saved driver', alerts: '2', headNods: '3', safetyScore: '80' }, { id: 'b', alerts: '4', headNods: '5' }]));
    localStorage.setItem('occulert-live-session', '{bad');
  });
  await page.goto('/session-history.html');
  await expect(page.locator('#sessions')).toHaveText('2');
  await expect(page.locator('#alerts')).toHaveText('6');
  await expect(page.locator('#nods')).toHaveText('8');
  await expect(page.locator('#avgScore')).toHaveText('80');
  await expect(page.locator('#table')).toContainText('Saved driver');
  await expect(page.locator('#table')).toContainText('NOT RECORDED');
});

test('driver removal stays attached to its identity after another tab inserts a driver', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('occulert-drivers', JSON.stringify([{ id: 'a', name: 'First' }, { id: 'b', name: 'Second' }])));
  await page.goto('/driver-profiles.html');
  await expect(page.locator('[data-driver-id="b"]')).toBeVisible();
  await page.evaluate(() => {
    const old = JSON.parse(localStorage.getItem('occulert-drivers'));
    localStorage.setItem('occulert-drivers', JSON.stringify([{ id: 'c', name: 'New' }, ...old]));
  });
  await page.locator('[data-driver-id="b"]').click();
  await expect(page.locator('#drivers')).toContainText('First');
  await expect(page.locator('#drivers')).toContainText('New');
  await expect(page.locator('#drivers')).not.toContainText('Second');
});

test('malformed saved profiles stay intact when a user attempts to save', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('occulert-drivers', '{bad'));
  await page.goto('/driver-profiles.html');
  await page.locator('#name').fill('Keep this entry');
  let warningText;
  page.once('dialog', async warning => { warningText = warning.message(); await warning.accept(); });
  await page.getByRole('button', { name: 'Save Driver' }).click();
  expect(warningText).toContain('could not be read');
  await expect(page.locator('#name')).toHaveValue('Keep this entry');
  expect(await page.evaluate(() => localStorage.getItem('occulert-drivers'))).toBe('{bad');
});

async function fillLead(page) {
  await page.locator('#name').fill('Audit tester'); await page.locator('#company').fill('Synthetic fleet');
  await page.locator('#email').fill('audit@example.com');
  await page.locator('#timeline').selectOption({ index: 1 }); await page.locator('#goal').selectOption({ index: 1 });
}

test('a stalled fleet request returns control without clearing contact fields', async ({ page }) => {
  await page.clock.install();
  await page.route('**/api/pilot-leads', () => {});
  await page.goto('/pilot-signup.html'); await fillLead(page);
  await page.locator('#saveBtn').click();
  await expect(page.locator('#saveBtn')).toHaveText('Sending...');
  await page.clock.fastForward(8100);
  await expect(page.locator('#saveBtn')).toBeEnabled();
  await expect(page.locator('#error')).toContainText('could not confirm');
  await expect(page.locator('#name')).toHaveValue('Audit tester');
  await expect(page.locator('#success')).toBeHidden();
});

test('confirmed fleet requests preserve edits made while sending', async ({ page }) => {
  let finish;
  const received = new Promise(resolve => {
    page.route('**/api/pilot-leads', route => { finish = () => route.fulfill({ json: { stored: true } }); resolve(); });
  });
  await page.goto('/pilot-signup.html'); await fillLead(page);
  await page.locator('#saveBtn').click(); await received;
  await page.locator('#name').fill('Edited while sending'); await finish();
  await expect(page.locator('#success')).toBeVisible();
  await expect(page.locator('#name')).toHaveValue('Edited while sending');
  await expect(page.locator('#email')).toHaveValue('');
});
