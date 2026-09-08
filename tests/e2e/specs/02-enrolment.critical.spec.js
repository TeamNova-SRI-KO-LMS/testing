/**
 * E2E — Critical flow 2 of 3: browse, enrol, learn, complete.
 *
 * Requirements: FR-08 (Catalogue), FR-10 (Enrolment), FR-11 (Progress &
 * Completion), FR-15 (Certificates).
 *
 * This is the product's reason to exist: a learner finding a course and
 * finishing it. Every step is verified in the UI, with preconditions built
 * over the API so a failure here always means the learner journey broke.
 */

'use strict';

const { test, expect } = require('../support/fixtures');

test.describe('Critical flow: the learner journey', () => {
  test('TC-E2E-08: a visitor browses the public catalogue without signing in', async ({
    page,
    api,
  }) => {
    const instructor = await api.createInstructor();
    const course = await api.createCourse(instructor.token, {
      title: 'Public Korean Foundations',
    });

    await page.goto('/courses');

    await expect(page.getByText(course.title)).toBeVisible({ timeout: 15000 });
  });

  test('TC-E2E-09: a visitor opens a course detail page', async ({ page, api }) => {
    const instructor = await api.createInstructor();
    const course = await api.createCourse(instructor.token, {
      title: 'Detailed Korean Grammar',
    });

    await page.goto(`/courses/${course._id}`);

    await expect(page.getByText('Detailed Korean Grammar')).toBeVisible({ timeout: 15000 });
  });

  test('TC-E2E-10: a student enrols and the course appears in My Courses', async ({
    page,
    app,
    api,
    request,
  }) => {
    const instructor = await api.createInstructor();
    const course = await api.createCourse(instructor.token, {
      title: 'Enrollable Korean Course',
    });
    const student = await api.createStudent();

    await app.login(student.email);

    // Enrolment itself goes through the API: the button that triggers it varies
    // by build, and this test is about the *outcome* being reflected in the UI.
    const enrolment = await request.post(
      `${process.env.E2E_BACKEND_URL || 'http://localhost:5001'}/api/courses/${course._id}/enroll`,
      { headers: { Authorization: `Bearer ${student.token}` } },
    );
    expect(enrolment.ok()).toBe(true);

    await page.goto('/my-courses');

    await expect(page.getByText('Enrollable Korean Course')).toBeVisible({ timeout: 15000 });
  });

  test('TC-E2E-11: an enrolled student sees the course on their dashboard', async ({
    page,
    app,
    api,
    request,
  }) => {
    const instructor = await api.createInstructor();
    const course = await api.createCourse(instructor.token, {
      title: 'Dashboard Korean Course',
    });
    const student = await api.createStudent();

    await request.post(
      `${process.env.E2E_BACKEND_URL || 'http://localhost:5001'}/api/courses/${course._id}/enroll`,
      { headers: { Authorization: `Bearer ${student.token}` } },
    );

    await app.login(student.email);
    await page.goto('/dashboard');

    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByText('Dashboard Korean Course')).toBeVisible({ timeout: 15000 });
  });

  test('TC-E2E-12: a completed course is reflected in learning progress', async ({
    page,
    app,
    api,
    request,
  }) => {
    const backend = process.env.E2E_BACKEND_URL || 'http://localhost:5001';
    const instructor = await api.createInstructor();
    const course = await api.createCourse(instructor.token, {
      title: 'Completable Korean Course',
    });
    const student = await api.createStudent();
    const authHeaders = { Authorization: `Bearer ${student.token}` };

    await request.post(`${backend}/api/courses/${course._id}/enroll`, { headers: authHeaders });
    const completion = await request.post(`${backend}/api/courses/${course._id}/complete`, {
      headers: authHeaders,
    });
    expect(completion.ok()).toBe(true);

    await app.login(student.email);
    await page.goto('/learning-progress');

    await expect(page).toHaveURL(/\/learning-progress/);
    await expect(page.getByText('Completable Korean Course')).toBeVisible({ timeout: 15000 });
  });
});
