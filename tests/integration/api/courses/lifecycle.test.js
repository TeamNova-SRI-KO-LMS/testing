/**
 * Integration tests — course authoring, enrolment, reviews and completion.
 *
 * Endpoints: POST/PUT/DELETE /api/courses[/:id],
 *            POST/DELETE /api/courses/:id/enroll,
 *            POST /api/courses/:id/reviews,
 *            POST /api/courses/:id/complete.
 *
 * Requirements: FR-09 (Course Authoring), FR-10 (Enrolment),
 * FR-11 (Completion), FR-12 (Reviews), FR-05 (RBAC).
 */

'use strict';

const { loadApp } = require('@support/app');
const { api } = require('@support/api-client');
const { testCase } = require('@support/test-case');
const { requireFromSut } = require('@support/sut');
const auth = require('@support/auth');
const { createCourse, buildCourse, enrolStudent } = require('@factories');

const client = api(loadApp());
const Course = requireFromSut('./models/Course');
const Progress = requireFromSut('./models/Progress');
const User = requireFromSut('./models/User');

const MISSING_ID = '507f1f77bcf86cd799439099';

describe('POST /api/courses', () => {
  testCase(
    {
      id: 'TC-FR-09-01',
      name: 'An instructor creates a course and is recorded as its owner',
      requirement: 'FR-09',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'An authenticated instructor',
      input: 'POST /api/courses with a valid course payload',
      expected: 'HTTP 201; the course is persisted with instructor set to the caller',
    },
    async () => {
      const { user, authHeader } = await auth.asInstructor();
      const payload = buildCourse({ title: 'Korean Grammar Essentials' });

      const response = await client
        .post('/api/courses')
        .set('Authorization', authHeader)
        .send(payload);

      expect(response).toBeSuccessfulResponse(201);
      expect(response.body.message).toBe('Course created successfully');
      expect(response.body.course.title).toBe('Korean Grammar Essentials');

      const stored = await Course.findById(response.body.course._id);
      // The owner comes from the token, never from the body — otherwise an
      // instructor could create a course attributed to somebody else.
      expect(String(stored.instructor)).toBe(String(user._id));
    },
  );

  it('lets an administrator create a course', async () => {
    const { authHeader } = await auth.asAdmin();

    const response = await client
      .post('/api/courses')
      .set('Authorization', authHeader)
      .send(buildCourse());

    expect(response).toBeSuccessfulResponse(201);
  });

  testCase(
    {
      id: 'TC-FR-05-03',
      name: 'A student cannot create a course',
      requirement: 'FR-05',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'An authenticated student',
      input: 'POST /api/courses with a valid payload and a student token',
      expected: 'HTTP 403; no course is created',
    },
    async () => {
      const { authHeader } = await auth.asStudent();

      const response = await client
        .post('/api/courses')
        .set('Authorization', authHeader)
        .send(buildCourse());

      expect(response).toBeForbidden();
      expect(await Course.countDocuments()).toBe(0);
    },
  );

  it('refuses an unauthenticated request', async () => {
    const response = await client.post('/api/courses').send(buildCourse());

    expect(response).toBeUnauthorised();
  });

  it.each([
    ['a four-character title', { title: 'abcd' }, 'title'],
    ['a nine-character description', { description: 'too short' }, 'description'],
    ['an unknown category', { category: 'korean' }, 'category'],
    ['an unknown level', { level: 'expert' }, 'level'],
    ['a zero-week duration', { duration: 0 }, 'duration'],
    ['a 53-week duration', { duration: 53 }, 'duration'],
    ['a negative price', { price: -1 }, 'price'],
  ])('rejects %s with HTTP 400', async (_label, override, field) => {
    const { authHeader } = await auth.asInstructor();

    const response = await client
      .post('/api/courses')
      .set('Authorization', authHeader)
      .send(buildCourse(override));

    expect(response).toFailValidation(field);
  });

  it('ignores an instructor id supplied in the request body', async () => {
    // Trusting the body here would let any instructor attribute a course to a
    // colleague, or to an account they do not control (OWASP A01).
    const { user, authHeader } = await auth.asInstructor();
    const someoneElse = await auth.asInstructor();

    const response = await client
      .post('/api/courses')
      .set('Authorization', authHeader)
      .send({ ...buildCourse(), instructor: String(someoneElse.user._id) });

    const stored = await Course.findById(response.body.course._id);
    expect(String(stored.instructor)).toBe(String(user._id));
  });
});

