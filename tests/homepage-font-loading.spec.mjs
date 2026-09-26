import { test, expect } from '@playwright/test';

test('an immediately available font stylesheet activates on initial load and reload', async ({ page }) => {
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({
    contentType: 'text/css', body: ':root{--fixture-font-stylesheet:loaded}',
  }));
  for (const reload of [false, true]) {
    if (reload) await page.reload({ waitUntil: 'domcontentloaded' });
    else await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect.poll(() => page.locator('html').evaluate(el => getComputedStyle(el).getPropertyValue('--fixture-font-stylesheet').trim())).toBe('loaded');
    await expect(page.locator('#siteNav')).toHaveCSS('position', 'fixed');
    const theme = await page.locator('html').getAttribute('data-theme');
    await page.locator('#themeToggle').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme === 'dark' ? 'light' : 'dark');
  }
});

for (const outcome of ['delayed', 'failed']) {
  test(`a ${outcome} external font stylesheet cannot block homepage layout or navigation`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    let resolveFont;
    const held = new Promise(resolve => { resolveFont = resolve; });
    let requested = false, settled = false;
    await page.route('https://fonts.googleapis.com/**', async route => {
      requested = true;
      await held;
      if (outcome === 'failed') await route.abort('failed');
      else await route.fulfill({ contentType: 'text/css', body: ':root{--fixture-font-stylesheet:loaded}' });
      settled = true;
    });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      // The external request remains unresolved throughout initial layout and interaction.
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await expect.poll(() => requested).toBe(true);
      expect(settled).toBe(false);
      await expect(page.locator('body')).toHaveCSS('font-family', /Inter, system-ui, sans-serif/);
      await expect(page.locator('#siteNav')).toHaveCSS('position', 'fixed');
      await expect(page.locator('.skip-link')).toHaveCSS('position', 'fixed');
      await page.locator('#menuBtn').click();
      await expect(page.locator('#menuBtn')).toHaveAttribute('aria-expanded', 'true');
      await page.keyboard.press('Escape');
      await expect(page.locator('#menuBtn')).toHaveAttribute('aria-expanded', 'false');
      const theme = await page.locator('html').getAttribute('data-theme');
      await page.locator('#themeToggle').click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme === 'dark' ? 'light' : 'dark');
      expect(settled).toBe(false);

      resolveFont();
      await expect.poll(() => settled).toBe(true);
      if (outcome === 'delayed') {
        await expect.poll(() => page.locator('html').evaluate(el => getComputedStyle(el).getPropertyValue('--fixture-font-stylesheet').trim())).toBe('loaded');
      }
      await expect(page.locator('body')).toHaveCSS('font-family', /Inter, system-ui, sans-serif/);
      await expect(page.locator('#siteNav')).toHaveCSS('position', 'fixed');
      await page.locator('#menuBtn').click();
      await expect(page.locator('#menuBtn')).toHaveAttribute('aria-expanded', 'true');
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
      expect(errors).toEqual([]);
    } finally {
      resolveFont();
    }
  });
}
