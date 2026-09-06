/**
 * Integration tests — model statics that run aggregation pipelines.
 *
 * Requirements: FR-14 (Billing), FR-21 (Analytics & Reporting).
 *
 * These are the queries behind the revenue dashboard. They cannot be unit
 * tested: `$group`, `$match` and `$lookup` are executed by MongoDB, so a mock
 * would only prove that the pipeline object was constructed, not that it
 * computes the right number. Money reporting deserves the real engine.
 */

'use strict';

const { requireFromSut } = require('@support/sut');
const { testCase } = require('@support/test-case');
const { createPayment, createCertificate, createCourse } = require('@factories');

const Payment = requireFromSut('./models/Payment');
const Certificate = requireFromSut('./models/Certificate');

const DAY_MS = 24 * 60 * 60 * 1000;

describe('Payment.getPaymentStats', () => {
  testCase(
    {
      id: 'TC-FR-21-05',
      name: 'Payment statistics separate completed revenue from other statuses',
      requirement: 'FR-21',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'Two completed, one pending, one failed and one refunded payment exist',
      input: 'Payment.getPaymentStats()',
      expected: 'total 5; completed 2 with completedAmount 50 000; pending 1; failed 1; refunded 1',
    },
    async () => {
      await createPayment({ status: 'completed', amount: 15000 });
      await createPayment({ status: 'completed', amount: 35000 });
      await createPayment({ status: 'pending', amount: 99000 });
      await createPayment({ status: 'failed', amount: 77000 });
      await createPayment({ status: 'refunded', amount: 15000 });

      const stats = await Payment.getPaymentStats();

      expect(stats.total).toBe(5);
      expect(stats.completed).toBe(2);
      // Only completed money is real money.
      expect(stats.completedAmount).toBe(50000);
      expect(stats.pending).toBe(1);
      expect(stats.failed).toBe(1);
      expect(stats.refunded).toBe(1);
    },
  );

  it('returns zeroes rather than failing on an empty ledger', async () => {
    const stats = await Payment.getPaymentStats();

    expect(stats).toMatchObject({
      total: 0,
      completed: 0,
      pending: 0,
      failed: 0,
      refunded: 0,
      totalAmount: 0,
      completedAmount: 0,
    });
  });

  testCase(
    {
      id: 'TC-FR-21-06',
      name: 'Payment statistics honour a date range',
      requirement: 'FR-21',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'One payment paid today and one paid sixty days ago',
      input: 'Payment.getPaymentStats(<30 days ago>, <now>)',
      expected: 'Only the recent payment is counted',
    },
    async () => {
      await createPayment({ status: 'completed', amount: 15000, paidDate: new Date() });
      await createPayment({
        status: 'completed',
        amount: 35000,
        paidDate: new Date(Date.now() - 60 * DAY_MS),
      });

      const stats = await Payment.getPaymentStats(
        new Date(Date.now() - 30 * DAY_MS),
        new Date(Date.now() + DAY_MS),
      );

      expect(stats.total).toBe(1);
      expect(stats.completedAmount).toBe(15000);
    },
  );

  it('filters on paidDate, not on when the record was created', async () => {
    // A payment created today but marked as paid last year belongs to last
    // year's revenue; grouping on createdAt would silently move it.
    await createPayment({
      status: 'completed',
      amount: 15000,
      paidDate: new Date(Date.now() - 400 * DAY_MS),
    });

    const stats = await Payment.getPaymentStats(
      new Date(Date.now() - 30 * DAY_MS),
      new Date(Date.now() + DAY_MS),
    );

    expect(stats.total).toBe(0);
  });
});