describe('PUT /api/courses/:id', () => {
  testCase(
    {
      id: 'TC-FR-09-02',
      name: 'The owning instructor updates their own course',
      requirement: 'FR-09',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'An instructor owns an existing course',
      input: 'PUT /api/courses/<id> with a new title and price',
      expected: 'HTTP 200; the stored course reflects both changes',
    },
    async () => {
      const { user, authHeader } = await auth.asInstructor();
      const course = await createCourse({ instructor: user._id });

      const response = await client
        .put(`/api/courses/${course._id}`)
        .set('Authorization', authHeader)
        .send({ title: 'Updated Korean Grammar', price: 7500 });

      expect(response).toBeSuccessfulResponse(200);

      const stored = await Course.findById(course._id);
      expect(stored.title).toBe('Updated Korean Grammar');
      expect(stored.price).toBe(7500);
    },
  );

  it('lets an administrator update a course they do not own', async () => {
    const course = await createCourse();
    const { authHeader } = await auth.asAdmin();

    const response = await client
      .put(`/api/courses/${course._id}`)
      .set('Authorization', authHeader)
      .send({ title: 'Administratively Renamed Course' });

    expect(response).toBeSuccessfulResponse(200);
  });

  testCase(
    {
      id: 'TC-FR-05-04',
      name: 'An instructor cannot update a course belonging to someone else',
      requirement: 'FR-05',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'Course A belongs to instructor A; instructor B is authenticated',
      input: 'PUT /api/courses/<A> with instructor B’s token',
      expected: 'HTTP 403; the course is unchanged',
    },
    async () => {
      const course = await createCourse({ title: 'Original Korean Title' });
      const { authHeader } = await auth.asInstructor();

      const response = await client
        .put(`/api/courses/${course._id}`)
        .set('Authorization', authHeader)
        .send({ title: 'Hijacked Korean Title' });

      expect(response).toBeForbidden();
      expect((await Course.findById(course._id)).title).toBe('Original Korean Title');
    },
  );

  it('refuses a student', async () => {
    const course = await createCourse();
    const { authHeader } = await auth.asStudent();

    const response = await client
      .put(`/api/courses/${course._id}`)
      .set('Authorization', authHeader)
      .send({ title: 'Student Renamed Course' });

    expect(response).toBeForbidden();
  });

  it('returns 404 for a course that does not exist', async () => {
    const { authHeader } = await auth.asAdmin();

    const response = await client
      .put(`/api/courses/${MISSING_ID}`)
      .set('Authorization', authHeader)
      .send({ title: 'Nothing To Update Here' });

    expect(response).toBeNotFound();
  });

  it('refuses an unauthenticated request', async () => {
    const course = await createCourse();

    const response = await client.put(`/api/courses/${course._id}`).send({ title: 'Anonymous' });

    expect(response).toBeUnauthorised();
  });
});

