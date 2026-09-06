/**
 * Integration tests — GET /api/courses, GET /api/courses/:id,
 * GET /api/courses/my-courses.
 *
 * Requirements: FR-08 (Course Catalogue & Search), FR-10 (Enrolment).
 */

'use strict';

const { loadApp } = require('@support/app');
const { api } = require('@support/api-client');
const { testCase } = require('@support/test-case');
const auth = require('@support/auth');
const { createCourse, createInstructor, enrolStudent } = require('@factories');

const client = api(loadApp());

describe('GET /api/courses', () => {
  testCase(
    {
      id: 'TC-FR-08-01',
      name: 'The course catalogue is readable without authentication',
      requirement: 'FR-08',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'Three published courses exist',
      input: 'GET /api/courses with no Authorization header',
      expected: 'HTTP 200; success=true; all three courses with pagination metadata',
    },
    async () => {
      await Promise.all([createCourse(), createCourse(), createCourse()]);

      const response = await client.get('/api/courses');

      expect(response).toBeSuccessfulResponse(200);
      expect(response.body.courses).toHaveLength(3);
      expect(response.body).toMatchObject({ count: 3, total: 3, page: 1, pages: 1 });
    },
  );

  it('returns an empty catalogue rather than an error when no courses exist', async () => {
    const response = await client.get('/api/courses');

    expect(response).toBeSuccessfulResponse(200);
    expect(response.body.courses).toEqual([]);
    expect(response.body.total).toBe(0);
  });

  it('populates the instructor summary but not their email', async () => {
    // The catalogue is public, so an instructor's email address must not travel
    // with it (OWASP A01 / privacy).
    const { user } = await createInstructor({ name: 'Nimal Silva' });
    await createCourse({ instructor: user._id });

    const response = await client.get('/api/courses');

    expect(response.body.courses[0].instructor).toMatchObject({ name: 'Nimal Silva' });
    expect(response.body.courses[0].instructor.email).toBeUndefined();
  });

  describe('pagination', () => {
    testCase(
      {
        id: 'TC-FR-08-02',
        name: 'The catalogue paginates with page and limit',
        requirement: 'FR-08',
        type: 'Integration',
        priority: 'P2',
        preconditions: 'Twelve courses exist',
        input: 'GET /api/courses?page=2&limit=5',
        expected: 'HTTP 200; 5 courses; page 2 of 3; total 12',
      },
      async () => {
        for (let i = 0; i < 12; i += 1) {
          // Sequential: creation order defines the sort, so parallel creation
          // would make the page boundaries non-deterministic.
          // eslint-disable-next-line no-await-in-loop
          await createCourse();
        }

        const response = await client.get('/api/courses?page=2&limit=5');

        expect(response).toBeSuccessfulResponse(200);
        expect(response.body.courses).toHaveLength(5);
        expect(response.body).toMatchObject({ page: 2, pages: 3, total: 12 });
      },
    );

    it('defaults to page 1 with 10 courses per page', async () => {
      for (let i = 0; i < 12; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await createCourse();
      }

      const response = await client.get('/api/courses');

      expect(response.body.courses).toHaveLength(10);
      expect(response.body.page).toBe(1);
    });

    it('returns an empty page beyond the last one', async () => {
      await createCourse();

      const response = await client.get('/api/courses?page=99&limit=10');

      expect(response).toBeSuccessfulResponse(200);
      expect(response.body.courses).toEqual([]);
    });

    it('falls back to the defaults for non-numeric pagination parameters', async () => {
      await createCourse();

      const response = await client.get('/api/courses?page=abc&limit=xyz');

      expect(response).toBeSuccessfulResponse(200);
      expect(response.body.page).toBe(1);
    });

    it('orders the newest course first', async () => {
      const first = await createCourse({ title: 'Alpha Korean Foundations' });
      const second = await createCourse({ title: 'Beta Korean Foundations' });

      const response = await client.get('/api/courses');

      expect(response.body.courses[0]._id).toBe(String(second._id));
      expect(response.body.courses[1]._id).toBe(String(first._id));
    });
  });

  describe('filtering', () => {
    testCase(
      {
        id: 'TC-FR-08-03',
        name: 'The catalogue filters by category, level and published state',
        requirement: 'FR-08',
        type: 'Integration',
        priority: 'P2',
        preconditions: 'Courses exist across several categories and levels',
        input: 'GET /api/courses with category, level and published query parameters',
        expected: 'HTTP 200; only courses matching every supplied filter',
      },
      async () => {
        await createCourse({ category: 'business', level: 'advanced', isPublished: true });
        await createCourse({ category: 'business', level: 'beginner', isPublished: true });
        await createCourse({ category: 'design', level: 'advanced', isPublished: true });
        await createCourse({ category: 'business', level: 'advanced', isPublished: false });

        const response = await client.get(
          '/api/courses?category=business&level=advanced&published=true',
        );

        expect(response).toBeSuccessfulResponse(200);
        expect(response.body.courses).toHaveLength(1);
        expect(response.body.courses[0]).toMatchObject({
          category: 'business',
          level: 'advanced',
          isPublished: true,
        });
      },
    );

    it('returns only unpublished courses for published=false', async () => {
      await createCourse({ isPublished: true });
      await createCourse({ isPublished: false });

      const response = await client.get('/api/courses?published=false');

      expect(response.body.courses).toHaveLength(1);
      expect(response.body.courses[0].isPublished).toBe(false);
    });

    it('returns no courses for a category that matches nothing', async () => {
      await createCourse({ category: 'business' });

      const response = await client.get('/api/courses?category=lifestyle');

      expect(response.body.courses).toEqual([]);
      expect(response.body.total).toBe(0);
    });

    testCase(
      {
        id: 'TC-FR-08-04',
        name: 'The catalogue search matches course titles case-insensitively',
        requirement: 'FR-08',
        type: 'Integration',
        priority: 'P2',
        preconditions: 'A course titled "Advanced Korean Grammar" exists',
        input: 'GET /api/courses?search=korean',
        expected: 'HTTP 200; the matching course is returned despite the different case',
      },
      async () => {
        await createCourse({ title: 'Advanced Korean Grammar' });
        await createCourse({ title: 'Beginner Japanese Writing' });

        const response = await client.get('/api/courses?search=korean');

        expect(response.body.courses).toHaveLength(1);
        expect(response.body.courses[0].title).toBe('Advanced Korean Grammar');
      },
    );

    it('matches a substring in the middle of a title', async () => {
      await createCourse({ title: 'Practical Hangul Writing' });

      const response = await client.get('/api/courses?search=Hangul');

      expect(response.body.courses).toHaveLength(1);
    });

    testCase.failing(
      {
        id: 'TC-NFR-03-04',
        name: 'A regular expression in the search term cannot enumerate the catalogue',
        requirement: 'NFR-03',
        type: 'Integration',
        priority: 'P2',
        preconditions: 'Two courses with unrelated titles exist',
        input: 'GET /api/courses?search=.* (a regular-expression wildcard)',
        expected: 'The wildcard is treated as a literal string and matches nothing',
        defect: 'DEFECT-16',
      },
      async () => {
        // The route interpolates the query straight into `$regex`, so the caller
        // controls the pattern. `.*` returns everything; a catastrophic pattern
        // such as `(a+)+$` is a denial-of-service primitive. The term should be
        // escaped before it reaches the query.
        await createCourse({ title: 'Alpha Korean Foundations' });
        await createCourse({ title: 'Beta Korean Foundations' });

        const response = await client.get('/api/courses?search=.*');

        expect(response.body.courses).toHaveLength(0);
      },
    );

    it('currently treats the search term as an unescaped regular expression', async () => {
      // Companion to TC-NFR-03-04: pins the actual behaviour.
      await createCourse();
      await createCourse();

      const response = await client.get('/api/courses?search=.*');

      expect(response.body.courses).toHaveLength(2);
    });
  });
});

