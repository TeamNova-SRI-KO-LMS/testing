/**
 * E2E — Critical flow 3 of 3: administrative course and user management.
 *
 * Requirements: FR-19 (Admin User Management), FR-20 (Admin Course
 * Management), FR-21 (Analytics), FR-05 (RBAC).
 *
 * The administrative console is where the academy actually runs the business:
 * publishing courses, suspending accounts and reading the revenue numbers.
 */

'use strict';

const { test, expect } = require('../support/fixtures');

test.describe('Critical flow: administrative console', () => {
  test.beforeEach(async ({ app, api }) => {
    const admin = await api.createAdmin({ name: 'Site Administrator' });
    await app.loginAsAdmin(admin.email);
  });

  test('TC-E2E-13: the dashboard renders the headline statistics', async ({ page }) => {
    await page.goto('/admin/dashboard');

    await expect(page).toHaveURL(/\/admin\/dashboard/);
    // The tiles are populated from /api/admin/stats; an empty console here
    // means the API call failed even though the page rendered.
    await expect(page.locator('body')).not.toContainText('Failed to load');
  });

  test('TC-E2E-14: the user management screen lists accounts', async ({ page, api }) => {
    await api.createStudent({ name: 'Managed Learner' });

    await page.goto('/admin/users');

    await expect(page).toHaveURL(/\/admin\/users/);
    await expect(page.getByText('Managed Learner')).toBeVisible({ timeout: 15000 });
  });

  test('TC-E2E-15: the course management screen lists published and unpublished courses', async ({
    page,
    api,
  }) => {
    const instructor = await api.createInstructor();
    await api.createCourse(instructor.token, {
      title: 'Published Admin Course',
      isPublished: true,
    });
    await api.createCourse(instructor.token, {
      title: 'Draft Admin Course',
      isPublished: false,
    });

    await page.goto('/admin/courses');

    await expect(page.getByText('Published Admin Course')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Draft Admin Course')).toBeVisible({ timeout: 15000 });
  });

  test('TC-E2E-16: the analytics screen renders without an error state', async ({ page }) => {
    await page.goto('/admin/analytics');

    await expect(page).toHaveURL(/\/admin\/analytics/);
    await expect(page.locator('body')).not.toContainText('Something went wrong');
  });

  test('TC-E2E-17: a course published by an administrator appears in the public catalogue', async ({
    page,
    api,
    request,
  }) => {
    // The end-to-end statement of the publishing workflow: an administrative
    // action changes what an anonymous visitor can see.
    const backend = process.env.E2E_BACKEND_URL || 'http://localhost:5001';
    const admin = await api.createAdmin();
    const instructor = await api.createInstructor();
    const course = await api.createCourse(instructor.token, {
      title: 'Newly Published Korean Course',
      isPublished: false,
    });

    const publish = await request.put(`${backend}/api/admin/courses/${course._id}/status`, {
      data: { isPublished: true },
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    expect(publish.ok()).toBe(true);

    await page.context().clearCookies();
    await page.goto('/');
    await page.evaluate(() => window.localStorage.clear());
    await page.goto('/courses');

    await expect(page.getByText('Newly Published Korean Course')).toBeVisible({ timeout: 15000 });
  });
});
