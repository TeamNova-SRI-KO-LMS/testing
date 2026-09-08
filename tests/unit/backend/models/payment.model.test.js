/**
 * Unit tests — models/Payment.js
 *
 * Requirements: FR-14 (Payment Processing & Invoicing), FR-21 (Revenue
 * Analytics).
 *
 * Money and audit trails: an invoice number that is not unique, or a paidDate
 * that disagrees with paymentDate, corrupts every revenue report downstream.
 * The aggregation statics need a live database and are covered in
 * tests/integration/persistence/payment-aggregations.test.js instead.
 */

'use strict';

const { requireFromSut } = require('@support/sut');
const { runPreHooks } = require('@support/mongoose-hooks');
const { testCase } = require('@support/test-case');
const { buildPayment } = require('@factories');

const Payment = requireFromSut('./models/Payment');
const mongoose = requireFromSut('mongoose');

const anObjectId = () => new mongoose.Types.ObjectId();

/** A payment whose `save()` is a no-op, so state changes stay in memory. */
function aPayment(overrides = {}) {
  const payment = new Payment({
    ...buildPayment(overrides),
    user: overrides.user || anObjectId(),
    subscription: overrides.subscription || anObjectId(),
  });
  payment.save = jest.fn().mockResolvedValue(payment);
  return payment;
}