describe('Payment.getRevenueByPlan', () => {
  testCase(
    {
      id: 'TC-FR-21-07',
      name: 'Revenue is broken down by plan, highest first',
      requirement: 'FR-21',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'Two completed pro payments and one completed premium payment',
      input: 'Payment.getRevenueByPlan()',
      expected: 'Premium 35 000 first, then pro 30 000 across 2 payments with a 15 000 average',
    },
    async () => {
      await createPayment({ status: 'completed', plan: 'pro', amount: 15000 });
      await createPayment({ status: 'completed', plan: 'pro', amount: 15000 });
      await createPayment({ status: 'completed', plan: 'premium', amount: 35000 });

      const revenue = await Payment.getRevenueByPlan();

      expect(revenue).toHaveLength(2);
      expect(revenue[0]).toMatchObject({ _id: 'premium', totalAmount: 35000, count: 1 });
      expect(revenue[1]).toMatchObject({
        _id: 'pro',
        totalAmount: 30000,
        count: 2,
        averageAmount: 15000,
      });
    },
  );

  it('excludes payments that were never completed', async () => {
    await createPayment({ status: 'pending', plan: 'premium', amount: 350000 });
    await createPayment({ status: 'completed', plan: 'pro', amount: 15000 });

    const revenue = await Payment.getRevenueByPlan();

    expect(revenue).toHaveLength(1);
    expect(revenue[0]._id).toBe('pro');
  });

  it('returns an empty breakdown on an empty ledger', async () => {
    expect(await Payment.getRevenueByPlan()).toEqual([]);
  });

  testCase(
    {
      id: 'TC-FR-21-10',
      name: 'Revenue by plan honours a date range',
      requirement: 'FR-21',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'One payment inside the range and one sixty days before it',
      input: 'Payment.getRevenueByPlan(<30 days ago>, <now>)',
      expected: 'Only the payment inside the range contributes to the breakdown',
    },
    async () => {
      // The quarterly revenue report is exactly this call with a date range;
      // an unfiltered result would report the whole ledger as one quarter.
      await createPayment({
        status: 'completed',
        plan: 'pro',
        amount: 15000,
        paidDate: new Date(),
      });
      await createPayment({
        status: 'completed',
        plan: 'premium',
        amount: 35000,
        paidDate: new Date(Date.now() - 60 * DAY_MS),
      });

      const revenue = await Payment.getRevenueByPlan(
        new Date(Date.now() - 30 * DAY_MS),
        new Date(Date.now() + DAY_MS),
      );

      expect(revenue).toHaveLength(1);
      expect(revenue[0]).toMatchObject({ _id: 'pro', totalAmount: 15000 });
    },
  );

  it('ignores a partial date range, treating it as no filter at all', async () => {
    // The static requires *both* bounds; supplying one silently widens the
    // report to the whole ledger, which is worth pinning so the behaviour is
    // a documented choice rather than a surprise.
    await createPayment({ status: 'completed', plan: 'pro', amount: 15000 });

    const withOnlyStart = await Payment.getRevenueByPlan(new Date(Date.now() - DAY_MS));

    expect(withOnlyStart).toHaveLength(1);
  });
});