describe('GET /api/courses/:id', () => {
  testCase(
    {
      id: 'TC-FR-08-05',
      name: 'A single course is readable without authentication',
      requirement: 'FR-08',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'A published course exists',
      input: 'GET /api/courses/<id> with no Authorization header',
      expected: 'HTTP 200; the course with its curriculum and populated instructor',
    },
    async () => {
      const course = await createCourse({ title: 'Korean Conversation Practice' });

      const response = await client.get(`/api/courses/${course._id}`);

      expect(response).toBeSuccessfulResponse(200);
      expect(response.body.course).toMatchObject({
        _id: String(course._id),
        title: 'Korean Conversation Practice',
      });
      expect(response.body.course.curriculum).toHaveLength(1);
      expect(response.body.course.instructor).toHaveProperty('name');
    },
  );

  testCase(
    {
      id: 'TC-FR-08-06',
      name: 'Requesting a course that does not exist returns 404',
      requirement: 'FR-08',
      type: 'Integration',
      priority: 'P2',
      preconditions: 'No course exists with the requested id',
      input: 'GET /api/courses/507f1f77bcf86cd799439099',
      expected: 'HTTP 404 "Course not found"',
    },
    async () => {
      const response = await client.get('/api/courses/507f1f77bcf86cd799439099');

      expect(response).toBeNotFound();
      expect(response.body.message).toBe('Course not found');
    },
  );

  it('returns 500 for an id that is not a valid ObjectId', async () => {
    // Documents the current behaviour: a malformed id is a client mistake and
    // should be a 400, but the cast error is caught by the generic handler.
    // See DEFECT-17 in docs/testing/DEFECT_REGISTER.md.
    const response = await client.get('/api/courses/not-an-object-id');

    expect(response.status).toBe(500);
  });

  it('does not leak enrolled students’ email addresses', async () => {
    const course = await createCourse();
    const { user } = await auth.asStudent();
    await enrolStudent(user._id, course._id);

    const response = await client.get(`/api/courses/${course._id}`);

    expect(response.body.course.enrolledStudents[0]).toHaveProperty('name');
    expect(response.body.course.enrolledStudents[0].email).toBeUndefined();
  });
});

