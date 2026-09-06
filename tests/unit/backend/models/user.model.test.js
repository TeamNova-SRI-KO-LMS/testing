/**
 * Unit tests — models/User.js
 *
 * Requirements: FR-01 (Registration), FR-02 (Authentication), FR-06 (Profile),
 * FR-07 (Password Management), NFR-03 (Security).
 *
 * Schema validation is exercised through `validateSync()` and the instance
 * methods through unsaved documents, so nothing here touches a database. The
 * `pre('save')` hook is invoked directly, which is the only way to assert the
 * "skip when unmodified" branch without a round-trip.
 */

'use strict';

const { requireFromSut } = require('@support/sut');
const { testCase } = require('@support/test-case');
const { runPreHooks } = require('@support/mongoose-hooks');
const { buildUser } = require('@factories');

const User = requireFromSut('./models/User');
const bcrypt = requireFromSut('bcryptjs');
const jwt = requireFromSut('jsonwebtoken');

/** Run the model's own pre-save hook, with `isModified('password')` controlled. */
const runPreSave = (document, { passwordModified = true } = {}) =>
  runPreHooks(User, document, { modified: { password: passwordModified } });

describe('models/User', () => {
  describe('schema validation', () => {
    testCase(
      {
        id: 'TC-FR-01-U01',
        name: 'A user built from valid attributes passes schema validation',
        requirement: 'FR-01',
        type: 'Unit',
        priority: 'P1',
        preconditions: 'None',
        input: 'new User({ name, email, password, role: "student" })',
        expected: 'validateSync() returns undefined; defaults are applied',
      },
      () => {
        const user = new User(buildUser());

        expect(user.validateSync()).toBeUndefined();
        expect(user.role).toBe('student');
        expect(user.isActive).toBe(true);
        expect(user.emailVerified).toBe(false);
        expect(user.authProvider).toBe('local');
      },
    );

    testCase(
      {
        id: 'TC-FR-01-U02',
        name: 'A user without a name is rejected',
        requirement: 'FR-01',
        type: 'Unit',
        priority: 'P1',
        preconditions: 'None',
        input: 'new User({ email, password }) with no name',
        expected: 'validateSync() reports an error on "name"',
      },
      () => {
        const user = new User(buildUser({ name: undefined }));

        const errors = user.validateSync();

        expect(errors.errors.name).toBeDefined();
        expect(errors.errors.name.message).toBe('Please provide a name');
      },
    );

    testCase(
      {
        id: 'TC-FR-01-U03',
        name: 'A name longer than 50 characters is rejected at the boundary',
        requirement: 'FR-01',
        type: 'Unit',
        priority: 'P2',
        preconditions: 'None',
        input: 'Names of exactly 50 and exactly 51 characters',
        expected: '50 characters is accepted; 51 is rejected',
      },
      () => {
        expect(new User(buildUser({ name: 'a'.repeat(50) })).validateSync()).toBeUndefined();

        const tooLong = new User(buildUser({ name: 'a'.repeat(51) })).validateSync();
        expect(tooLong.errors.name.message).toBe('Name cannot be more than 50 characters');
      },
    );

    it.each([
      ['no at-sign', 'not-an-email'],
      ['no domain', 'user@'],
      ['no local part', '@example.com'],
      ['no top-level domain', 'user@example'],
      ['spaces', 'user name@example.com'],
    ])('rejects an email with %s', (_label, email) => {
      const errors = new User(buildUser({ email })).validateSync();

      expect(errors.errors.email).toBeDefined();
      expect(errors.errors.email.message).toBe('Please provide a valid email');
    });

    it('lowercases the email so lookups are case-insensitive', () => {
      const user = new User(buildUser({ email: 'Ayesha.PERERA@Example.COM' }));

      expect(user.email).toBe('ayesha.perera@example.com');
    });

    it('trims surrounding whitespace from the name', () => {
      expect(new User(buildUser({ name: '  Ayesha Perera  ' })).name).toBe('Ayesha Perera');
    });

    testCase(
      {
        id: 'TC-FR-07-U01',
        name: 'A password shorter than 6 characters is rejected at the boundary',
        requirement: 'FR-07',
        type: 'Unit',
        priority: 'P1',
        preconditions: 'None',
        input: 'Passwords of exactly 5 and exactly 6 characters',
        expected: '5 characters is rejected; 6 is accepted',
      },
      () => {
        const tooShort = new User(buildUser({ password: 'Ab1cd' })).validateSync();
        expect(tooShort.errors.password.message).toBe('Password should be at least 6 characters');

        expect(new User(buildUser({ password: 'Ab1cde' })).validateSync()).toBeUndefined();
      },
    );

    it('accepts a user with no password when authProvider is google', () => {
      // Google-authenticated accounts never hold a local password, so the
      // schema deliberately marks `password` optional.
      const user = new User(
        buildUser({ password: undefined, authProvider: 'google', googleId: 'g-123' }),
      );

      expect(user.validateSync()).toBeUndefined();
    });

    it.each(['student', 'instructor', 'admin'])('accepts the role "%s"', (role) => {
      expect(new User(buildUser({ role })).validateSync()).toBeUndefined();
    });

    it('rejects a role outside the enumeration', () => {
      const errors = new User(buildUser({ role: 'superuser' })).validateSync();

      expect(errors.errors.role).toBeDefined();
    });

    it('rejects a bio longer than 500 characters', () => {
      const errors = new User(buildUser({ bio: 'x'.repeat(501) })).validateSync();

      expect(errors.errors.bio.message).toBe('Bio cannot be more than 500 characters');
    });

    it('rejects a location longer than 100 characters', () => {
      const errors = new User(buildUser({ location: 'x'.repeat(101) })).validateSync();

      expect(errors.errors.location).toBeDefined();
    });

    it('applies the documented notification and privacy defaults', () => {
      const user = new User(buildUser());

      expect(user.notifications.emailNotifications).toBe(true);
      expect(user.notifications.courseUpdates).toBe(true);
      expect(user.notifications.assignmentReminders).toBe(true);
      expect(user.notifications.systemAnnouncements).toBe(true);
      // Marketing is the one channel that must be opt-in.
      expect(user.notifications.marketingEmails).toBe(false);

      expect(user.privacy.profileVisibility).toBe('public');
      expect(user.privacy.showEmail).toBe(false);
      expect(user.privacy.showCourses).toBe(true);
      expect(user.privacy.allowMessages).toBe(true);
    });

    it('rejects a profileVisibility outside the enumeration', () => {
      const errors = new User(
        buildUser({ privacy: { profileVisibility: 'secret' } }),
      ).validateSync();

      expect(errors.errors['privacy.profileVisibility']).toBeDefined();
    });

    it('marks the password field select:false so queries exclude it by default', () => {
      // The login route has to opt back in with .select('+password'); if this
      // ever flips, every user query starts returning password hashes.
      expect(User.schema.path('password').options.select).toBe(false);
    });
  });

  describe('password hashing (pre-save hook)', () => {
    testCase(
      {
        id: 'TC-FR-01-U04',
        name: 'The password is replaced by a bcrypt hash before the document is saved',
        requirement: 'FR-01',
        type: 'Unit',
        priority: 'P1',
        preconditions: 'A new user document holds a plain-text password',
        input: "The pre('save') hook runs with password modified",
        expected: 'The stored value is a bcrypt hash that verifies against the original',
      },
      async () => {
        const plain = 'TestPass123';
        const user = new User(buildUser({ password: plain }));

        await runPreSave(user);

        expect(user.password).not.toBe(plain);
        expect(user.password).toMatch(/^\$2[aby]\$\d{2}\$/);
        expect(await bcrypt.compare(plain, user.password)).toBe(true);
      },
    );

    testCase(
      {
        id: 'TC-FR-01-U05',
        name: 'An unchanged password is not re-hashed on save',
        requirement: 'FR-01',
        type: 'Unit',
        priority: 'P1',
        preconditions: 'An existing user is saved after editing a field other than the password',
        input: "The pre('save') hook runs with isModified('password') false",
        expected: 'The stored hash is byte-for-byte unchanged',
      },
      async () => {
        // Double-hashing is the classic bug here: the stored value becomes a
        // hash of a hash and every subsequent login fails.
        const user = new User(buildUser());
        await runPreSave(user);
        const firstHash = user.password;

        await runPreSave(user, { passwordModified: false });

        expect(user.password).toBe(firstHash);
      },
    );

    it('does nothing when the document has no password at all', async () => {
      const user = new User(buildUser({ password: undefined, authProvider: 'google' }));

      await runPreSave(user);

      expect(user.password).toBeUndefined();
    });

    it('produces a different hash for the same password each time (unique salt)', async () => {
      const first = new User(buildUser({ password: 'TestPass123' }));
      const second = new User(buildUser({ password: 'TestPass123' }));

      await runPreSave(first);
      await runPreSave(second);

      expect(first.password).not.toBe(second.password);
    });

    testCase.failing(
      {
        id: 'TC-NFR-03-U01',
        name: 'The bcrypt cost factor meets the OWASP A02 minimum of 12',
        requirement: 'NFR-03',
        type: 'Unit',
        priority: 'P1',
        preconditions: 'None',
        input: "The pre('save') hook hashes a password",
        expected: 'The hash declares a cost factor of at least 12',
        defect: 'DEFECT-02',
      },
      async () => {
        // SENG 34213 §8.1 (A02) requires "passwords hashed with bcrypt
        // (cost factor >= 12)". The application calls bcrypt.genSalt(10).
        // This assertion states the requirement; `testCase.failing` records
        // that it does not hold yet and will break once it is fixed.
        const user = new User(buildUser());

        await runPreSave(user);

        expect(user.password).toBeBcryptHash(12);
      },
    );

    it('currently hashes at cost factor 10', async () => {
      // The companion to TC-NFR-03-U01: pins the *actual* value so the defect
      // register stays accurate and any change is deliberate.
      const user = new User(buildUser());

      await runPreSave(user);

      expect(user.password).toMatch(/^\$2[aby]\$10\$/);
    });
  });

  describe('matchPassword', () => {
    testCase(
      {
        id: 'TC-FR-02-U01',
        name: 'matchPassword accepts the correct password and rejects anything else',
        requirement: 'FR-02',
        type: 'Unit',
        priority: 'P1',
        preconditions: 'A user document holds a bcrypt hash of "TestPass123"',
        input: 'matchPassword("TestPass123") and matchPassword("WrongPass123")',
        expected: 'true for the correct password, false for the incorrect one',
      },
      async () => {
        const user = new User(buildUser({ password: 'TestPass123' }));
        await runPreSave(user);

        await expect(user.matchPassword('TestPass123')).resolves.toBe(true);
        await expect(user.matchPassword('WrongPass123')).resolves.toBe(false);
      },
    );

    it.each([
      ['an empty string', ''],
      ['a case-different password', 'testpass123'],
      ['a prefix of the password', 'TestPass12'],
      ['the password with trailing whitespace', 'TestPass123 '],
    ])('rejects %s', async (_label, candidate) => {
      const user = new User(buildUser({ password: 'TestPass123' }));
      await runPreSave(user);

      await expect(user.matchPassword(candidate)).resolves.toBe(false);
    });
  });

  describe('getSignedJwtToken', () => {
    testCase(
      {
        id: 'TC-FR-02-U02',
        name: 'getSignedJwtToken issues a token carrying the user id and an expiry',
        requirement: 'FR-02',
        type: 'Unit',
        priority: 'P1',
        preconditions: 'JWT_SECRET is configured',
        input: 'user.getSignedJwtToken()',
        expected:
          'A JWT verifiable with JWT_SECRET whose payload id is the user id, with iat and exp',
      },
      () => {
        const user = new User(buildUser());

        const token = user.getSignedJwtToken();

        expect(token).toBeValidJwtFor(user._id);
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        expect(decoded.id).toBe(String(user._id));
        expect(decoded.exp).toBeGreaterThan(decoded.iat);
      },
    );

    it('honours JWT_EXPIRE when it is set', () => {
      const previous = process.env.JWT_EXPIRE;
      process.env.JWT_EXPIRE = '1h';
      try {
        const token = new User(buildUser()).getSignedJwtToken();

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        expect(decoded.exp - decoded.iat).toBe(3600);
      } finally {
        process.env.JWT_EXPIRE = previous;
      }
    });

    it('falls back to a seven-day lifetime when JWT_EXPIRE is unset', () => {
      // Deployments that set only JWT_SECRET still get a bounded token rather
      // than one that never expires.
      const previous = process.env.JWT_EXPIRE;
      delete process.env.JWT_EXPIRE;
      try {
        const token = new User(buildUser()).getSignedJwtToken();

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        expect(decoded.exp - decoded.iat).toBe(7 * 24 * 60 * 60);
      } finally {
        process.env.JWT_EXPIRE = previous;
      }
    });

    it('carries no personally identifiable information in the payload', () => {
      // A JWT payload is base64, not encrypted: anything placed there is
      // readable by the holder and by anything that logs the token.
      const user = new User(buildUser());

      const payload = JSON.parse(
        Buffer.from(user.getSignedJwtToken().split('.')[1], 'base64url').toString('utf8'),
      );

      expect(Object.keys(payload).sort()).toEqual(['exp', 'iat', 'id']);
      expect(JSON.stringify(payload)).not.toContain(user.email);
    });

    it('falls back to a default secret when JWT_SECRET is unset', () => {
      // Documents a real weakness: with no JWT_SECRET the application signs
      // with the literal 'fallback-secret'. See DEFECT-03.
      const previous = process.env.JWT_SECRET;
      delete process.env.JWT_SECRET;
      try {
        const token = new User(buildUser()).getSignedJwtToken();

        expect(() => jwt.verify(token, 'fallback-secret')).not.toThrow();
      } finally {
        process.env.JWT_SECRET = previous;
      }
    });
  });

  describe('getResetPasswordToken', () => {
    testCase(
      {
        id: 'TC-FR-07-U02',
        name: 'getResetPasswordToken returns a raw token but stores only its SHA-256 hash',
        requirement: 'FR-07',
        type: 'Unit',
        priority: 'P1',
        preconditions: 'A user document with no reset token',
        input: 'user.getResetPasswordToken()',
        expected:
          '40-hex raw token returned; resetPasswordToken holds its SHA-256 hash, never the raw value',
      },
      () => {
        const crypto = require('crypto');
        const user = new User(buildUser());

        const raw = user.getResetPasswordToken();

        expect(raw).toMatch(/^[0-9a-f]{40}$/);
        // A reset token stored in the clear is a database-read-to-account-takeover
        // path; only the hash may be persisted (OWASP A02).
        expect(user.resetPasswordToken).not.toBe(raw);
        expect(user.resetPasswordToken).toBe(crypto.createHash('sha256').update(raw).digest('hex'));
      },
    );

    testCase(
      {
        id: 'TC-FR-07-U03',
        name: 'A password reset token expires ten minutes after it is issued',
        requirement: 'FR-07',
        type: 'Unit',
        priority: 'P2',
        preconditions: 'System time is frozen at a known instant',
        input: 'user.getResetPasswordToken()',
        expected: 'resetPasswordExpire is exactly 10 minutes after the current time',
      },
      () => {
        jest.useFakeTimers().setSystemTime(new Date('2026-03-01T10:00:00.000Z'));
        const user = new User(buildUser());

        user.getResetPasswordToken();

        // The schema types this path as Date, so the numeric timestamp the
        // method assigns is cast on the way in.
        expect(user.resetPasswordExpire).toEqual(new Date('2026-03-01T10:10:00.000Z'));
      },
    );

    it('issues a different token on every call', () => {
      const user = new User(buildUser());

      const first = user.getResetPasswordToken();
      const second = user.getResetPasswordToken();

      expect(first).not.toBe(second);
      expect(user.resetPasswordToken).not.toBe(first);
    });
  });
});
