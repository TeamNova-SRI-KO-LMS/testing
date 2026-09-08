/**
 * Unit tests — models/Certificate.js
 *
 * Requirements: FR-15 (Certificate Issuance & Delivery).
 *
 * A certificate number is the public identifier a graduate quotes to an
 * employer, so it must be unique, sequential and correctly formatted. The
 * generator reads the previous highest number from the database, so
 * `this.constructor.findOne` is stubbed here to drive each branch — the
 * concurrency behaviour it implies is covered against a real database in
 * tests/integration/persistence/certificate-numbering.test.js.
 */

'use strict';

const { requireFromSut } = require('@support/sut');
const { runPreHooks } = require('@support/mongoose-hooks');
const { testCase } = require('@support/test-case');
const { buildCertificate } = require('@factories');

const Certificate = requireFromSut('./models/Certificate');
const mongoose = requireFromSut('mongoose');

const anObjectId = () => new mongoose.Types.ObjectId();

function aCertificate(overrides = {}) {
  return new Certificate({
    ...buildCertificate(overrides),
    student: overrides.student || anObjectId(),
    course: overrides.course || anObjectId(),
    issuedBy: overrides.issuedBy || anObjectId(),
  });
}

/**
 * Run the numbering hook with the "previous highest certificate" lookup
 * stubbed. The hook calls `this.constructor.findOne(...).sort(...)`, so the
 * stub has to return a thenable that also exposes `sort`.
 */
async function runNumbering(certificate, previousNumber) {
  const query = {
    sort: jest
      .fn()
      .mockResolvedValue(previousNumber ? { certificateNumber: previousNumber } : null),
  };
  const findOne = jest.fn().mockReturnValue(query);
  Object.defineProperty(certificate, 'constructor', {
    value: { findOne },
    configurable: true,
  });

  await runPreHooks(Certificate, certificate, { isNew: true });
  return { findOne, query };
}

describe('models/Certificate', () => {
  describe('schema validation', () => {
    it('accepts a well-formed certificate and applies its defaults', () => {
      const certificate = aCertificate({ status: undefined });

      expect(certificate.validateSync()).toBeUndefined();
      expect(certificate.status).toBe('pending');
      expect(certificate.emailSent).toBe(false);
      expect(certificate.viewedByStudent).toBe(false);
      expect(certificate.certificateUrl).toBe('');
    });

    it.each(['student', 'course', 'studentName', 'courseName', 'completionDate', 'issuedBy'])(
      'rejects a certificate with no %s',
      (field) => {
        const certificate = aCertificate();
        certificate[field] = undefined;

        expect(certificate.validateSync().errors[field]).toBeDefined();
      },
    );

    it('does not require a certificate number, because the hook supplies it', () => {
      const certificate = aCertificate();
      certificate.certificateNumber = undefined;

      expect(certificate.validateSync()).toBeUndefined();
    });

    it.each(['pending', 'issued', 'sent', 'delivered'])('accepts the status "%s"', (status) => {
      expect(aCertificate({ status }).validateSync()).toBeUndefined();
    });

    it('rejects a status outside the enumeration', () => {
      expect(aCertificate({ status: 'revoked' }).validateSync().errors.status).toBeDefined();
    });

    it('protects the certificate number with a sparse unique index', () => {
      const index = Certificate.schema.path('certificateNumber').options;

      expect(index.unique).toBe(true);
      expect(index.sparse).toBe(true);
    });
  });

  describe('certificate numbering (pre-save hook)', () => {
    testCase(
      {
        id: 'TC-FR-15-U01',
        name: 'The first certificate of a year is numbered CERT-000001-YYYY',
        requirement: 'FR-15',
        type: 'Unit',
        priority: 'P1',
        preconditions: 'No certificate exists for the current year',
        input: "The pre('save') hook runs on a new certificate; the lookup finds nothing",
        expected: 'certificateNumber is CERT-000001-2026',
      },
      async () => {
        jest.useFakeTimers().setSystemTime(new Date('2026-03-01T00:00:00.000Z'));
        const certificate = aCertificate();

        await runNumbering(certificate, null);

        expect(certificate.certificateNumber).toBe('CERT-000001-2026');
      },
    );

    testCase(
      {
        id: 'TC-FR-15-U02',
        name: 'Each certificate number increments the previous highest for the year',
        requirement: 'FR-15',
        type: 'Unit',
        priority: 'P1',
        preconditions: 'CERT-000041-2026 is the highest existing number',
        input: "The pre('save') hook runs on a new certificate",
        expected: 'certificateNumber is CERT-000042-2026',
      },
      async () => {
        jest.useFakeTimers().setSystemTime(new Date('2026-03-01T00:00:00.000Z'));
        const certificate = aCertificate();

        await runNumbering(certificate, 'CERT-000041-2026');

        expect(certificate.certificateNumber).toBe('CERT-000042-2026');
      },
    );

    it('pads the sequence to six digits', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-03-01T00:00:00.000Z'));
      const certificate = aCertificate();

      await runNumbering(certificate, 'CERT-000999-2026');

      expect(certificate.certificateNumber).toBe('CERT-001000-2026');
    });

    it('scopes the lookup to the current year so the sequence restarts annually', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2027-01-01T00:00:00.000Z'));
      const certificate = aCertificate();

      const { findOne } = await runNumbering(certificate, null);

      expect(findOne).toHaveBeenCalledWith({
        certificateNumber: { $regex: '^CERT-\\d{6}-2027$' },
      });
      expect(certificate.certificateNumber).toBe('CERT-000001-2027');
    });

    it('sorts descending so the highest existing number is the one read', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-03-01T00:00:00.000Z'));

      const { query } = await runNumbering(aCertificate(), 'CERT-000005-2026');

      expect(query.sort).toHaveBeenCalledWith({ certificateNumber: -1 });
    });

    it('starts from one when the previous number is unparseable', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-03-01T00:00:00.000Z'));
      const certificate = aCertificate();

      await runNumbering(certificate, 'LEGACY-CERT-XYZ');

      expect(certificate.certificateNumber).toBe('CERT-000001-2026');
    });

    it('does not renumber a certificate that already has a number', async () => {
      const certificate = aCertificate();
      certificate.certificateNumber = 'CERT-000123-2025';

      await runPreHooks(Certificate, certificate, { isNew: true });

      expect(certificate.certificateNumber).toBe('CERT-000123-2025');
    });

    it('does not number an existing document on re-save', async () => {
      const certificate = aCertificate();
      certificate.certificateNumber = undefined;

      await runPreHooks(Certificate, certificate, { isNew: false });

      expect(certificate.certificateNumber).toBeUndefined();
    });

    it('propagates a lookup failure instead of issuing a duplicate number', async () => {
      // Failing the save is the safe outcome: silently falling back to 1 would
      // collide with an existing certificate and violate the unique index.
      const certificate = aCertificate();
      Object.defineProperty(certificate, 'constructor', {
        value: {
          findOne: jest.fn().mockReturnValue({
            sort: jest.fn().mockRejectedValue(new Error('lookup failed')),
          }),
        },
        configurable: true,
      });

      await expect(runPreHooks(Certificate, certificate, { isNew: true })).rejects.toThrow(
        'lookup failed',
      );
    });
  });
});