describe('GET /api/courses/my-courses', () => {
  testCase(
    {
      id: 'TC-FR-10-01',
      name: 'A student sees only the courses they are enrolled in',
      requirement: 'FR-10',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'Three courses exist; the student is enrolled in one',
      input: 'GET /api/courses/my-courses with the student’s token',
      expected: 'HTTP 200; exactly the enrolled course',
    },
    async () => {
      const [enrolled] = await Promise.all([createCourse(), createCourse(), createCourse()]);
      const { user, authHeader } = await auth.asStudent();
      await enrolStudent(user._id, enrolled._id);

      const response = await client.get('/api/courses/my-courses').set('Authorization', authHeader);

      expect(response).toBeSuccessfulResponse(200);
      expect(response.body.courses).toHaveLength(1);
      expect(response.body.courses[0]._id).toBe(String(enrolled._id));
    },
  );

  it('returns an empty list for a student with no enrolments', async () => {
    await createCourse();
    const { authHeader } = await auth.asStudent();

    const response = await client.get('/api/courses/my-courses').set('Authorization', authHeader);

    expect(response).toBeSuccessfulResponse(200);
    expect(response.body.courses).toEqual([]);
  });

  it('refuses an unauthenticated request', async () => {
    const response = await client.get('/api/courses/my-courses');

    expect(response).toBeUnauthorised();
  });

  it('resolves "my-courses" as a literal path, not as a course id', async () => {
    // `/:id` is declared after `/my-courses`, so Express matches the literal
    // route first. Reordering them would silently break this endpoint.
    const { authHeader } = await auth.asStudent();

    const response = await client.get('/api/courses/my-courses').set('Authorization', authHeader);

    expect(response.status).toBe(200);
    expect(response.body.courses).toBeDefined();
  });
});