describe('DELETE /api/courses/:id', () => {
  testCase(
    {
      id: 'TC-FR-09-03',
      name: 'The owning instructor deletes their own course',
      requirement: 'FR-09',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'An instructor owns an existing course',
      input: 'DELETE /api/courses/<id>',
      expected: 'HTTP 200; the course no longer exists',
    },
    async () => {
      const { user, authHeader } = await auth.asInstructor();
      const course = await createCourse({ instructor: user._id });

      const response = await client
        .delete(`/api/courses/${course._id}`)
        .set('Authorization', authHeader);

      expect(response).toBeSuccessfulResponse(200);
      expect(await Course.findById(course._id)).toBeNull();
    },
  );

  it('refuses an instructor who does not own the course', async () => {
    const course = await createCourse();
    const { authHeader } = await auth.asInstructor();

    const response = await client
      .delete(`/api/courses/${course._id}`)
      .set('Authorization', authHeader);

    expect(response).toBeForbidden();
    expect(await Course.findById(course._id)).not.toBeNull();
  });

  it('refuses a student', async () => {
    const course = await createCourse();
    const { authHeader } = await auth.asStudent();

    const response = await client
      .delete(`/api/courses/${course._id}`)
      .set('Authorization', authHeader);

    expect(response).toBeForbidden();
  });

  it('returns 404 for a course that does not exist', async () => {
    const { authHeader } = await auth.asAdmin();

    const response = await client
      .delete(`/api/courses/${MISSING_ID}`)
      .set('Authorization', authHeader);

    expect(response).toBeNotFound();
  });

  testCase.failing(
    {
      id: 'TC-FR-09-04',
      name: 'Deleting a course also removes the enrolment records that point at it',
      requirement: 'FR-09',
      type: 'Integration',
      priority: 'P2',
      preconditions: 'A student is enrolled in the course being deleted',
      input: 'DELETE /api/courses/<id>',
      expected: 'The orphaned Progress record and the user’s enrolledCourses entry are removed',
      defect: 'DEFECT-18',
    },
    async () => {
      // The route deletes only the course document, leaving Progress records
      // and User.enrolledCourses entries pointing at an id that no longer
      // resolves — the dashboard then renders empty cards for them.
      const { user: student } = await auth.asStudent();
      const admin = await auth.asAdmin();
      const course = await createCourse();
      await enrolStudent(student._id, course._id);

      await client.delete(`/api/courses/${course._id}`).set('Authorization', admin.authHeader);

      expect(await Progress.countDocuments({ course: course._id })).toBe(0);
    },
  );
});

describe('POST /api/courses/:id/enroll', () => {
  testCase(
    {
      id: 'TC-FR-10-02',
      name: 'A student enrols in a published course',
      requirement: 'FR-10',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'A published course exists and the student is not enrolled',
      input: 'POST /api/courses/<id>/enroll with the student’s token',
      expected:
        'HTTP 200; a Progress record is created; the student joins enrolledStudents; the course joins enrolledCourses',
    },
    async () => {
      const course = await createCourse({ isPublished: true });
      const { user, authHeader } = await auth.asStudent();

      const response = await client
        .post(`/api/courses/${course._id}/enroll`)
        .set('Authorization', authHeader);

      expect(response).toBeSuccessfulResponse(200);
      expect(response.body.message).toBe('Enrolled in course successfully');

      // All three sides of the relationship must be written, or the dashboard
      // and the course roster disagree about who is enrolled.
      const progress = await Progress.findOne({ student: user._id, course: course._id });
      expect(progress).not.toBeNull();
      expect(progress.overallProgress).toBe(0);

      const updatedCourse = await Course.findById(course._id);
      expect(updatedCourse.enrolledStudents.map(String)).toContain(String(user._id));

      const updatedUser = await User.findById(user._id);
      expect(updatedUser.enrolledCourses.map(String)).toContain(String(course._id));
    },
  );

  testCase(
    {
      id: 'TC-FR-10-03',
      name: 'A student cannot enrol twice in the same course',
      requirement: 'FR-10',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'The student is already enrolled in the course',
      input: 'POST /api/courses/<id>/enroll a second time',
      expected: 'HTTP 400 "You are already enrolled in this course"; still one Progress record',
    },
    async () => {
      const course = await createCourse({ isPublished: true });
      const { user, authHeader } = await auth.asStudent();
      await client.post(`/api/courses/${course._id}/enroll`).set('Authorization', authHeader);

      const response = await client
        .post(`/api/courses/${course._id}/enroll`)
        .set('Authorization', authHeader);

      expect(response).toBeErrorResponse(400, 'You are already enrolled in this course');
      expect(await Progress.countDocuments({ student: user._id, course: course._id })).toBe(1);
    },
  );

  testCase(
    {
      id: 'TC-FR-10-04',
      name: 'A student cannot enrol in an unpublished course',
      requirement: 'FR-10',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'A course exists with isPublished = false',
      input: 'POST /api/courses/<id>/enroll',
      expected: 'HTTP 400 "Course is not published yet"; no Progress record is created',
    },
    async () => {
      const course = await createCourse({ isPublished: false });
      const { authHeader } = await auth.asStudent();

      const response = await client
        .post(`/api/courses/${course._id}/enroll`)
        .set('Authorization', authHeader);

      expect(response).toBeErrorResponse(400, 'Course is not published yet');
      expect(await Progress.countDocuments()).toBe(0);
    },
  );

  it('returns 404 for a course that does not exist', async () => {
    const { authHeader } = await auth.asStudent();

    const response = await client
      .post(`/api/courses/${MISSING_ID}/enroll`)
      .set('Authorization', authHeader);

    expect(response).toBeNotFound();
  });

  it('refuses an instructor, because enrolment is a student action', async () => {
    const course = await createCourse({ isPublished: true });
    const { authHeader } = await auth.asInstructor();

    const response = await client
      .post(`/api/courses/${course._id}/enroll`)
      .set('Authorization', authHeader);

    expect(response).toBeForbidden();
  });

  it('refuses an unauthenticated request', async () => {
    const course = await createCourse({ isPublished: true });

    const response = await client.post(`/api/courses/${course._id}/enroll`);

    expect(response).toBeUnauthorised();
  });
});