describe('models/Payment', () => {
  describe('schema validation', () => {
    it('accepts a well-formed payment and applies its defaults', () => {
      const payment = aPayment({ status: undefined });

      expect(payment.validateSync()).toBeUndefined();
      expect(payment.status).toBe('pending');
      expect(payment.currency).toBe('LKR');
      expect(payment.paymentGateway).toBe('manual');
      expect(payment.refundAmount).toBe(0);
    });

    it.each(['user', 'subscription', 'amount', 'paymentMethod', 'plan', 'billingCycle'])(
      'rejects a payment with no %s',
      (field) => {
        const payment = aPayment();
        payment[field] = undefined;

        expect(payment.validateSync().errors[field]).toBeDefined();
      },
    );

    it('requires both ends of the billing period', () => {
      const payment = aPayment();
      payment.billingPeriod = { startDate: new Date() };

      expect(payment.validateSync().errors['billingPeriod.endDate']).toBeDefined();
    });

    it.each(['pending', 'processing', 'completed', 'failed', 'cancelled', 'refunded'])(
      'accepts the status "%s"',
      (status) => {
        expect(aPayment({ status }).validateSync()).toBeUndefined();
      },
    );

    it('rejects a payment method outside the enumeration', () => {
      expect(
        aPayment({ paymentMethod: 'crypto' }).validateSync().errors.paymentMethod,
      ).toBeDefined();
    });

    it('rejects a gateway outside the enumeration', () => {
      expect(
        aPayment({ paymentGateway: 'square' }).validateSync().errors.paymentGateway,
      ).toBeDefined();
    });

    testCase(
      {
        id: 'TC-FR-14-U01',
        name: 'Invoice and receipt numbers are protected by sparse unique indexes',
        requirement: 'FR-14',
        type: 'Unit',
        priority: 'P1',
        preconditions: 'None',
        input: 'Inspection of the Payment schema indexes',
        expected: 'Both invoiceNumber and receiptNumber carry a unique, sparse index',
      },
      () => {
        // Sparse matters as much as unique here: a pending payment has no
        // receipt number, and a plain unique index would reject the second such
        // document because both would hold null.
        const indexes = Payment.schema.indexes();
        for (const field of ['invoiceNumber', 'receiptNumber']) {
          const index = indexes.find(([fields]) => field in fields);
          expect(index).toBeDefined();
          expect(index[1]).toMatchObject({ unique: true, sparse: true });
        }
      },
    );
  });

  describe('markCompleted', () => {
    testCase(
      {
        id: 'TC-FR-14-U02',
        name: 'Completing a payment records the gateway reference and both timestamps',
        requirement: 'FR-14',
        type: 'Unit',
        priority: 'P1',
        preconditions: 'A pending payment',
        input: 'payment.markCompleted("txn_abc123", { code: "00" })',
        expected:
          'status "completed"; paidDate and paymentDate both set to now; gateway data stored',
      },
      async () => {
        jest.useFakeTimers().setSystemTime(new Date('2026-03-01T12:00:00.000Z'));
        const payment = aPayment({ status: 'pending', paymentDate: new Date('2026-01-01') });

        await payment.markCompleted('txn_abc123', { code: '00' });

        expect(payment.status).toBe('completed');
        expect(payment.paidDate).toEqual(new Date('2026-03-01T12:00:00.000Z'));
        // paymentDate is deliberately re-synced: the revenue aggregations group
        // on it, so leaving it at the creation date would attribute the money
        // to the wrong month.
        expect(payment.paymentDate).toEqual(payment.paidDate);
        expect(payment.gatewayTransactionId).toBe('txn_abc123');
        expect(payment.gatewayResponse).toEqual({ code: '00' });
        expect(payment.save).toHaveBeenCalledTimes(1);
      },
    );

    it('completes without a gateway response', async () => {
      const payment = aPayment({ status: 'pending' });

      await payment.markCompleted('txn_1');

      expect(payment.status).toBe('completed');
      expect(payment.gatewayResponse).toBeUndefined();
    });
  });

  describe('markFailed', () => {
    testCase(
      {
        id: 'TC-FR-14-U03',
        name: 'Failing a payment records the reason and leaves it unpaid',
        requirement: 'FR-14',
        type: 'Unit',
        priority: 'P1',
        preconditions: 'A pending payment',
        input: 'payment.markFailed("Card declined")',
        expected: 'status "failed"; failureReason stored; paidDate never set',
      },
      async () => {
        const payment = aPayment({ status: 'pending', paidDate: undefined });

        await payment.markFailed('Card declined');

        expect(payment.status).toBe('failed');
        expect(payment.failureReason).toBe('Card declined');
        expect(payment.paidDate).toBeUndefined();
        expect(payment.save).toHaveBeenCalledTimes(1);
      },
    );
  });

  describe('processRefund', () => {
    testCase(
      {
        id: 'TC-FR-14-U04',
        name: 'A partial refund records only the amount refunded',
        requirement: 'FR-14',
        type: 'Unit',
        priority: 'P1',
        preconditions: 'A completed payment of LKR 15 000',
        input: 'payment.processRefund(5000, "Partial refund on downgrade")',
        expected: 'status "refunded"; refundAmount 5000; refundDate stamped',
      },
      async () => {
        const payment = aPayment({ status: 'completed', amount: 15000 });

        await payment.processRefund(5000, 'Partial refund on downgrade');

        expect(payment.status).toBe('refunded');
        expect(payment.refundAmount).toBe(5000);
        expect(payment.refundReason).toBe('Partial refund on downgrade');
        expect(payment.refundDate).toBeRecentTimestamp();
      },
    );

    it('refunds the full amount when none is specified', async () => {
      const payment = aPayment({ status: 'completed', amount: 15000 });

      await payment.processRefund(undefined, 'Full refund');

      expect(payment.refundAmount).toBe(15000);
    });

    it('falls back to the full amount when the requested refund is zero', async () => {
      // `amount || this.amount` treats 0 as absent, so a zero-value refund
      // becomes a full one. Documented because it is surprising, and a
      // zero-refund request is more likely a bug in the caller than intent.
      const payment = aPayment({ status: 'completed', amount: 15000 });

      await payment.processRefund(0, 'Zero');

      expect(payment.refundAmount).toBe(15000);
    });
  });

  describe('invoice and receipt numbering', () => {
    testCase(
      {
        id: 'TC-FR-14-U05',
        name: 'A generated invoice number follows the INV-YYYYMM-NNNN format',
        requirement: 'FR-14',
        type: 'Unit',
        priority: 'P2',
        preconditions: 'System time is frozen at 1 March 2026',
        input: 'payment.generateInvoiceNumber()',
        expected: 'A value matching /^INV-202603-\\d{4}$/, also assigned to the document',
      },
      () => {
        jest.useFakeTimers().setSystemTime(new Date('2026-03-01T12:00:00.000Z'));
        const payment = aPayment();

        const invoiceNumber = payment.generateInvoiceNumber();

        expect(invoiceNumber).toMatch(/^INV-202603-\d{4}$/);
        expect(payment.invoiceNumber).toBe(invoiceNumber);
      },
    );

    it('zero-pads the month so ordering is lexicographic', () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-01-05T00:00:00.000Z'));

      expect(aPayment().generateInvoiceNumber()).toMatch(/^INV-202601-/);
    });

    it('formats a receipt number with the RCP prefix', () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-03-01T12:00:00.000Z'));

      expect(aPayment().generateReceiptNumber()).toMatch(/^RCP-202603-\d{4}$/);
    });

    testCase(
      {
        id: 'TC-FR-14-U06',
        name: 'A new payment is assigned an invoice number automatically',
        requirement: 'FR-14',
        type: 'Unit',
        priority: 'P1',
        preconditions: 'A new payment document with no invoice number',
        input: "The pre('save') hook runs with isNew true",
        expected: 'invoiceNumber is populated; receiptNumber stays empty for a pending payment',
      },
      async () => {
        const payment = aPayment({ status: 'pending' });
        payment.invoiceNumber = undefined;

        await runPreHooks(Payment, payment, { isNew: true });

        expect(payment.invoiceNumber).toMatch(/^INV-\d{6}-\d{4}$/);
        // A receipt is proof of money received; a pending payment has none.
        expect(payment.receiptNumber).toBeUndefined();
      },
    );

    it('assigns a receipt number when a payment is created already completed', async () => {
      const payment = aPayment({ status: 'completed' });
      payment.invoiceNumber = undefined;
      payment.receiptNumber = undefined;

      await runPreHooks(Payment, payment, { isNew: true });

      expect(payment.receiptNumber).toMatch(/^RCP-\d{6}-\d{4}$/);
    });

    it('does not overwrite an invoice number that already exists', async () => {
      const payment = aPayment();
      payment.invoiceNumber = 'INV-202601-0001';

      await runPreHooks(Payment, payment, { isNew: true });

      expect(payment.invoiceNumber).toBe('INV-202601-0001');
    });

    it('leaves an existing document untouched', async () => {
      const payment = aPayment();
      payment.invoiceNumber = undefined;

      await runPreHooks(Payment, payment, { isNew: false });

      expect(payment.invoiceNumber).toBeUndefined();
    });

    it('does not issue a receipt when an existing payment is completed later', async () => {
      // The hook is guarded by `isNew`, so a payment that starts pending and is
      // completed afterwards — the normal flow — never receives a receipt
      // number. See DEFECT-07 in docs/testing/DEFECT_REGISTER.md.
      const payment = aPayment({ status: 'completed' });
      payment.receiptNumber = undefined;

      await runPreHooks(Payment, payment, { isNew: false });

      expect(payment.receiptNumber).toBeUndefined();
    });

    it('derives the whole invoice suffix from Math.random, so two draws of the same value collide', () => {
      // Pins the current implementation: `INV-<YYYYMM>-<4 random digits>`.
      // Nothing else varies, so identical randomness inside one month yields
      // byte-identical invoice numbers. This is the mechanism behind DEFECT-08;
      // TC-FR-14-U07 below asserts the behaviour that should replace it.
      jest.useFakeTimers().setSystemTime(new Date('2026-03-01T12:00:00.000Z'));
      jest.spyOn(Math, 'random').mockReturnValue(0.4242);

      expect(aPayment().generateInvoiceNumber()).toBe('INV-202603-4242');
      expect(aPayment().generateInvoiceNumber()).toBe('INV-202603-4242');
    });

    testCase.failing(
      {
        id: 'TC-FR-14-U07',
        name: 'Two invoice numbers issued in the same month differ even when the RNG repeats',
        requirement: 'FR-14',
        type: 'Unit',
        priority: 'P1',
        preconditions:
          'System time is frozen inside a single month and Math.random is pinned to one value',
        input: 'Two invoice numbers generated back to back',
        expected: 'The two numbers are different',
        defect: 'DEFECT-08',
      },
      () => {
        // Uniqueness that rests on a 10 000-value random suffix is uniqueness
        // by luck: the birthday bound puts a collision above even odds after
        // ~118 invoices in one month, and `invoiceNumber` carries a unique
        // index, so the collision surfaces as a failed save for a customer who
        // has already been charged.
        //
        // Pinning Math.random makes that argument deterministic rather than
        // probabilistic — a test that reproduces a defect only most of the time
        // is a flaky test. A generator that does not stake correctness on the
        // RNG — a per-month counter, or an ObjectId-derived suffix — still
        // returns two distinct numbers here.
        jest.useFakeTimers().setSystemTime(new Date('2026-03-01T12:00:00.000Z'));
        jest.spyOn(Math, 'random').mockReturnValue(0.4242);

        const first = aPayment().generateInvoiceNumber();
        const second = aPayment().generateInvoiceNumber();

        expect(second).not.toBe(first);
      },
    );
  });

  describe('display virtuals', () => {
    it.each([
      ['pending', 'Pending'],
      ['processing', 'Processing'],
      ['completed', 'Completed'],
      ['failed', 'Failed'],
      ['cancelled', 'Cancelled'],
      ['refunded', 'Refunded'],
    ])('renders the status "%s" as "%s"', (status, expected) => {
      expect(aPayment({ status }).statusDisplay).toBe(expected);
    });

    it.each([
      ['credit_card', 'Credit Card'],
      ['bank_transfer', 'Bank Transfer'],
      ['digital_wallet', 'Digital Wallet'],
      ['cash', 'Cash'],
      ['cheque', 'Cheque'],
    ])('renders the method "%s" as "%s"', (paymentMethod, expected) => {
      expect(aPayment({ paymentMethod }).paymentMethodDisplay).toBe(expected);
    });

    it('falls back to the raw value for a status the map does not know', () => {
      // The enum makes this unreachable through normal writes, but a document
      // loaded from a database written by an older schema version can hold a
      // retired value. The virtual must render *something* rather than
      // `undefined`, which the admin table would show as a blank cell.
      const payment = aPayment();
      payment.$set('status', 'chargeback', { strict: false });

      expect(payment.statusDisplay).toBe('chargeback');
    });

    it('falls back to the raw value for a payment method the map does not know', () => {
      const payment = aPayment();
      payment.$set('paymentMethod', 'crypto', { strict: false });

      expect(payment.paymentMethodDisplay).toBe('crypto');
    });
  });
});
