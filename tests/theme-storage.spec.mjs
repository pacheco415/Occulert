import { test, expect } from '@playwright/test';

for (const operation of ['read', 'write']) {
  for (const [label, path, script] of [
    ['homepage', '/', '/homepage.v60.js'],
    ['public', '/faq.html', '/public-page.v60.js'],
    ['static', '/product-hub.html', '/static-page.v60.js'],
  ]) {
    test(`${label} controls remain usable with blocked theme ${operation}`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
      await page.addInitScript(operation => {
        const method = operation === 'read' ? 'getItem' : 'setItem';
        const original = Storage.prototype[method];
        Storage.prototype[method] = function (key, ...args) {
          if (this === localStorage && key === 'occulert-theme') {
            throw new DOMException('Theme preference storage is blocked', 'SecurityError');
          }
          return original.call(this, key, ...args);
        };
      }, operation);
      const errors = [], requests = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('request', request => {
        if (/\/api\/|\/auth\/v1\//.test(request.url())) requests.push(request.url());
      });
      await page.goto(path, { waitUntil: 'domcontentloaded' });
      await expect(page.locator(`script[src="${script}"]`)).toHaveCount(1);
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
      await page.locator('#themeToggle').click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      await expect(page.locator('#themeToggle')).toHaveText('🌙');
      await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#0a0e1a');
      if (label === 'static') {
        await expect(page.locator('#themeToggle')).toHaveAttribute('aria-label', 'Use light theme');
        await page.locator('.skip-link').focus();
        await page.keyboard.press('Enter');
        await expect(page.locator('#main-content')).toBeFocused();
      } else {
        await page.locator('#menuBtn').click();
        await expect(page.locator('#menuBtn')).toHaveAttribute('aria-expanded', 'true');
        await expect(page.locator('#mobileMenu')).toHaveAttribute('aria-hidden', 'false');
        await page.locator('#themeToggleMobile').click();
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
        await expect(page.locator('#themeToggleMobile')).toHaveText('☀️ Light Mode');
        await expect(page.locator('#menuBtn')).toHaveAttribute('aria-expanded', 'false');
        await expect(page.locator('#mobileMenu')).toHaveAttribute('aria-hidden', 'true');
        if (label === 'public') {
          const question = page.locator('.faq-q').first();
          await question.click();
          await expect(question).toHaveAttribute('aria-expanded', 'true');
        } else {
          await page.locator('[data-journey-step="3"]').click();
          await expect(page.locator('#safetyJourney')).toHaveAttribute('data-stage', '3');
        }
      }
      expect(errors).toEqual([]);
      expect(requests).toEqual([]);
    });
  }
}
