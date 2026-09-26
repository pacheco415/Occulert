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

async function expectSelectTextFits(control) {
  const textSpace = await control.evaluate(select => {
    const style = getComputedStyle(select);
    const inset = ['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth']
      .reduce((sum, property) => sum + parseFloat(style[property]), 0);
    // Native selects may report "normal" even when an author line-height is set.
    // Measure that browser/font's actual text line instead of guessing its metrics.
    const line = document.createElement('span');
    line.style.cssText = 'position:absolute;visibility:hidden;white-space:pre';
    line.style.font = style.font;
    line.style.lineHeight = style.lineHeight;
    line.textContent = 'Ag';
    document.body.append(line);
    const lineHeight = line.getBoundingClientRect().height;
    line.remove();
    return { contentHeight: select.getBoundingClientRect().height - inset, lineHeight };
  });
  expect(textSpace.contentHeight).toBeGreaterThanOrEqual(textSpace.lineHeight);
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
        await expectSelectTextFits(page.locator(`#${id}`));
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      }
    }
  });
}

test('larger font metrics and long option labels cannot widen the fleet trial form', async ({ page }) => {
  await page.goto('/pilot-signup.html');
  await page.locator('#pilotForm select').evaluateAll(selects => {
    for (const select of selects) {
      select.style.fontSize = '22px';
      select.style.lineHeight = '1.25';
    }
    const option = document.querySelector('#useCase option');
    option.textContent = 'Construction / field crews — regional and overnight operations';
  });
  await page.locator('#useCase').selectOption({ index: 3 });
  await expect(page.locator('#useCase')).toHaveValue('Construction / field crews');
  await page.locator('#useCase').selectOption({ index: 0 });
  await expect(page.locator('#useCase')).toHaveValue('Construction / field crews — regional and overnight operations');
  await page.locator('#useCase').focus();
  await page.keyboard.press('m');
  await expect(page.locator('#useCase')).toBeFocused();
  await expect(page.locator('#useCase')).toHaveValue('Moving trucks');
  const focus = await page.locator('#useCase').evaluate(select => {
    const style = getComputedStyle(select);
    return { width: parseFloat(style.outlineWidth), style: style.outlineStyle };
  });
  expect(focus.width).toBeGreaterThan(0);
  expect(focus.style).not.toBe('none');
  await page.locator('#useCase').selectOption({ index: 0 });
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth), { timeout: 2_000 }).toBeLessThanOrEqual(width);
    const form = await page.locator('#pilotForm').boundingBox();
    expect(form.x).toBeGreaterThanOrEqual(0);
    expect(form.x + form.width).toBeLessThanOrEqual(width);
    for (const id of ['fleet', 'useCase', 'plan', 'timeline', 'goal']) {
      const bounds = await page.locator(`#${id}`).boundingBox();
      expect(bounds.height).toBeGreaterThanOrEqual(44);
      await expectSelectTextFits(page.locator(`#${id}`));
      expect(bounds.x).toBeGreaterThanOrEqual(form.x);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(form.x + form.width);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
});

test('account dropdown arrows and keyboard selection survive both themes and reduced transparency', async ({ page }) => {
  await page.route('**/liquid-glass.v47.css', async route => {
    const response = await route.fetch();
    // Exercise the actual fallback stylesheet without depending on OS settings.
    const body = (await response.text()).replace('@media (prefers-reduced-transparency: reduce)', '@media all');
    await route.fulfill({ response, body });
  });
  await page.goto('/account.html');
  for (const theme of ['dark', 'light']) {
    await page.locator('html').evaluate((html, theme) => html.setAttribute('data-theme', theme), theme);
    await expect(page.locator('#role')).toHaveCSS('background-image', /linear-gradient/);
    await page.locator('#role').selectOption('driver');
    await page.locator('#role').focus();
    await page.keyboard.press('f');
    await expect(page.locator('#role')).toHaveValue('fleet');
    await expect(page.locator('#role')).toBeFocused();
    await expect(page.locator('#role')).toHaveCSS('outline-style', 'solid');
  }
});
