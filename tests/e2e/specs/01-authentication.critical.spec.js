/**
 * E2E — Critical flow 1 of 3: authentication and session handling.
 *
 * Requirements: FR-01 (Registration), FR-02 (Login), FR-04 (Session),
 * FR-05 (RBAC), NFR-05 (Usability).
 *
 * SENG 34213 §6.2 names E2E coverage of the top three critical flows. Nothing
 * else in the product is reachable if a user cannot get in, so this is first.
 */

'use strict';

const { test, expect, VALID_PASSWORD, nextId } = require('../support/fixtures');

test.describe('Critical flow: registration, login and session', () => {
  test('TC-E2E-01: a visitor registers, lands on the dashboard and stays signed in', async ({
    page,
    app,
  }) => {
    const id = nextId();
    const email = `e2e.signup.${id}@sriko-test.lk`;

    await page.goto('/register');

    await page.fill('input[name="name"]', 'Ayesha Perera');
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', VALID_PASSWORD);

    // The form has a confirmation field on some builds; fill it when present
    // rather than making the whole flow depend on a field that may not exist.
    const confirmPassword = page.locator('input[name="confirmPassword"]');
    if (await confirmPassword.count()) {
      await confirmPassword.fill(VALID_PASSWORD);
    }

    await page.click('button[type="submit"]');

    await expect
      .poll(() => app.storedToken(), { timeout: 15000, message: 'no session token was stored' })
      .not.toBeNull();

    // A session that does not survive a reload is not a session.
    await page.reload();
    expect(await app.storedToken()).not.toBeNull();
  });

  test('TC-E2E-02: a registered user signs in and reaches their dashboard', async ({
    page,
    app,
    api,
  }) => {
    const student = await api.createStudent({ name: 'Ayesha Perera' });

    await app.login(student.email);

    await page.goto('/dashboard');
    // The guarded route must render rather than bounce back to /login.
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('TC-E2E-03: an incorrect password is refused and no session is created', async ({
    page,
    app,
    api,
  }) => {
    const student = await api.createStudent();

    await app.gotoLogin();
    await page.fill('input[name="email"]', student.email);
    await page.fill('input[name="password"]', 'WrongPass123');
    await page.click('button[type="submit"]');

    // The user stays on the login screen and no token is written.
    await expect(page).toHaveURL(/\/login/);
    expect(await app.storedToken()).toBeNull();
  });

  test('TC-E2E-04: an unauthenticated visitor is redirected away from a guarded page', async ({
    page,
  }) => {
    await page.goto('/dashboard');

    await expect(page).toHaveURL(/\/login/);
  });

  test.describe('role-based access', () => {
    test('TC-E2E-05: a student cannot reach the administrative console', async ({
      page,
      app,
      api,
    }) => {
      // The API refuses the data regardless — the security suite proves that.
      // What this checks is that the UI does not present an administrative
      // screen to somebody who will only see errors on it.
      const student = await api.createStudent();
      await app.login(student.email);

      await page.goto('/admin/dashboard');

      await expect(page).not.toHaveURL(/\/admin\/dashboard/);
    });

    test('TC-E2E-06: an administrator signs in and reaches the console', async ({
      page,
      app,
      api,
    }) => {
      const admin = await api.createAdmin({ name: 'Site Administrator' });

      await app.loginAsAdmin(admin.email);

      await page.goto('/admin/dashboard');
      await expect(page).toHaveURL(/\/admin\/dashboard/);
    });
  });

  test('TC-E2E-07: signing out clears the session and re-guards protected pages', async ({
    page,
    app,
    api,
  }) => {
    const student = await api.createStudent();
    await app.login(student.email);

    await app.logout();

    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });
});
