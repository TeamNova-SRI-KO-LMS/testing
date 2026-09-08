/**
 * E2E — responsive layout on a phone-sized viewport.
 *
 * Requirement: NFR-05 (Usability).
 *
 * Runs under the `mobile-chrome` Playwright project as well as chromium. A
 * layout that pushes the primary action off-screen on a narrow viewport is a
 * real defect, and it is invisible to every other layer of the pyramid.
 */

'use strict';

const { test, expect } = require('../support/fixtures');

test.describe('Responsive layout', () => {
  for (const [name, path] of [
    ['home', '/'],
    ['courses', '/courses'],
    ['login', '/login'],
    ['pricing', '/pricing'],
  ]) {
    test(`TC-E2E-R: the ${name} page does not scroll horizontally`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState('networkidle');

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );

      // A couple of pixels is rounding; anything more is content escaping the
      // viewport, which on a phone means the user must pan to read the page.
      expect(overflow).toBeLessThanOrEqual(2);
    });
  }

  test('TC-E2E-20: the login form is usable on a narrow viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/login');

    const submit = page.locator('button[type="submit"]');
    await expect(page.locator('input[name="email"]')).toBeVisible();
    await expect(page.locator('input[name="password"]')).toBeVisible();
    await expect(submit).toBeVisible();

    // Visible is not the same as reachable: a control positioned outside the
    // viewport can still report as visible to the DOM.
    const box = await submit.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(375 + 2);
  });
});
