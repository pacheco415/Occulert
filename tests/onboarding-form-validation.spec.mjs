import { test, expect } from '@playwright/test';

async function invitationFixture(page, signedIn = false) {
  const unexpected = [];
  page.on('request', request => {
    if (/\/(?:api|auth|rest)\//.test(request.url())) unexpected.push(request.url());
  });
  await page.route('**/occulert-backend.v60.js', route => route.fulfill({
    contentType: 'application/javascript',
    body: `
      window.invitationCalls = [];
      window.OcculertBackend = {
        currentUser: () => ${signedIn ? "({ id: 'fixture-driver', email: 'driver@example.invalid' })" : 'null'},
        signUp: async (email, password) => {
          window.invitationCalls.push({ action: 'signup', email, passwordLength: password.length });
          return { ok: true, body: { user: { id: 'pending-fixture' } } };
        },
        ensureDriverProfile: async profile => {
          window.invitationCalls.push({ action: 'profile', profile });
          return { ok: true };
        },
        acceptFleetInvitation: async token => {
          window.invitationCalls.push({ action: 'accept', token });
          return { ok: true, body: { fleet: { company_name: 'Fixture fleet' } } };
        }
      };`,
  }));
  const token = 'a'.repeat(43);
  await page.goto(`/accept-invite.html#token=${token}`);
  return { token, unexpected, calls: () => page.evaluate(() => window.invitationCalls) };
}

test('invitation account creation focuses invalid fields before contacting signup', async ({ page }) => {
  const fixture = await invitationFixture(page);
  const create = page.getByRole('button', { name: 'Create Account', exact: true });
  await create.click();
  await expect(page.getByLabel('Driver name')).toBeFocused();
  expect(await fixture.calls()).toEqual([]);

  await page.getByLabel('Driver name').fill('   ');
  await page.getByLabel('Invited email').fill('driver@example.invalid');
  await page.getByLabel('Password', { exact: true }).fill('fixture-password');
  await create.click();
  await expect(page.getByLabel('Driver name')).toBeFocused();
  expect(await fixture.calls()).toEqual([]);

  await page.getByLabel('Driver name').fill('  Fixture Driver  ');
  await page.getByLabel('Invited email').fill('invalid-email');
  await create.click();
  await expect(page.getByLabel('Invited email')).toBeFocused();
  expect(await fixture.calls()).toEqual([]);

  await page.getByLabel('Invited email').fill('driver@example.invalid');
  await page.getByLabel('Password', { exact: true }).fill('x');
  await create.click();
  await expect(page.getByLabel('Password', { exact: true })).toBeFocused();
  expect(await fixture.calls()).toEqual([]);
  await expect(create).toBeEnabled();

  await page.getByLabel('Password', { exact: true }).fill('fixture-password');
  await create.click();
  await expect(page.locator('#result')).toContainText('Confirmation required');
  await expect(page.getByLabel('Driver name')).toHaveValue('Fixture Driver');
  expect(await fixture.calls()).toEqual([{ action: 'signup', email: 'driver@example.invalid', passwordLength: 16 }]);
  expect(await page.evaluate(() => sessionStorage.getItem('occulert-invite-token'))).toBe(fixture.token);
  expect(fixture.unexpected).toEqual([]);
});

test('signed-in invitation acceptance requires a driver name before profile or membership writes', async ({ page }) => {
  const fixture = await invitationFixture(page, true);
  const accept = page.getByRole('button', { name: 'Accept Invitation', exact: true });
  await page.getByLabel('Driver name').fill('   ');
  await accept.click();
  await expect(page.getByLabel('Driver name')).toBeFocused();
  await expect(accept).toBeEnabled();
  expect(await fixture.calls()).toEqual([]);
  expect(await page.evaluate(() => sessionStorage.getItem('occulert-invite-token'))).toBe(fixture.token);

  await page.getByLabel('Driver name').fill('  Fixture Driver  ');
  await page.getByLabel('Vehicle or route').fill('Van fixture');
  await accept.click();
  await expect(page.locator('#result')).toContainText('You joined Fixture fleet');
  expect(await fixture.calls()).toEqual([
    { action: 'profile', profile: { name: 'Fixture Driver', vehicle: 'Van fixture' } },
    { action: 'accept', token: fixture.token },
  ]);
  expect(await page.evaluate(() => sessionStorage.getItem('occulert-invite-token'))).toBeNull();
  expect(fixture.unexpected).toEqual([]);
});

for (const [path, fields, selects] of [
  ['/account.html', [['Name', 'name'], ['Local app role', 'role'], ['Company', 'company'], ['Fleet ID', 'fleetId'], ['Vehicle / Route', 'vehicle'], ['Bio / Notes', 'bio']], ['role']],
  ['/driver-profiles.html', [['Name', 'name'], ['Vehicle / route', 'route'], ['Status', 'status']], ['status']],
  ['/pilot-signup.html', [], ['fleet', 'useCase', 'plan', 'timeline', 'goal']],
]) {
  test(`${path} labels focus their fields and select controls fit small touch screens`, async ({ page }) => {
    await page.goto(path);
    for (const [label, id] of fields) {
      const control = page.getByLabel(label, { exact: true });
      await expect(control).toHaveAttribute('id', id);
      await expect(control).toHaveAccessibleName(label);
      await page.locator(`label[for="${id}"]`).click();
      await expect(control).toBeFocused();
    }
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      for (const id of selects) {
        const bounds = await page.locator(`#${id}`).boundingBox();
        expect(bounds.height).toBeGreaterThanOrEqual(44);
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      }
    }
  });
}
