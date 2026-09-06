/**
 * Integration tests — database constraints as MongoDB actually enforces them.
 *
 * Requirements: FR-01, FR-10, FR-14, FR-15, NFR-02 (Data Integrity).
 *
 * Route handlers guard against duplicates by reading first and writing second,
 * which two concurrent requests can both pass. The unique index is the only
 * thing that actually holds the line, so these tests assert against the real
 * engine rather than against the handler's intent.
 */

'use strict';

const { requireFromSut } = require('@support/sut');
const { testCase } = require('@support/test-case');
const { loadApp } = require('@support/app');
const {
  buildUser,
  createStudent,
  createCourse,
  createCertificate,
  createPayment,
  enrolStudent,
} = require('@factories');

// Loading the application registers every model with Mongoose. Without it,
// only the models this file happens to require would be inspected, and a
// malformed index on any other model would go unnoticed.
loadApp();

const User = requireFromSut('./models/User');
const Progress = requireFromSut('./models/Progress');
const Payment = requireFromSut('./models/Payment');
const Certificate = requireFromSut('./models/Certificate');

describe('unique constraints', () => {
  testCase(
    {
      id: 'TC-FR-01-06',
      name: 'MongoDB rejects a second user with the same email address',
      requirement: 'FR-01',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'A user exists with a given email address',
      input: 'Insert a second user document with the same email, bypassing the route',
      expected: 'The write is rejected with duplicate-key error 11000; one user remains',
    },
    async () => {
      // The registration route's "does this email exist?" check is a race; the
      // index is what makes the guarantee.
      const attributes = buildUser();
      await User.create(attributes);

      await expect(User.create(buildUser({ email: attributes.email }))).rejects.toMatchObject({
        code: 11000,
      });
      expect(await User.countDocuments({ email: attributes.email.toLowerCase() })).toBe(1);
    },
  );

  it('treats emails differing only in case as the same address', async () => {
    const attributes = buildUser({ email: 'Ayesha.Perera@SriKo.LK' });
    await User.create(attributes);

    await expect(User.create(buildUser({ email: 'ayesha.perera@sriko.lk' }))).rejects.toMatchObject(
      { code: 11000 },
    );
  });

  it('permits many users with no googleId, because the index is sparse', async () => {
    // A plain unique index would reject the second local-auth account, since
    // both would store null.
    await User.create(buildUser());
    await User.create(buildUser());

    expect(await User.countDocuments()).toBe(2);
  });

  it('rejects a second user with the same googleId', async () => {
    await User.create({ ...buildUser(), googleId: 'google-subject-1', authProvider: 'google' });

    await expect(
      User.create({ ...buildUser(), googleId: 'google-subject-1', authProvider: 'google' }),
    ).rejects.toMatchObject({ code: 11000 });
  });

  testCase(
    {
      id: 'TC-FR-10-06',
      name: 'MongoDB rejects a duplicate enrolment for the same student and course',
      requirement: 'FR-10',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'A Progress record already links the student to the course',
      input: 'Insert a second Progress record for the same pair',
      expected: 'Duplicate-key error 11000; one enrolment remains',
    },
    async () => {
      const { user } = await createStudent();
      const course = await createCourse();
      await enrolStudent(user._id, course._id);

      await expect(
        Progress.create({ student: user._id, course: course._id }),
      ).rejects.toMatchObject({ code: 11000 });
      expect(await Progress.countDocuments()).toBe(1);
    },
  );

  it('allows the same student to enrol in two different courses', async () => {
    const { user } = await createStudent();
    const first = await createCourse();
    const second = await createCourse();

    await enrolStudent(user._id, first._id);
    await enrolStudent(user._id, second._id);

    expect(await Progress.countDocuments({ student: user._id })).toBe(2);
  });

  testCase(
    {
      id: 'TC-FR-14-14',
      name: 'MongoDB rejects a duplicate invoice number',
      requirement: 'FR-14',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'A payment exists with a known invoice number',
      input: 'Insert a second payment carrying the same invoice number',
      expected: 'Duplicate-key error 11000 — invoice numbers are a legal identifier',
    },
    async () => {
      const first = await createPayment({ invoiceNumber: 'INV-202603-0001' });

      await expect(createPayment({ invoiceNumber: first.invoiceNumber })).rejects.toMatchObject({
        code: 11000,
      });
    },
  );

  it('permits many payments with no receipt number', async () => {
    await createPayment({ status: 'pending', receiptNumber: undefined });
    await createPayment({ status: 'pending', receiptNumber: undefined });

    expect(await Payment.countDocuments()).toBe(2);
  });

  testCase(
    {
      id: 'TC-FR-15-14',
      name: 'MongoDB rejects a duplicate certificate number',
      requirement: 'FR-15',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'A certificate exists with a known number',
      input: 'Insert a second certificate carrying the same number',
      expected: 'Duplicate-key error 11000 — a certificate number identifies one award',
    },
    async () => {
      const first = await createCertificate();

      await expect(
        createCertificate({ certificateNumber: first.certificateNumber }),
      ).rejects.toMatchObject({ code: 11000 });
    },
  );
});

