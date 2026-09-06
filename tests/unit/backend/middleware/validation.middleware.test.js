/**
 * Unit tests — middleware/validation.js
 *
 * Requirements: NFR-04 (Input Validation), FR-01, FR-02, FR-06, FR-09, FR-12,
 * FR-23; OWASP A03 (Injection) and A04 (Insecure Design).
 *
 * Validation rules are where "what the system accepts" is actually defined, so
 * these tests concentrate on *boundaries* — one below, exactly on, one above —
 * rather than on a single happy value per rule. Each chain is driven through
 * express-validator's own `.run()`, which is how the rules behave in
 * production.
 */

'use strict';

const { requireFromSut } = require('@support/sut');
const {
  runValidators,
  mockRequest,
  mockResponse,
  runMiddleware,
} = require('@support/http-doubles');
const { testCase } = require('@support/test-case');

const {
  handleValidationErrors,
  validateUserRegistration,
  validateUserLogin,
  validateProfileUpdate,
  validateJoinUsSubmission,
  validateCourseCreation,
  validateCurriculum,
  validateReview,
} = requireFromSut('./middleware/validation');

describe('middleware/validation', () => {
  describe('handleValidationErrors', () => {
    testCase(
      {
        id: 'TC-NFR-04-U01',
        name: 'handleValidationErrors continues when no rule failed',
        requirement: 'NFR-04',
        type: 'Unit',
        priority: 'P1',
        preconditions: 'No validation errors are attached to the request',
        input: 'handleValidationErrors(req, res, next) on a clean request',
        expected: 'next() is called; no response is written',
      },
      async () => {
        const { next, res } = await runMiddleware(handleValidationErrors, mockRequest());

        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalled();
      },
    );

    testCase(
      {
        id: 'TC-NFR-04-U02',
        name: 'handleValidationErrors returns 400 with the collected errors',
        requirement: 'NFR-04',
        type: 'Unit',
        priority: 'P1',
        preconditions: 'A validator chain has recorded at least one error',
        input: 'A registration body with an invalid email, then handleValidationErrors',
        expected: 'HTTP 400; success=false; message "Validation failed"; errors[] naming the field',
      },
      async () => {
        const request = mockRequest({
          body: { name: 'Ok', email: 'nope', password: 'TestPass123' },
        });
        for (const validator of validateUserRegistration) {
          if (validator.run) await validator.run(request);
        }

        const { next, res } = await runMiddleware(handleValidationErrors, request);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.body.success).toBe(false);
        expect(res.body.message).toBe('Validation failed');
        expect(res.body.errors.length).toBeGreaterThan(0);
        expect(next).not.toHaveBeenCalled();
      },
    );
  });

  describe('validateUserRegistration', () => {
    testCase(
      {
        id: 'TC-FR-01-U06',
        name: 'A well-formed registration body raises no validation errors',
        requirement: 'FR-01',
        type: 'Unit',
        priority: 'P1',
        preconditions: 'None',
        input:
          '{ name: "Ayesha Perera", email: "ayesha@sriko.lk", password: "TestPass123", role: "student" }',
        expected: 'The chain records no errors',
      },
      async () => {
        const result = await runValidators(validateUserRegistration, {
          name: 'Ayesha Perera',
          email: 'ayesha@sriko.lk',
          password: 'TestPass123',
          role: 'student',
        });

        expect(result.isEmpty).toBe(true);
      },
    );

    it.each([
      ['one character (below the minimum)', 'A', true],
      ['exactly two characters (the minimum)', 'Ab', false],
      ['exactly fifty characters (the maximum)', 'a'.repeat(50), false],
      ['fifty-one characters (above the maximum)', 'a'.repeat(51), true],
    ])('a name of %s is rejected: %s', async (_label, name, shouldFail) => {
      const result = await runValidators(validateUserRegistration, {
        name,
        email: 'valid@sriko.lk',
        password: 'TestPass123',
      });

      expect(result.hasErrorOn('name')).toBe(shouldFail);
    });

    testCase(
      {
        id: 'TC-FR-01-U07',
        name: 'The password policy requires an uppercase letter, a lowercase letter and a digit',
        requirement: 'FR-01',
        type: 'Unit',
        priority: 'P1',
        preconditions: 'None',
        input: 'Passwords missing each required character class in turn',
        expected: 'Each is rejected on the "password" field; a compliant password is accepted',
      },
      async () => {
        const attempt = (password) =>
          runValidators(validateUserRegistration, {
            name: 'Ayesha Perera',
            email: 'valid@sriko.lk',
            password,
          });

        expect((await attempt('testpass123')).hasErrorOn('password')).toBe(true); // no uppercase
        expect((await attempt('TESTPASS123')).hasErrorOn('password')).toBe(true); // no lowercase
        expect((await attempt('TestPassword')).hasErrorOn('password')).toBe(true); // no digit
        expect((await attempt('Test1')).hasErrorOn('password')).toBe(true); // too short
        expect((await attempt('TestPass123')).hasErrorOn('password')).toBe(false);
      },
    );

    it('accepts a password of exactly six characters that meets every class', async () => {
      const result = await runValidators(validateUserRegistration, {
        name: 'Ayesha Perera',
        email: 'valid@sriko.lk',
        password: 'Abc123',
      });

      expect(result.hasErrorOn('password')).toBe(false);
    });

    it.each(['student', 'instructor', 'admin'])('accepts the role "%s"', async (role) => {
      const result = await runValidators(validateUserRegistration, {
        name: 'Ayesha Perera',
        email: 'valid@sriko.lk',
        password: 'TestPass123',
        role,
      });

      expect(result.hasErrorOn('role')).toBe(false);
    });

    it('rejects a role outside the enumeration', async () => {
      const result = await runValidators(validateUserRegistration, {
        name: 'Ayesha Perera',
        email: 'valid@sriko.lk',
        password: 'TestPass123',
        role: 'superadmin',
      });

      expect(result.hasErrorOn('role')).toBe(true);
      expect(result.messageFor('role')).toBe('Role must be student, instructor, or admin');
    });

    it('treats an absent role as valid, because it is optional', async () => {
      const result = await runValidators(validateUserRegistration, {
        name: 'Ayesha Perera',
        email: 'valid@sriko.lk',
        password: 'TestPass123',
      });

      expect(result.isEmpty).toBe(true);
    });

    it('reports every failing field at once rather than stopping at the first', async () => {
      // Returning all errors in one response is what lets the client highlight
      // every bad field instead of making the user resubmit repeatedly.
      const result = await runValidators(validateUserRegistration, {
        name: 'A',
        email: 'not-an-email',
        password: 'short',
      });

      expect(result.fields).toEqual(expect.arrayContaining(['name', 'email', 'password']));
    });
  });

  describe('validateUserLogin', () => {
    it('accepts a valid email and a non-empty password', async () => {
      const result = await runValidators(validateUserLogin, {
        email: 'ayesha@sriko.lk',
        password: 'anything',
      });

      expect(result.isEmpty).toBe(true);
    });

    it('does not apply the registration password policy to login', async () => {
      // Login must accept legacy passwords that predate the current policy;
      // enforcing the policy here would lock those users out entirely.
      const result = await runValidators(validateUserLogin, {
        email: 'ayesha@sriko.lk',
        password: 'a',
      });

      expect(result.hasErrorOn('password')).toBe(false);
    });

    it.each([
      ['an empty password', { email: 'ayesha@sriko.lk', password: '' }, 'password'],
      ['a missing password', { email: 'ayesha@sriko.lk' }, 'password'],
      ['a malformed email', { email: 'nope', password: 'x' }, 'email'],
      ['a missing email', { password: 'x' }, 'email'],
    ])('rejects %s', async (_label, body, field) => {
      const result = await runValidators(validateUserLogin, body);

      expect(result.hasErrorOn(field)).toBe(true);
    });

    it('normalises the email so login is case-insensitive', async () => {
      const request = mockRequest({ body: { email: 'Ayesha@SRIKO.LK', password: 'x' } });
      for (const validator of validateUserLogin) {
        if (validator.run) await validator.run(request);
      }

      expect(request.body.email).toBe('ayesha@sriko.lk');
    });
  });

  describe('validateProfileUpdate', () => {
    it('accepts an empty body, because every field is optional', async () => {
      const result = await runValidators(validateProfileUpdate, {});

      expect(result.isEmpty).toBe(true);
    });

    it.each([
      ['bio', 'x'.repeat(501)],
      ['phone', 'x'.repeat(21)],
      ['location', 'x'.repeat(101)],
      ['website', 'x'.repeat(201)],
      ['avatar', 'x'.repeat(501)],
      ['socialLinks.linkedin', 'x'.repeat(201)],
      ['socialLinks.twitter', 'x'.repeat(201)],
      ['socialLinks.github', 'x'.repeat(201)],
    ])('rejects %s beyond its maximum length', async (field, value) => {
      const body = field.includes('.')
        ? { socialLinks: { [field.split('.')[1]]: value } }
        : { [field]: value };

      const result = await runValidators(validateProfileUpdate, body);

      expect(result.hasErrorOn(field)).toBe(true);
    });

    it.each([
      ['bio', 'x'.repeat(500)],
      ['phone', 'x'.repeat(20)],
      ['location', 'x'.repeat(100)],
    ])('accepts %s at exactly its maximum length', async (field, value) => {
      const result = await runValidators(validateProfileUpdate, { [field]: value });

      expect(result.hasErrorOn(field)).toBe(false);
    });

    it('rejects a name shorter than two characters', async () => {
      const result = await runValidators(validateProfileUpdate, { name: 'A' });

      expect(result.hasErrorOn('name')).toBe(true);
    });

    it('does not validate the website field as a URL', async () => {
      // Only length is checked, so "javascript:alert(1)" passes validation.
      // The rendering layer must therefore treat this field as untrusted.
      // See DEFECT-06 in docs/testing/DEFECT_REGISTER.md.
      const result = await runValidators(validateProfileUpdate, {
        website: 'javascript:alert(1)',
      });

      expect(result.hasErrorOn('website')).toBe(false);
    });
  });

  describe('validateCourseCreation', () => {
    const validCourse = {
      title: 'Korean for Beginners',
      description: 'A ten week introduction to the Korean language.',
      category: 'other',
      level: 'beginner',
      duration: 10,
      price: 5000,
    };

    testCase(
      {
        id: 'TC-FR-09-U01',
        name: 'A well-formed course payload raises no validation errors',
        requirement: 'FR-09',
        type: 'Unit',
        priority: 'P1',
        preconditions: 'None',
        input: 'A course with a valid title, description, category, level, duration and price',
        expected: 'The chain records no errors',
      },
      async () => {
        const result = await runValidators(validateCourseCreation, validCourse);

        expect(result.isEmpty).toBe(true);
      },
    );

    it.each([
      ['four characters (below the minimum)', 'abcd', true],
      ['exactly five characters (the minimum)', 'abcde', false],
      ['exactly one hundred characters (the maximum)', 'a'.repeat(100), false],
      ['one hundred and one characters (above the maximum)', 'a'.repeat(101), true],
    ])('a title of %s is rejected: %s', async (_label, title, shouldFail) => {
      const result = await runValidators(validateCourseCreation, { ...validCourse, title });

      expect(result.hasErrorOn('title')).toBe(shouldFail);
    });

    it.each([
      ['nine characters (below the minimum)', 'a'.repeat(9), true],
      ['exactly ten characters (the minimum)', 'a'.repeat(10), false],
      ['exactly one thousand characters (the maximum)', 'a'.repeat(1000), false],
      ['one thousand and one characters (above the maximum)', 'a'.repeat(1001), true],
    ])('a description of %s is rejected: %s', async (_label, description, shouldFail) => {
      const result = await runValidators(validateCourseCreation, { ...validCourse, description });

      expect(result.hasErrorOn('description')).toBe(shouldFail);
    });

    it.each(['programming', 'design', 'business', 'marketing', 'lifestyle', 'other'])(
      'accepts the category "%s"',
      async (category) => {
        const result = await runValidators(validateCourseCreation, { ...validCourse, category });

        expect(result.hasErrorOn('category')).toBe(false);
      },
    );

    it('rejects a category outside the enumeration', async () => {
      const result = await runValidators(validateCourseCreation, {
        ...validCourse,
        category: 'korean-language',
      });

      expect(result.hasErrorOn('category')).toBe(true);
    });

    it.each(['beginner', 'intermediate', 'advanced'])('accepts the level "%s"', async (level) => {
      const result = await runValidators(validateCourseCreation, { ...validCourse, level });

      expect(result.hasErrorOn('level')).toBe(false);
    });

    it.each([
      ['zero (below the minimum)', 0, true],
      ['one (the minimum)', 1, false],
      ['fifty-two (the maximum)', 52, false],
      ['fifty-three (above the maximum)', 53, true],
      ['a non-integer', 4.5, true],
      ['a non-numeric string', 'ten', true],
    ])('a duration of %s is rejected: %s', async (_label, duration, shouldFail) => {
      const result = await runValidators(validateCourseCreation, { ...validCourse, duration });

      expect(result.hasErrorOn('duration')).toBe(shouldFail);
    });

    it.each([
      ['a negative price', -1, true],
      ['zero, for a free course', 0, false],
      ['a fractional price', 1999.99, false],
      ['a non-numeric price', 'free', true],
    ])('%s is rejected: %s', async (_label, price, shouldFail) => {
      const result = await runValidators(validateCourseCreation, { ...validCourse, price });

      expect(result.hasErrorOn('price')).toBe(shouldFail);
    });
  });

  describe('validateCurriculum', () => {
    const validWeek = {
      week: 1,
      title: 'Hangul',
      lessons: [{ title: 'The consonants' }],
    };

    it('accepts a curriculum with one complete week', async () => {
      const result = await runValidators(validateCurriculum, { curriculum: [validWeek] });

      expect(result.isEmpty).toBe(true);
    });

    it('rejects an empty curriculum', async () => {
      const result = await runValidators(validateCurriculum, { curriculum: [] });

      expect(result.hasErrorOn('curriculum')).toBe(true);
    });

    it('rejects a curriculum that is not an array', async () => {
      const result = await runValidators(validateCurriculum, { curriculum: 'week one' });

      expect(result.hasErrorOn('curriculum')).toBe(true);
    });

    it('rejects a week numbered zero or below', async () => {
      const result = await runValidators(validateCurriculum, {
        curriculum: [{ ...validWeek, week: 0 }],
      });

      expect(result.hasErrorOn('curriculum[0].week')).toBe(true);
    });

    it('rejects a week with no lessons', async () => {
      const result = await runValidators(validateCurriculum, {
        curriculum: [{ ...validWeek, lessons: [] }],
      });

      expect(result.hasErrorOn('curriculum[0].lessons')).toBe(true);
    });

    it('rejects a lesson title shorter than three characters', async () => {
      const result = await runValidators(validateCurriculum, {
        curriculum: [{ ...validWeek, lessons: [{ title: 'ab' }] }],
      });

      expect(result.hasErrorOn('curriculum[0].lessons[0].title')).toBe(true);
    });

    it('validates every week, not only the first', async () => {
      const result = await runValidators(validateCurriculum, {
        curriculum: [validWeek, { ...validWeek, week: 2, title: 'ab' }],
      });

      expect(result.hasErrorOn('curriculum[1].title')).toBe(true);
    });
  });

  describe('validateReview', () => {
    it.each([
      ['zero (below the range)', 0, true],
      ['one (the minimum)', 1, false],
      ['five (the maximum)', 5, false],
      ['six (above the range)', 6, true],
      ['a fractional rating', 4.5, true],
      ['a missing rating', undefined, true],
    ])('a rating of %s is rejected: %s', async (_label, rating, shouldFail) => {
      const result = await runValidators(validateReview, rating === undefined ? {} : { rating });

      expect(result.hasErrorOn('rating')).toBe(shouldFail);
    });

    it('accepts a review with no comment', async () => {
      const result = await runValidators(validateReview, { rating: 5 });

      expect(result.isEmpty).toBe(true);
    });

    it('rejects a comment longer than 500 characters', async () => {
      const result = await runValidators(validateReview, { rating: 5, comment: 'x'.repeat(501) });

      expect(result.hasErrorOn('comment')).toBe(true);
    });
  });

  describe('validateJoinUsSubmission', () => {
    const validSubmission = {
      name: 'Ayesha Perera',
      email: 'ayesha@sriko.lk',
      phone: '0771234567',
      age: 25,
      currentLevel: 'Complete Beginner',
      preferredTime: 'Evening (6:00 PM - 9:00 PM)',
      interests: ['Korean Language Basics'],
      hearAboutUs: 'website',
      message: 'I would like to enrol.',
    };

    testCase(
      {
        id: 'TC-FR-23-U01',
        name: 'A complete Join Us submission raises no validation errors',
        requirement: 'FR-23',
        type: 'Unit',
        priority: 'P2',
        preconditions: 'None',
        input: 'A submission with every optional field populated with a valid value',
        expected: 'The chain records no errors',
      },
      async () => {
        const result = await runValidators(validateJoinUsSubmission, validSubmission);

        expect(result.isEmpty).toBe(true);
      },
    );

    it('accepts a submission carrying only the required name and email', async () => {
      const result = await runValidators(validateJoinUsSubmission, {
        name: 'Ayesha Perera',
        email: 'ayesha@sriko.lk',
      });

      expect(result.isEmpty).toBe(true);
    });

    it.each([
      ['fifteen (below the minimum)', 15, true],
      ['sixteen (the minimum)', 16, false],
      ['eighty (the maximum)', 80, false],
      ['eighty-one (above the maximum)', 81, true],
    ])('an age of %s is rejected: %s', async (_label, age, shouldFail) => {
      const result = await runValidators(validateJoinUsSubmission, { ...validSubmission, age });

      expect(result.hasErrorOn('age')).toBe(shouldFail);
    });

    it('rejects an unrecognised Korean proficiency level', async () => {
      const result = await runValidators(validateJoinUsSubmission, {
        ...validSubmission,
        currentLevel: 'Fluent',
      });

      expect(result.hasErrorOn('currentLevel')).toBe(true);
    });

    it('rejects an unrecognised interest inside the array', async () => {
      const result = await runValidators(validateJoinUsSubmission, {
        ...validSubmission,
        interests: ['Korean Language Basics', 'Rocket Science'],
      });

      expect(result.hasErrorOn('interests[1]')).toBe(true);
    });

    it('rejects interests supplied as a string rather than an array', async () => {
      const result = await runValidators(validateJoinUsSubmission, {
        ...validSubmission,
        interests: 'Korean Language Basics',
      });

      expect(result.hasErrorOn('interests')).toBe(true);
    });

    it('rejects a message longer than 1000 characters', async () => {
      const result = await runValidators(validateJoinUsSubmission, {
        ...validSubmission,
        message: 'x'.repeat(1001),
      });

      expect(result.hasErrorOn('message')).toBe(true);
    });

    it('ends with its own error handler rather than relying on the caller', async () => {
      // This chain embeds a terminal handler, unlike the others which expect
      // handleValidationErrors to be mounted after them. Losing it would make
      // every invalid submission reach the route body.
      const terminal = validateJoinUsSubmission[validateJoinUsSubmission.length - 1];

      expect(typeof terminal).toBe('function');
      expect(terminal.run).toBeUndefined();

      const request = mockRequest({ body: { name: 'A', email: 'nope' } });
      for (const validator of validateJoinUsSubmission) {
        if (validator.run) await validator.run(request);
      }
      const response = mockResponse();
      const next = jest.fn();
      terminal(request, response, next);

      expect(response.status).toHaveBeenCalledWith(400);
      expect(next).not.toHaveBeenCalled();
    });
  });
});
