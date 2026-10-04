import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 } });

async function settle(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.allSettled(document.getAnimations()
      .filter(animation => Number.isFinite(animation.effect?.getComputedTiming().endTime))
      .map(animation => animation.finished));
  });
}

async function keyboardFocus(page, target) {
  for (let step = 0; step < 40; step++) {
    await page.keyboard.press('Tab');
    if (await target.evaluate(element => element === document.activeElement)) return;
  }
  throw new Error('Control was not reachable through the page tab order');
}

function contrast(foreground, background) {
  function luminance(color) {
    const match = color.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
    expect(match, 'contrast evidence requires opaque computed colors').not.toBeNull();
    const values = match.slice(1).map(channel => {
      const value = Number(channel) / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
  }
  const first = luminance(foreground), second = luminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

async function expectFocusRing(target) {
  const outline = await target.evaluate(element => {
    const style = getComputedStyle(element);
    return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) };
  });
  expect(outline.style).not.toBe('none');
  expect(outline.width).toBeGreaterThanOrEqual(2);
}

for (const preference of ['dark', 'light']) {
  test.describe(`computed controls with ${preference} preference`, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(theme => localStorage.setItem('occulert-theme', theme), preference);
      await page.emulateMedia({ colorScheme: preference });
    });

    test('dashboard reporting select remains readable and operates through its real control', async ({ page }) => {
      await page.goto('/fleet-dashboard.html', { waitUntil: 'load' });
      await settle(page);
      // This page currently uses a fixed dark theme. Do not label its light
      // preference case as evidence for a rendered light dashboard.
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      const select = page.getByLabel('Reporting window');
      const style = await select.evaluate(element => {
        const computed = getComputedStyle(element);
        return { color: computed.color, textFill: computed.webkitTextFillColor,
          background: computed.backgroundColor, height: element.getBoundingClientRect().height };
      });
      expect(style.textFill).toBe(style.color);
      expect(contrast(style.color, style.background)).toBeGreaterThanOrEqual(4.5);
      expect(style.height).toBeGreaterThanOrEqual(44);
      await keyboardFocus(page, select);
      await expectFocusRing(select);
      await select.selectOption('7');
      await expect(page.locator('#pilotWindowLabel')).toContainText('Last 7 days');
      await select.selectOption('30');
      await expect(page.locator('#pilotWindowLabel')).toContainText('Last 30 days');
    });

    test('account theme and footer navigation stay keyboard usable', async ({ page }) => {
      await page.goto('/account.html', { waitUntil: 'load' });
      await settle(page);
      await expect(page.locator('html')).toHaveAttribute('data-theme', preference);
      const toggle = page.getByRole('button', { name: 'Toggle theme' });
      const footer = page.locator('footer');
      const initialColor = await footer.evaluate(element => getComputedStyle(element).color);
      await keyboardFocus(page, toggle);
      await expectFocusRing(toggle);
      await page.keyboard.press('Space');
      await expect(page.locator('html')).toHaveAttribute('data-theme', preference === 'dark' ? 'light' : 'dark');
      await settle(page);
      expect(await footer.evaluate(element => getComputedStyle(element).color)).not.toBe(initialColor);
      const privacy = footer.getByRole('link', { name: 'Privacy', exact: true });
      await keyboardFocus(page, privacy);
      await expectFocusRing(privacy);
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/\/privacy\.html$/);
    });

    test('hub navigation and disclosure targets support keyboard interaction', async ({ page }) => {
      await page.goto('/product-hub.html', { waitUntil: 'load' });
      await settle(page);
      for (const target of await page.locator('nav .back-link, details.hub-details > summary').all()) {
        expect((await target.boundingBox()).height).toBeGreaterThanOrEqual(44);
      }
      const summary = page.locator('details.hub-details > summary').first();
      const initiallyOpen = await summary.evaluate(element => element.parentElement.open);
      await keyboardFocus(page, summary);
      await expectFocusRing(summary);
      await page.keyboard.press('Enter');
      await expect.poll(() => summary.evaluate(element => element.parentElement.open)).toBe(!initiallyOpen);
    });

    test('legal paragraphs have readable contrast on their actual opaque surface', async ({ page }) => {
      await page.goto('/safety.html', { waitUntil: 'load' });
      await settle(page);
      const colors = await page.locator('.legal-box p').first().evaluate(element => {
        const parent = getComputedStyle(element.closest('.legal-box'));
        return { foreground: getComputedStyle(element).color,
          background: parent.backgroundColor, image: parent.backgroundImage };
      });
      expect(colors.image).toBe('none');
      expect(contrast(colors.foreground, colors.background)).toBeGreaterThanOrEqual(4.5);
    });
  });
}