describe('sequential certificate numbering against a real database', () => {
  testCase(
    {
      id: 'TC-FR-15-15',
      name: 'Certificates issued one after another receive consecutive numbers',
      requirement: 'FR-15',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'No certificate exists for the current year',
      input: 'Three certificates created in sequence',
      expected: 'Numbers CERT-000001, CERT-000002 and CERT-000003 for the current year',
    },
    async () => {
      const year = new Date().getFullYear();

      const numbers = [];
      for (let i = 0; i < 3; i += 1) {
        // Sequential by design: the generator reads the previous highest value,
        // so creating them in parallel is a different scenario entirely.
        // eslint-disable-next-line no-await-in-loop
        const certificate = await createCertificate();
        numbers.push(certificate.certificateNumber);
      }

      expect(numbers).toEqual([
        `CERT-000001-${year}`,
        `CERT-000002-${year}`,
        `CERT-000003-${year}`,
      ]);
    },
  );

  testCase.failing(
    {
      id: 'TC-FR-15-16',
      name: 'Certificates issued concurrently still receive distinct numbers',
      requirement: 'FR-15',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'No certificate exists for the current year',
      input: 'Five certificates created concurrently with Promise.all',
      expected: 'All five are created and every number is distinct',
      defect: 'DEFECT-29',
    },
    async () => {
      // "Read the highest number, add one, write" is a read-modify-write race.
      // Concurrent requests read the same highest value and then collide on the
      // unique index, so an administrator issuing a batch of certificates sees
      // some of them fail. A counter document or an atomic findOneAndUpdate
      // would remove the race.
      const results = await Promise.allSettled(
        Array.from({ length: 5 }, () => createCertificate()),
      );

      const created = results.filter((result) => result.status === 'fulfilled');
      expect(created).toHaveLength(5);

      const numbers = created.map((result) => result.value.certificateNumber);
      expect(new Set(numbers).size).toBe(5);
    },
  );
});

describe('declared indexes are well formed', () => {
  /** Every `schema.index(spec)` declaration across the application's models. */
  function declaredIndexes() {
    const mongoose = requireFromSut('mongoose');
    return Object.values(mongoose.models).flatMap((model) =>
      model.schema.indexes().map(([keys, options]) => ({
        model: model.modelName,
        keys,
        options: options || {},
      })),
    );
  }

  testCase.failing(
    {
      id: 'TC-NFR-02-03',
      name: 'No schema declares an index with an empty key specification',
      requirement: 'NFR-02',
      type: 'Integration',
      priority: 'P2',
      preconditions: 'Every model has been loaded',
      input: 'Inspection of schema.indexes() across all registered models',
      expected: 'Every declared index names at least one field',
      defect: 'DEFECT-12',
    },
    () => {
      // `Settings.js:201` declares `settingsSchema.index({}, { unique: true })`.
      // MongoDB refuses an index with no keys, and Mongoose logs the failure
      // and carries on — so the singleton constraint the author intended has
      // never existed in any environment. A partial unique index on a constant
      // field, or an application-level guard, would work.
      //
      // Asserted against the declaration rather than a live index build,
      // because MongoDB reports the malformed spec only on the first attempt
      // against a given collection.
      const empty = declaredIndexes().filter((index) => Object.keys(index.keys).length === 0);

      expect(empty).toEqual([]);
    },
  );

  it('pins the one known empty index declaration to the Settings model', () => {
    // Companion to TC-NFR-02-03: a *new* malformed index shows up as a change
    // here rather than hiding behind the known one.
    const empty = declaredIndexes().filter((index) => Object.keys(index.keys).length === 0);

    expect(empty).toHaveLength(1);
    expect(empty[0].model).toBe('Settings');
    expect(empty[0].options.unique).toBe(true);
  });

  it('confirms MongoDB rejects that specification', async () => {
    // Proves the declaration is not merely unusual but genuinely invalid, so
    // the defect entry is evidence-backed rather than an assumption.
    const mongoose = requireFromSut('mongoose');
    const collection = mongoose.connection.collection('index_spec_probe');

    await expect(collection.createIndex({}, { unique: true })).rejects.toThrow(
      /Index keys cannot be empty/,
    );

    await collection.drop().catch(() => {});
  });

  it('builds the User email index, so the duplicate guard is real', async () => {
    const indexes = await User.collection.indexes();

    const emailIndex = indexes.find((index) => index.key && index.key.email === 1);
    expect(emailIndex).toBeDefined();
    expect(emailIndex.unique).toBe(true);
  });

  it('builds the Progress student+course compound index', async () => {
    const indexes = await Progress.collection.indexes();

    const compound = indexes.find(
      (index) => index.key && index.key.student === 1 && index.key.course === 1,
    );
    expect(compound).toBeDefined();
    expect(compound.unique).toBe(true);
  });

  it('builds the Certificate number index as sparse and unique', async () => {
    const indexes = await Certificate.collection.indexes();

    const numberIndex = indexes.find((index) => index.key && index.key.certificateNumber === 1);
    expect(numberIndex).toMatchObject({ unique: true, sparse: true });
  });
});