describe('DELETE /api/courses/:id/enroll', () => {
  testCase(
    {
      id: 'TC-FR-10-05',
      name: 'A student un-enrols and every trace of the enrolment is removed',
      requirement: 'FR-10',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'The student is enrolled in the course',
      input: 'DELETE /api/courses/<id>/enroll',
      expected:
        'HTTP 200; the Progress record is deleted; the student leaves enrolledStudents; the course leaves enrolledCourses',
    },
    async () => {
      const course = await createCourse({ isPublished: true });
      const { user, authHeader } = await auth.asStudent();
      await client.post(`/api/courses/${course._id}/enroll`).set('Authorization', authHeader);

      const response = await client
        .delete(`/api/courses/${course._id}/enroll`)
        .set('Authorization', authHeader);

      expect(response).toBeSuccessfulResponse(200);
      expect(await Progress.findOne({ student: user._id, course: course._id })).toBeNull();
      expect((await Course.findById(course._id)).enrolledStudents).toHaveLength(0);
      expect((await User.findById(user._id)).enrolledCourses).toHaveLength(0);
    },
  );

  it('returns 400 when the student is not enrolled', async () => {
    const course = await createCourse({ isPublished: true });
    const { authHeader } = await auth.asStudent();

    const response = await client
      .delete(`/api/courses/${course._id}/enroll`)
      .set('Authorization', authHeader);

    expect(response).toBeErrorResponse(400, 'You are not enrolled in this course');
  });

  it('returns 404 for a course that does not exist', async () => {
    const { authHeader } = await auth.asStudent();

    const response = await client
      .delete(`/api/courses/${MISSING_ID}/enroll`)
      .set('Authorization', authHeader);

    expect(response).toBeNotFound();
  });

  it('lets a student re-enrol after un-enrolling', async () => {
    const course = await createCourse({ isPublished: true });
    const { authHeader } = await auth.asStudent();
    await client.post(`/api/courses/${course._id}/enroll`).set('Authorization', authHeader);
    await client.delete(`/api/courses/${course._id}/enroll`).set('Authorization', authHeader);

    const response = await client
      .post(`/api/courses/${course._id}/enroll`)
      .set('Authorization', authHeader);

    expect(response).toBeSuccessfulResponse(200);
  });
});