describe('Payment.getMonthlyRevenue', () => {
  testCase(
    {
      id: 'TC-FR-21-08',
      name: 'Monthly revenue groups completed payments by calendar month',
      requirement: 'FR-21',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'Two payments paid in March 2026 and one in April 2026',
      input: 'Payment.getMonthlyRevenue(2026)',
      expected: 'Two rows in month order: March 50 000 across 2, April 15 000 across 1',
    },
    async () => {
      await createPayment({
        status: 'completed',
        amount: 15000,
        paidDate: new Date('2026-03-05T00:00:00.000Z'),
      });
      await createPayment({
        status: 'completed',
        amount: 35000,
        paidDate: new Date('2026-03-20T00:00:00.000Z'),
      });
      await createPayment({
        status: 'completed',
        amount: 15000,
        paidDate: new Date('2026-04-02T00:00:00.000Z'),
      });

      const monthly = await Payment.getMonthlyRevenue(2026);

      expect(monthly).toHaveLength(2);
      expect(monthly[0]).toMatchObject({
        _id: { month: 3, year: 2026 },
        totalAmount: 50000,
        count: 2,
      });
      expect(monthly[1]).toMatchObject({
        _id: { month: 4, year: 2026 },
        totalAmount: 15000,
        count: 1,
      });
    },
  );

  it('excludes payments from a different year', async () => {
    await createPayment({
      status: 'completed',
      amount: 15000,
      paidDate: new Date('2025-06-01T00:00:00.000Z'),
    });

    expect(await Payment.getMonthlyRevenue(2026)).toEqual([]);
  });

  testCase.failing(
    {
      id: 'TC-FR-21-09',
      name: 'A December payment is included in its own year',
      requirement: 'FR-21',
      type: 'Integration',
      priority: 'P2',
      preconditions: 'A payment paid on 31 December 2026',
      input: 'Payment.getMonthlyRevenue(2026)',
      expected: 'The payment SHOULD appear under month 12',
      defect: 'DEFECT-28',
    },
    async () => {
      // The static builds its range as `new Date(year, 11, 31)`, which is
      // midnight at the *start* of 31 December. Anything paid during that day
      // falls outside the range and vanishes from the annual report. The upper
      // bound should be the start of 1 January of the following year.
      await createPayment({
        status: 'completed',
        amount: 15000,
        paidDate: new Date(2026, 11, 31, 14, 0, 0),
      });

      const monthly = await Payment.getMonthlyRevenue(2026);

      expect(monthly.some((row) => row._id.month === 12)).toBe(true);
    },
  );
});

describe('Certificate.getCertificateStats', () => {
  testCase(
    {
      id: 'TC-FR-15-12',
      name: 'Certificate statistics count each status and group by course',
      requirement: 'FR-15',
      type: 'Integration',
      priority: 'P2',
      preconditions: 'Certificates exist across the pending, issued and sent statuses',
      input: 'Certificate.getCertificateStats()',
      expected: 'total 3 with one in each status, plus a per-course breakdown',
    },
    async () => {
      const course = await createCourse();
      await createCertificate({ course: course._id, status: 'pending' });
      await createCertificate({ course: course._id, status: 'issued' });
      await createCertificate({ status: 'sent' });

      const stats = await Certificate.getCertificateStats();

      expect(stats.total).toBe(3);
      expect(stats.pending).toBe(1);
      expect(stats.issued).toBe(1);
      expect(stats.sent).toBe(1);
      expect(stats.delivered).toBe(0);

      const forCourse = stats.courseStats.find((entry) => String(entry._id) === String(course._id));
      expect(forCourse.count).toBe(2);
      expect(forCourse.courseName).toBe(course.title);
    },
  );

  it('returns zeroes on an empty register', async () => {
    const stats = await Certificate.getCertificateStats();

    expect(stats.total).toBe(0);
    expect(stats.courseStats).toEqual([]);
  });
});

describe('Certificate.getAllCertificates', () => {
  testCase(
    {
      id: 'TC-FR-15-13',
      name: 'The certificate register paginates and filters by status',
      requirement: 'FR-15',
      type: 'Integration',
      priority: 'P2',
      preconditions: 'Three certificates exist, two of them issued',
      input: 'Certificate.getAllCertificates(1, 10, { status: "issued" })',
      expected: 'Both issued certificates are returned with pagination metadata',
    },
    async () => {
      await createCertificate({ status: 'issued' });
      await createCertificate({ status: 'issued' });
      await createCertificate({ status: 'pending' });

      const result = await Certificate.getAllCertificates(1, 10, { status: 'issued' });

      expect(result.certificates).toHaveLength(2);
      expect(result.pagination).toMatchObject({ current: 1, pages: 1, total: 2 });
    },
  );

  it('splits a long register across pages', async () => {
    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await createCertificate();
    }

    const page = await Certificate.getAllCertificates(2, 2);

    expect(page.certificates).toHaveLength(2);
    expect(page.pagination).toMatchObject({ current: 2, pages: 3, total: 5 });
  });
});
