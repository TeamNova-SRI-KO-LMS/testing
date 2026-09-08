/**
 * Unit tests — middleware/auth.js
 *
 * Requirements: FR-04 (Session & Token Management), FR-05 (Role-Based Access
 * Control), NFR-03 (Security).
 *
 * This is the module every protected endpoint in the system depends on, so it
 * carries the 90 % branch-coverage target for critical business logic
 * (SENG 34213 §6.4). The User model is mocked so each branch can be reached
 * deterministically without a database — a genuine unit test in the sense of
 * §6.2 ("single function or class in isolation").
 */

'use strict';

const { sutPath, requireFromSut } = require('@support/sut');
const { mockRequest, runMiddleware } = require('@support/http-doubles');
const { testCase } = require('@support/test-case');

// Mocked before the middleware is loaded, so `require('../models/User')` inside
// auth.js resolves to the double rather than the real Mongoose model.
jest.mock(sutPath('models/User.js'));
jest.mock(sutPath('models/Course.js'));
jest.mock(sutPath('models/Progress.js'));

const User = requireFromSut('./models/User');
const Course = requireFromSut('./models/Course');
const Progress = requireFromSut('./models/Progress');
const jwt = requireFromSut('jsonwebtoken');
const { protect, authorize, checkCourseAccess } = requireFromSut('./middleware/auth');

const SECRET = process.env.JWT_SECRET;
const USER_ID = '507f1f77bcf86cd799439011';

const activeUser = { _id: USER_ID, id: USER_ID, name: 'Ayesha', role: 'student', isActive: true };

const tokenFor = (id = USER_ID, options = {}) =>
  jwt.sign({ id }, options.secret || SECRET, { expiresIn: options.expiresIn || '7d' });

const withBearer = (token) => mockRequest({ headers: { authorization: `Bearer ${token}` } });