describe('POST /api/courses/:id/reviews', () => {
  testCase(
    {
      id: 'TC-FR-12-01',
      name: 'A student reviews a course and the average rating is recalculated',
      requirement: 'FR-12',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'A course exists with no reviews',
      input: 'POST /api/courses/<id>/reviews with rating 4 and a comment',
      expected: 'HTTP 200; the review is stored; averageRating becomes 4',
    },
    async () => {
      const course = await createCourse();
      const { authHeader } = await auth.asStudent();

      const response = await client
        .post(`/api/courses/${course._id}/reviews`)
        .set('Authorization', authHeader)
        .send({ rating: 4, comment: 'Very clear explanations throughout the course.' });

      expect(response).toBeSuccessfulResponse(200);

      const stored = await Course.findById(course._id);
      expect(stored.reviews).toHaveLength(1);
      expect(stored.reviews[0].rating).toBe(4);
      expect(stored.averageRating).toBe(4);
    },
  );

  testCase(
    {
      id: 'TC-FR-12-02',
      name: 'A user cannot review the same course twice',
      requirement: 'FR-12',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'The user has already reviewed the course',
      input: 'POST /api/courses/<id>/reviews a second time',
      expected: 'HTTP 400 "You have already reviewed this course"; still one review',
    },
    async () => {
      const course = await createCourse();
      const { authHeader } = await auth.asStudent();
      await client
        .post(`/api/courses/${course._id}/reviews`)
        .set('Authorization', authHeader)
        .send({ rating: 5 });

      const response = await client
        .post(`/api/courses/${course._id}/reviews`)
        .set('Authorization', authHeader)
        .send({ rating: 1 });

      expect(response).toBeErrorResponse(400, 'You have already reviewed this course');
      expect((await Course.findById(course._id)).reviews).toHaveLength(1);
    },
  );

  it('averages the ratings of several reviewers', async () => {
    const course = await createCourse();
    const first = await auth.asStudent();
    const second = await auth.asStudent();

    await client
      .post(`/api/courses/${course._id}/reviews`)
      .set('Authorization', first.authHeader)
      .send({ rating: 5 });
    await client
      .post(`/api/courses/${course._id}/reviews`)
      .set('Authorization', second.authHeader)
      .send({ rating: 2 });

    expect((await Course.findById(course._id)).averageRating).toBe(3.5);
  });

  it.each([
    ['a rating of zero', { rating: 0 }],
    ['a rating of six', { rating: 6 }],
    ['a missing rating', {}],
    ['a fractional rating', { rating: 4.5 }],
    ['a 501-character comment', { rating: 4, comment: 'x'.repeat(501) }],
  ])('rejects %s with HTTP 400', async (_label, body) => {
    const course = await createCourse();
    const { authHeader } = await auth.asStudent();

    const response = await client
      .post(`/api/courses/${course._id}/reviews`)
      .set('Authorization', authHeader)
      .send(body);

    expect(response).toFailValidation();
  });

  it('returns 404 for a course that does not exist', async () => {
    const { authHeader } = await auth.asStudent();

    const response = await client
      .post(`/api/courses/${MISSING_ID}/reviews`)
      .set('Authorization', authHeader)
      .send({ rating: 5 });

    expect(response).toBeNotFound();
  });

  it('refuses an unauthenticated request', async () => {
    const course = await createCourse();

    const response = await client.post(`/api/courses/${course._id}/reviews`).send({ rating: 5 });

    expect(response).toBeUnauthorised();
  });

  testCase.failing(
    {
      id: 'TC-FR-12-03',
      name: 'Only an enrolled student may review a course',
      requirement: 'FR-12',
      type: 'Integration',
      priority: 'P2',
      preconditions: 'A student who is NOT enrolled in the course',
      input: 'POST /api/courses/<id>/reviews with rating 1',
      expected: 'HTTP 403; the review is not stored',
      defect: 'DEFECT-19',
    },
    async () => {
      // No enrolment check exists, so any authenticated account can post a
      // rating for any course — the ratings that order the public catalogue are
      // therefore open to manipulation.
      const course = await createCourse();
      const { authHeader } = await auth.asStudent();

      const response = await client
        .post(`/api/courses/${course._id}/reviews`)
        .set('Authorization', authHeader)
        .send({ rating: 1, comment: 'Never enrolled in this course.' });

      expect(response).toBeForbidden();
    },
  );
});

