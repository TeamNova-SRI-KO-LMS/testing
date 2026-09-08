/**
 * E2E — happy paths for the public marketing and enquiry pages.
 *
 * Requirements: FR-08 (Catalogue), FR-13 (Pricing), FR-23 (Join Us),
 * NFR-05 (Usability).
 *
 * §6.2 asks for E2E coverage of "all happy paths". These are the pages a
 * prospective student sees before they have an account, so a broken one costs
 * enrolments directly.
 */

'use strict';

const { test, expect, nextId } = require('../support/fixtures');

test.describe('Public pages', () => {
  // Playwright has no `it.each`; a plain loop over the table is the idiom.
  for (const [name, path] of [
    ['home', '/'],
    ['courses', '/courses'],
    ['pricing', '/pricing'],
    ['join us', '/join-us'],
    ['help centre', '/help-center'],
    ['documentation', '/documentation'],
    ['privacy policy', '/privacy-policy'],
    ['terms of service', '/terms-of-service'],
    ['login', '/login'],
    ['register', '/register'],
  ]) {
    test(`TC-E2E-P: the ${name} page loads without a client-side error`, async ({ page }) => {
      const consoleErrors = [];
      page.on('pageerror', (error) => consoleErrors.push(error.message));

      const response = await page.goto(path);

      expect(response.status()).toBeLessThan(400);
      // An uncaught exception leaves a blank or half-rendered page, which a
      // status-code-only check would miss entirely.
      expect(consoleErrors).toEqual([]);
      await expect(page.locator('body')).not.toBeEmpty();
    });
  }

  test('TC-E2E-18: the pricing page lists all three subscription plans', async ({ page }) => {
    await page.goto('/pricing');

    for (const plan of ['Starter', 'Pro', 'Premium']) {
      await expect(page.getByText(plan, { exact: false }).first()).toBeVisible({
        timeout: 15000,
      });
    }
  });

  test('TC-E2E-19: a prospective student submits the Join Us enquiry form', async ({ page }) => {
    const id = nextId();

    await page.goto('/join-us');

    await page.fill('input[name="name"]', 'Prospective Student');
    await page.fill('input[name="email"]', `e2e.enquiry.${id}@sriko-test.lk`);

    const phone = page.locator('input[name="phone"]');
    if (await phone.count()) await phone.fill('0771234567');

    await page.click('button[type="submit"]');

    // The application confirms with a toast; either the confirmation text or a
    // cleared form is acceptable evidence that the submission was accepted.
    await expect
      .poll(
        async () => {
          const body = await page.locator('body').innerText();
          return /thank you|received|contact you/i.test(body);
        },
        { timeout: 15000, message: 'no confirmation appeared after submitting the enquiry' },
      )
      .toBe(true);
  });
});