describe('middleware/auth', () => {
  describe('protect', () => {
    testCase(
      {
        id: 'TC-FR-04-U01',
        name: 'protect attaches the user and continues given a valid token',
        requirement: 'FR-04',
        type: 'Unit',
        priority: 'P1',
        preconditions: 'A valid, unexpired JWT exists for an active user',
        input: 'protect() with header "Authorization: Bearer <valid token>"',
        expected:
          'next() is called with no error; req.user is the resolved user; no response written',
      },
      async () => {
        // Arrange
        User.findById.mockResolvedValue(activeUser);

        // Act
        const { next, req, res } = await runMiddleware(protect, withBearer(tokenFor()));

        // Assert
        expect(next).toHaveBeenCalledTimes(1);
        expect(next).toHaveBeenCalledWith();
        expect(req.user).toBe(activeUser);
        expect(User.findById).toHaveBeenCalledWith(USER_ID);
        expect(res.status).not.toHaveBeenCalled();
      },
    );

    testCase(
      {
        id: 'TC-FR-04-U02',
        name: 'protect rejects a request that carries no Authorization header',
        requirement: 'FR-04',
        type: 'Unit',
        priority: 'P1',
        preconditions: 'None',
        input: 'protect() with no Authorization header',
        expected: 'HTTP 401 "Not authorized to access this route"; next() not called; no DB lookup',
      },
      async () => {
        const { next, res } = await runMiddleware(protect, mockRequest());

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({
          success: false,
          message: 'Not authorized to access this route',
        });
        expect(next).not.toHaveBeenCalled();
        // Short-circuiting before the database matters: an unauthenticated
        // flood must not be able to generate query load.
        expect(User.findById).not.toHaveBeenCalled();
      },
    );

    testCase(
      {
        id: 'TC-FR-04-U03',
        name: 'protect rejects an Authorization header that is not a Bearer scheme',
        requirement: 'FR-04',
        type: 'Unit',
        priority: 'P2',
        preconditions: 'None',
        input: 'protect() with header "Authorization: Basic dXNlcjpwYXNz"',
        expected: 'HTTP 401; next() not called',
      },
      async () => {
        const request = mockRequest({ headers: { authorization: 'Basic dXNlcjpwYXNz' } });
        const { next, res } = await runMiddleware(protect, request);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(next).not.toHaveBeenCalled();
      },
    );

    testCase(
      {
        id: 'TC-FR-04-U04',
        name: 'protect rejects a token signed with the wrong secret',
        requirement: 'FR-04',
        type: 'Unit',
        priority: 'P1',
        preconditions: 'An attacker holds a structurally valid JWT signed with a key they control',
        input: 'protect() with a Bearer token signed using "attacker-secret"',
        expected: 'HTTP 401 "Token is not valid"; next() not called',
      },
      async () => {
        const forged = tokenFor(USER_ID, { secret: 'attacker-secret' });

        const { next, res } = await runMiddleware(protect, withBearer(forged));

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Token is not valid' });
        expect(next).not.toHaveBeenCalled();
      },
    );

    testCase(
      {
        id: 'TC-FR-04-U05',
        name: 'protect rejects an expired token',
        requirement: 'FR-04',
        type: 'Unit',
        priority: 'P1',
        preconditions: 'A JWT whose exp claim is in the past',
        input: 'protect() with a Bearer token that expired one hour ago',
        expected: 'HTTP 401 "Token is not valid"; next() not called',
      },
      async () => {
        const issuedAt = Math.floor(Date.now() / 1000) - 7200;
        const expired = jwt.sign({ id: USER_ID, iat: issuedAt, exp: issuedAt + 3600 }, SECRET);

        const { next, res } = await runMiddleware(protect, withBearer(expired));

        expect(res.status).toHaveBeenCalledWith(401);
        expect(next).not.toHaveBeenCalled();
      },
    );

    testCase(
      {
        id: 'TC-FR-04-U06',
        name: 'protect rejects a token whose subject no longer exists',
        requirement: 'FR-04',
        type: 'Unit',
        priority: 'P1',
        preconditions: 'A valid token was issued for a user who has since been deleted',
        input: 'protect() with a valid token; User.findById resolves to null',
        expected: 'HTTP 401 "Token is not valid"; next() not called',
      },
      async () => {
        User.findById.mockResolvedValue(null);

        const { next, res } = await runMiddleware(protect, withBearer(tokenFor()));

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Token is not valid' });
        expect(next).not.toHaveBeenCalled();
      },
    );

    testCase(
      {
        id: 'TC-FR-04-U07',
        name: 'protect rejects a valid token belonging to a deactivated account',
        requirement: 'FR-04',
        type: 'Unit',
        priority: 'P1',
        preconditions: 'A user holds a valid token but their account has isActive = false',
        input: 'protect() with a valid token; User.findById resolves an inactive user',
        expected: 'HTTP 401 "Account is deactivated"; next() not called',
      },
      async () => {
        User.findById.mockResolvedValue({ ...activeUser, isActive: false });

        const { next, res } = await runMiddleware(protect, withBearer(tokenFor()));

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({
          success: false,
          message: 'Account is deactivated',
        });
        expect(next).not.toHaveBeenCalled();
      },
    );

    testCase(
      {
        id: 'TC-FR-04-U08',
        name: 'protect fails closed when the user lookup throws',
        requirement: 'FR-04',
        type: 'Unit',
        priority: 'P1',
        preconditions: 'The database is unreachable',
        input: 'protect() with a valid token; User.findById rejects',
        expected: 'HTTP 401; next() not called; the underlying error is not disclosed',
      },
      async () => {
        User.findById.mockRejectedValue(new Error('connection to db-primary refused'));

        const { next, res } = await runMiddleware(protect, withBearer(tokenFor()));

        expect(res.status).toHaveBeenCalledWith(401);
        expect(next).not.toHaveBeenCalled();
        // OWASP A05: an infrastructure failure must not surface internal detail.
        expect(JSON.stringify(res.body)).not.toMatch(/db-primary/);
      },
    );

    it('rejects a Bearer header with an empty token', async () => {
      const { next, res } = await runMiddleware(
        protect,
        mockRequest({ headers: { authorization: 'Bearer ' } }),
      );

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('rejects a token that is not a JWT at all', async () => {
      const { next, res } = await runMiddleware(protect, withBearer('not-a-jwt'));

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('authorize', () => {
    testCase(
      {
        id: 'TC-FR-05-U01',
        name: 'authorize admits a user whose role is in the allow-list',
        requirement: 'FR-05',
        type: 'Unit',
        priority: 'P1',
        preconditions: 'req.user.role is "admin"',
        input: "authorize('admin')(req, res, next)",
        expected: 'next() is called; no response written',
      },
      async () => {
        const request = mockRequest({ user: { role: 'admin' } });

        const { next, res } = await runMiddleware(authorize('admin'), request);

        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalled();
      },
    );

    testCase(
      {
        id: 'TC-FR-05-U02',
        name: 'authorize refuses a user whose role is outside the allow-list',
        requirement: 'FR-05',
        type: 'Unit',
        priority: 'P1',
        preconditions: 'req.user.role is "student" on an admin-only route',
        input: "authorize('admin')(req, res, next)",
        expected: 'HTTP 403 naming the rejected role; next() not called',
      },
      async () => {
        const request = mockRequest({ user: { role: 'student' } });

        const { next, res } = await runMiddleware(authorize('admin'), request);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith({
          success: false,
          message: 'User role student is not authorized to access this route',
        });
        expect(next).not.toHaveBeenCalled();
      },
    );

    it.each([
      ['student', ['student', 'instructor']],
      ['instructor', ['student', 'instructor']],
      ['instructor', ['instructor', 'admin']],
    ])('admits a %s when the allow-list is %j', async (role, allowed) => {
      const { next, res } = await runMiddleware(
        authorize(...allowed),
        mockRequest({ user: { role } }),
      );

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    });

    it.each([
      ['admin', ['student', 'instructor']],
      ['student', ['admin']],
      ['instructor', ['admin']],
      ['student', ['instructor']],
    ])('refuses a %s when the allow-list is %j', async (role, allowed) => {
      const { next, res } = await runMiddleware(
        authorize(...allowed),
        mockRequest({ user: { role } }),
      );

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    it('refuses every role when the allow-list is empty', async () => {
      const request = mockRequest({ user: { role: 'admin' } });

      const { next, res } = await runMiddleware(authorize(), request);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('checkCourseAccess', () => {
    const COURSE_ID = '507f1f77bcf86cd799439022';
    const INSTRUCTOR_ID = '507f1f77bcf86cd799439033';

    const course = (overrides = {}) => ({
      _id: COURSE_ID,
      instructor: { toString: () => INSTRUCTOR_ID },
      ...overrides,
    });

    testCase(
      {
        id: 'TC-FR-10-U01',
        name: 'checkCourseAccess returns 404 for a course that does not exist',
        requirement: 'FR-10',
        type: 'Unit',
        priority: 'P2',
        preconditions: 'The requested course id matches no course',
        input: 'checkCourseAccess with params.id for a missing course',
        expected: 'HTTP 404 "Course not found"; next() not called',
      },
      async () => {
        Course.findById.mockResolvedValue(null);
        const request = mockRequest({ params: { id: COURSE_ID }, user: { role: 'student' } });

        const { next, res } = await runMiddleware(checkCourseAccess, request);

        expect(res.status).toHaveBeenCalledWith(404);
        expect(next).not.toHaveBeenCalled();
      },
    );

    testCase(
      {
        id: 'TC-FR-05-U03',
        name: 'checkCourseAccess grants an admin access to any course without an enrolment check',
        requirement: 'FR-05',
        type: 'Unit',
        priority: 'P1',
        preconditions: 'The requesting user is an admin who does not own the course',
        input: 'checkCourseAccess with req.user.role = "admin"',
        expected: 'next() is called; req.course is set; Progress is never queried',
      },
      async () => {
        Course.findById.mockResolvedValue(course());
        const request = mockRequest({
          params: { id: COURSE_ID },
          user: { role: 'admin', _id: { toString: () => 'someone-else' } },
        });

        const { next, req } = await runMiddleware(checkCourseAccess, request);

        expect(next).toHaveBeenCalledTimes(1);
        expect(req.course).toBeDefined();
        expect(Progress.findOne).not.toHaveBeenCalled();
      },
    );

    testCase(
      {
        id: 'TC-FR-05-U04',
        name: 'checkCourseAccess grants the owning instructor access to their own course',
        requirement: 'FR-05',
        type: 'Unit',
        priority: 'P1',
        preconditions: 'The requesting user is the course instructor',
        input: 'checkCourseAccess where course.instructor equals req.user._id',
        expected: 'next() is called; req.course is set',
      },
      async () => {
        Course.findById.mockResolvedValue(course());
        const request = mockRequest({
          params: { id: COURSE_ID },
          user: { role: 'instructor', _id: { toString: () => INSTRUCTOR_ID } },
        });

        const { next, req } = await runMiddleware(checkCourseAccess, request);

        expect(next).toHaveBeenCalledTimes(1);
        expect(req.course).toBeDefined();
      },
    );

    testCase(
      {
        id: 'TC-FR-10-U02',
        name: 'checkCourseAccess grants an enrolled student access and attaches their progress',
        requirement: 'FR-10',
        type: 'Unit',
        priority: 'P1',
        preconditions: 'A Progress record links the student to the course',
        input: 'checkCourseAccess with a student who has a Progress record',
        expected: 'next() is called; req.progress and req.course are both set',
      },
      async () => {
        const progress = { overallProgress: 42 };
        Course.findById.mockResolvedValue(course());
        Progress.findOne.mockResolvedValue(progress);
        const request = mockRequest({
          params: { id: COURSE_ID },
          user: { role: 'student', _id: 'student-1' },
        });

        const { next, req } = await runMiddleware(checkCourseAccess, request);

        expect(next).toHaveBeenCalledTimes(1);
        expect(req.progress).toBe(progress);
        expect(req.course).toBeDefined();
      },
    );

    testCase(
      {
        id: 'TC-FR-10-U03',
        name: 'checkCourseAccess refuses a student who is not enrolled',
        requirement: 'FR-10',
        type: 'Unit',
        priority: 'P1',
        preconditions: 'No Progress record links the student to the course',
        input: 'checkCourseAccess with a student and Progress.findOne resolving null',
        expected: 'HTTP 403 "You are not enrolled in this course"; next() not called',
      },
      async () => {
        Course.findById.mockResolvedValue(course());
        Progress.findOne.mockResolvedValue(null);
        const request = mockRequest({
          params: { id: COURSE_ID },
          user: { role: 'student', _id: 'student-1' },
        });

        const { next, res } = await runMiddleware(checkCourseAccess, request);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith({
          success: false,
          message: 'You are not enrolled in this course',
        });
        expect(next).not.toHaveBeenCalled();
      },
    );

    it('falls back to params.courseId when params.id is absent', async () => {
      Course.findById.mockResolvedValue(course());
      const request = mockRequest({
        params: { courseId: COURSE_ID },
        user: { role: 'admin', _id: { toString: () => 'x' } },
      });

      await runMiddleware(checkCourseAccess, request);

      expect(Course.findById).toHaveBeenCalledWith(COURSE_ID);
    });

    it('returns 500 without leaking the error when the lookup throws', async () => {
      Course.findById.mockRejectedValue(new Error('replica set election in progress'));
      const request = mockRequest({ params: { id: COURSE_ID }, user: { role: 'student' } });

      const { next, res } = await runMiddleware(checkCourseAccess, request);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Server error' });
      expect(next).not.toHaveBeenCalled();
      expect(JSON.stringify(res.body)).not.toMatch(/replica set/);
    });

    it('lets a non-owning instructor through without an enrolment check', async () => {
      // Documents a real authorisation gap: the enrolment branch is guarded by
      // `role === 'student'`, so an instructor who does not own the course
      // falls through to next(). See DEFECT-04 in docs/testing/DEFECT_REGISTER.md.
      Course.findById.mockResolvedValue(course());
      const request = mockRequest({
        params: { id: COURSE_ID },
        user: { role: 'instructor', _id: { toString: () => 'a-different-instructor' } },
      });

      const { next, req } = await runMiddleware(checkCourseAccess, request);

      expect(next).toHaveBeenCalledTimes(1);
      expect(req.progress).toBeUndefined();
    });
  });
});