describe('POST /api/courses/:id/complete', () => {
  testCase(
    {
      id: 'TC-FR-11-01',
      name: 'An enrolled student marks a course complete',
      requirement: 'FR-11',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'The student is enrolled and the course is not yet complete',
      input: 'POST /api/courses/<id>/complete',
      expected: 'HTTP 200; isCompleted true; overallProgress 100; completionDate stamped',
    },
    async () => {
      const course = await createCourse({ isPublished: true });
      const { user, authHeader } = await auth.asStudent();
      await client.post(`/api/courses/${course._id}/enroll`).set('Authorization', authHeader);

      const response = await client
        .post(`/api/courses/${course._id}/complete`)
        .set('Authorization', authHeader);

      expect(response).toBeSuccessfulResponse(200);

      const progress = await Progress.findOne({ student: user._id, course: course._id });
      expect(progress.isCompleted).toBe(true);
      expect(progress.overallProgress).toBe(100);
      // Certificate eligibility and the analytics dashboard both filter on this
      // date, so a completion without one is invisible to the business.
      expect(progress.completionDate).toBeRecentTimestamp();
    },
  );

  testCase(
    {
      id: 'TC-FR-11-02',
      name: 'A course cannot be completed twice',
      requirement: 'FR-11',
      type: 'Integration',
      priority: 'P2',
      preconditions: 'The student has already completed the course',
      input: 'POST /api/courses/<id>/complete a second time',
      expected: 'HTTP 400 "Course is already marked as completed"',
    },
    async () => {
      const course = await createCourse({ isPublished: true });
      const { authHeader } = await auth.asStudent();
      await client.post(`/api/courses/${course._id}/enroll`).set('Authorization', authHeader);
      await client.post(`/api/courses/${course._id}/complete`).set('Authorization', authHeader);

      const response = await client
        .post(`/api/courses/${course._id}/complete`)
        .set('Authorization', authHeader);

      expect(response).toBeErrorResponse(400, 'Course is already marked as completed');
    },
  );

  testCase(
    {
      id: 'TC-FR-11-03',
      name: 'A student who is not enrolled cannot mark the course complete',
      requirement: 'FR-11',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'The student is not enrolled in the course',
      input: 'POST /api/courses/<id>/complete',
      expected: 'HTTP 400 "You are not enrolled in this course"; no Progress record is created',
    },
    async () => {
      const course = await createCourse({ isPublished: true });
      const { authHeader } = await auth.asStudent();

      const response = await client
        .post(`/api/courses/${course._id}/complete`)
        .set('Authorization', authHeader);

      expect(response).toBeErrorResponse(400, 'You are not enrolled in this course');
      expect(await Progress.countDocuments()).toBe(0);
    },
  );

  it('returns 404 for a course that does not exist', async () => {
    const { authHeader } = await auth.asStudent();

    const response = await client
      .post(`/api/courses/${MISSING_ID}/complete`)
      .set('Authorization', authHeader);

    expect(response).toBeNotFound();
  });

  it('refuses an instructor', async () => {
    const course = await createCourse({ isPublished: true });
    const { authHeader } = await auth.asInstructor();

    const response = await client
      .post(`/api/courses/${course._id}/complete`)
      .set('Authorization', authHeader);

    expect(response).toBeForbidden();
  });
});
