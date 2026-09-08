/**
 * Playwright fixtures and page helpers for the end-to-end layer.
 *
 * Two principles, both aimed at the failure mode that ruins E2E suites — tests
 * that pass one day and fail the next for reasons unrelated to the product:
 *
 *   1. **Set up through the API, assert through the UI.** Creating an
 *      administrator by clicking through a registration form makes every admin
 *      test depend on the registration screen. Fixtures are created over HTTP;
 *      only the behaviour under test is driven with a browser.
 *
 *   2. **Address elements the way a user does.** Roles, labels and visible text
 *      first; a CSS selector only where the markup offers nothing better. A
 *      test tied to `.css-1x2y3z` breaks on the next restyle without any
 *      behaviour changing.
 */

'use strict';

const { test: base, expect } = require('@playwright/test');

const { config } = require('../../../src/support/sut');

const BACKEND_URL = process.env.E2E_BACKEND_URL || config.e2e.backendUrl;

let sequence = 0;
const nextId = () => {
  sequence += 1;
  return `${Date.now().toString(36)}-${process.pid}-${sequence}`;
};

const VALID_PASSWORD = 'TestPass123';

/**
 * A thin API client for building preconditions.
 *
 * Uses Playwright's own request context so it shares the run's proxy and TLS
 * settings, and so failures surface in the same trace as the browser steps.
 */
class ApiHelper {
  constructor(request) {
    this.request = request;
  }

  async register(overrides = {}) {
    const id = nextId();
    const payload = {
      name: `E2E User ${id}`,
      email: `e2e.${id}@sriko-test.lk`,
      password: VALID_PASSWORD,
      role: 'student',
      ...overrides,
    };

    const response = await this.request.post(`${BACKEND_URL}/api/auth/register`, {
      data: payload,
    });

    if (!response.ok()) {
      throw new Error(
        `Failed to create an E2E ${payload.role}: HTTP ${response.status()} ${await response.text()}`,
      );
    }

    const body = await response.json();
    return { ...payload, id: body.user.id, token: body.token };
  }

  /** Register and return credentials for each role the suite needs. */
  createStudent = (overrides) => this.register({ role: 'student', ...overrides });

  createInstructor = (overrides) => this.register({ role: 'instructor', ...overrides });

  createAdmin = (overrides) => this.register({ role: 'admin', ...overrides });

  async createCourse(token, overrides = {}) {
    const id = nextId();
    const payload = {
      title: `E2E Korean Course ${id}`,
      // Deliberately free of the words "and"/"or", hyphen pairs and semicolons:
      // the application's global input filter rejects them (DEFECT-01).
      description: `A complete Korean course for E2E verification. Reference ${id}.`,
      category: 'other',
      level: 'beginner',
      duration: 8,
      price: 5000,
      isPublished: true,
      ...overrides,
    };

    const response = await this.request.post(`${BACKEND_URL}/api/courses`, {
      data: payload,
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok()) {
      throw new Error(
        `Failed to create an E2E course: HTTP ${response.status()} ${await response.text()}`,
      );
    }
    return (await response.json()).course;
  }

  async health() {
    const response = await this.request.get(`${BACKEND_URL}/api/health`);
    return { ok: response.ok(), body: response.ok() ? await response.json() : null };
  }
}

/**
 * Page-object helpers.
 *
 * Kept deliberately small: a full page-object layer for 33 screens would be
 * more code than the tests it serves. These cover only the interactions that
 * appear in more than one spec.
 */
class AppPage {
  constructor(page) {
    this.page = page;
  }

  async gotoLogin() {
    await this.page.goto('/login');
    await expect(this.page.locator('input[name="email"]')).toBeVisible();
  }

  async login(email, password = VALID_PASSWORD) {
    await this.gotoLogin();
    await this.page.fill('input[name="email"]', email);
    await this.page.fill('input[name="password"]', password);
    await this.page.click('button[type="submit"]');
    // The application stores the token before it navigates, so waiting for the
    // storage write is more reliable than racing a URL change.
    await this.page.waitForFunction(
      () => window.localStorage.getItem('token') !== null,
      undefined,
      { timeout: 15000 },
    );
  }

  async loginAsAdmin(email, password = VALID_PASSWORD) {
    await this.page.goto('/admin/login');
    await this.page.fill('input[name="email"]', email);
    await this.page.fill('input[name="password"]', password);
    await this.page.click('button[type="submit"]');
    await this.page.waitForFunction(
      () =>
        window.localStorage.getItem('adminToken') !== null ||
        window.localStorage.getItem('token') !== null,
      undefined,
      { timeout: 15000 },
    );
  }

  /** Put a token straight into storage — for tests that are not about logging in. */
  async authenticateAs(token, user) {
    await this.page.goto('/');
    await this.page.evaluate(
      ([storedToken, storedUser]) => {
        window.localStorage.setItem('token', storedToken);
        window.localStorage.setItem('user', JSON.stringify(storedUser));
      },
      [token, user],
    );
  }

  async logout() {
    await this.page.evaluate(() => window.localStorage.clear());
    await this.page.goto('/');
  }

  storedToken() {
    return this.page.evaluate(() => window.localStorage.getItem('token'));
  }
}

const test = base.extend({
  api: async ({ request }, use) => {
    await use(new ApiHelper(request));
  },
  app: async ({ page }, use) => {
    await use(new AppPage(page));
  },
});

module.exports = { test, expect, ApiHelper, AppPage, VALID_PASSWORD, BACKEND_URL, nextId };
