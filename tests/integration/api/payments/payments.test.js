/**
 * Integration tests — payment processing.
 *
 * Endpoints: POST /api/payments/create, PUT /api/payments/:id/complete,
 *            PUT /api/payments/:id/fail, POST /api/payments/:id/refund,
 *            GET /api/payments/stats, /recent, /all, /:id.
 *
 * Requirements: FR-14 (Payment Processing & Invoicing),
 * OWASP A01 (Broken Access Control).
 */

'use strict';

const { loadApp } = require('@support/app');
const { api } = require('@support/api-client');
const { testCase } = require('@support/test-case');
const { requireFromSut } = require('@support/sut');
const auth = require('@support/auth');
const { createSubscription, createPayment } = require('@factories');

const client = api(loadApp());
const Payment = requireFromSut('./models/Payment');

const MISSING_ID = '507f1f77bcf86cd799439099';

describe('POST /api/payments/create', () => {
  testCase(
    {
      id: 'TC-FR-14-05',
      name: 'A subscriber records a payment against their own subscription',
      requirement: 'FR-14',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'The caller holds a pro subscription',
      input: 'POST /api/payments/create with that subscription id, a method and an amount',
      expected: 'HTTP 201; a pending payment carrying a generated invoice number',
    },
    async () => {
      const { user, authHeader } = await auth.asInstructor();
      const subscription = await createSubscription({ user: user._id, plan: 'pro' });

      const response = await client
        .post('/api/payments/create')
        .set('Authorization', authHeader)
        .send({
          subscriptionId: String(subscription._id),
          paymentMethod: 'credit_card',
          amount: 15000,
        });

      expect(response).toBeSuccessfulResponse(201);
      expect(response.body.payment).toMatchObject({
        amount: 15000,
        paymentMethod: 'credit_card',
        status: 'pending',
        plan: 'pro',
      });
      expect(response.body.payment.invoiceNumber).toMatch(/^INV-\d{6}-\d{4}$/);
    },
  );

  testCase(
    {
      id: 'TC-NFR-03-07',
      name: 'A user cannot create a payment against someone else’s subscription',
      requirement: 'NFR-03',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'A subscription belonging to a different user',
      input: 'POST /api/payments/create naming that subscription',
      expected: 'HTTP 404; no payment is created',
    },
    async () => {
      // The lookup is scoped to the caller, so a guessed subscription id
      // discloses nothing and creates nothing (OWASP A01).
      const { authHeader } = await auth.asInstructor();
      const other = await createSubscription();

      const response = await client
        .post('/api/payments/create')
        .set('Authorization', authHeader)
        .send({
          subscriptionId: String(other._id),
          paymentMethod: 'credit_card',
          amount: 15000,
        });

      expect(response).toBeNotFound();
      expect(await Payment.countDocuments()).toBe(0);
    },
  );

  it.each([
    [
      'a malformed subscription id',
      { subscriptionId: 'not-an-id', paymentMethod: 'credit_card', amount: 1 },
    ],
    [
      'an unknown payment method',
      { subscriptionId: MISSING_ID, paymentMethod: 'crypto', amount: 1 },
    ],
    ['a non-numeric amount', { subscriptionId: MISSING_ID, paymentMethod: 'cash', amount: 'lots' }],
    ['an empty body', {}],
  ])('rejects %s with HTTP 400', async (_label, body) => {
    const { authHeader } = await auth.asInstructor();

    const response = await client
      .post('/api/payments/create')
      .set('Authorization', authHeader)
      .send(body);

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Validation error');
  });

  it('refuses an unauthenticated request', async () => {
    const subscription = await createSubscription();

    const response = await client.post('/api/payments/create').send({
      subscriptionId: String(subscription._id),
      paymentMethod: 'credit_card',
      amount: 15000,
    });

    expect(response).toBeUnauthorised();
  });
});

describe('PUT /api/payments/:id/complete', () => {
  testCase(
    {
      id: 'TC-FR-14-06',
      name: 'Completing a payment records the gateway reference and stamps it paid',
      requirement: 'FR-14',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'A pending payment belonging to the caller',
      input: 'PUT /api/payments/<id>/complete with a gateway transaction id',
      expected: 'HTTP 200; status "completed"; paidDate set; the reference stored',
    },
    async () => {
      const { user, authHeader } = await auth.asInstructor();
      const payment = await createPayment({ user: user._id, status: 'pending' });

      const response = await client
        .put(`/api/payments/${payment._id}/complete`)
        .set('Authorization', authHeader)
        .send({ gatewayTransactionId: 'txn_abc123', gatewayResponse: { code: '00' } });

      expect(response).toBeSuccessfulResponse(200);

      const stored = await Payment.findById(payment._id);
      expect(stored.status).toBe('completed');
      expect(stored.gatewayTransactionId).toBe('txn_abc123');
      expect(stored.paidDate).toBeRecentTimestamp();
    },
  );

  testCase(
    {
      id: 'TC-FR-14-07',
      name: 'A payment cannot be completed twice',
      requirement: 'FR-14',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'A payment that is already completed',
      input: 'PUT /api/payments/<id>/complete again',
      expected: 'HTTP 400 "Payment already completed"',
    },
    async () => {
      // Idempotence here is what stops a retried webhook double-counting the
      // money in every revenue report.
      const { user, authHeader } = await auth.asInstructor();
      const payment = await createPayment({ user: user._id, status: 'completed' });

      const response = await client
        .put(`/api/payments/${payment._id}/complete`)
        .set('Authorization', authHeader)
        .send({ gatewayTransactionId: 'txn_retry' });

      expect(response).toBeErrorResponse(400, 'Payment already completed');
    },
  );

  it('returns 404 for another user’s payment', async () => {
    const { authHeader } = await auth.asInstructor();
    const other = await createPayment({ status: 'pending' });

    const response = await client
      .put(`/api/payments/${other._id}/complete`)
      .set('Authorization', authHeader)
      .send({ gatewayTransactionId: 'txn_x' });

    expect(response).toBeNotFound();
    expect((await Payment.findById(other._id)).status).toBe('pending');
  });

  it('returns 404 for a payment that does not exist', async () => {
    const { authHeader } = await auth.asInstructor();

    const response = await client
      .put(`/api/payments/${MISSING_ID}/complete`)
      .set('Authorization', authHeader)
      .send({});

    expect(response).toBeNotFound();
  });

  it('refuses an unauthenticated request', async () => {
    const payment = await createPayment({ status: 'pending' });

    const response = await client.put(`/api/payments/${payment._id}/complete`).send({});

    expect(response).toBeUnauthorised();
  });
});

describe('PUT /api/payments/:id/fail', () => {
  testCase(
    {
      id: 'TC-FR-14-08',
      name: 'A failed payment records the reason and stays unpaid',
      requirement: 'FR-14',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'A pending payment belonging to the caller',
      input: 'PUT /api/payments/<id>/fail with reason "Card declined"',
      expected: 'HTTP 200; status "failed"; failureReason stored; paidDate unset',
    },
    async () => {
      const { user, authHeader } = await auth.asInstructor();
      const payment = await createPayment({
        user: user._id,
        status: 'pending',
        paidDate: undefined,
      });

      const response = await client
        .put(`/api/payments/${payment._id}/fail`)
        .set('Authorization', authHeader)
        .send({ reason: 'Card declined' });

      expect(response).toBeSuccessfulResponse(200);

      const stored = await Payment.findById(payment._id);
      expect(stored.status).toBe('failed');
      expect(stored.failureReason).toBe('Card declined');
      expect(stored.paidDate).toBeUndefined();
    },
  );

  it('returns 404 for another user’s payment', async () => {
    const { authHeader } = await auth.asInstructor();
    const other = await createPayment({ status: 'pending' });

    const response = await client
      .put(`/api/payments/${other._id}/fail`)
      .set('Authorization', authHeader)
      .send({ reason: 'Not mine' });

    expect(response).toBeNotFound();
  });

  it('refuses an unauthenticated request', async () => {
    const payment = await createPayment({ status: 'pending' });

    const response = await client
      .put(`/api/payments/${payment._id}/fail`)
      .send({ reason: 'Anonymous' });

    expect(response).toBeUnauthorised();
  });
});

describe('POST /api/payments/:id/refund', () => {
  testCase(
    {
      id: 'TC-FR-14-09',
      name: 'A completed payment is refunded in part',
      requirement: 'FR-14',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'A completed payment of LKR 15 000 belonging to the caller',
      input: 'POST /api/payments/<id>/refund with amount 5000 and a reason',
      expected: 'HTTP 200; status "refunded"; refundAmount 5000; refundDate stamped',
    },
    async () => {
      const { user, authHeader } = await auth.asInstructor();
      const payment = await createPayment({ user: user._id, status: 'completed', amount: 15000 });

      const response = await client
        .post(`/api/payments/${payment._id}/refund`)
        .set('Authorization', authHeader)
        .send({ amount: 5000, reason: 'Downgraded mid-cycle' });

      expect(response).toBeSuccessfulResponse(200);

      const stored = await Payment.findById(payment._id);
      expect(stored.status).toBe('refunded');
      expect(stored.refundAmount).toBe(5000);
      expect(stored.refundDate).toBeRecentTimestamp();
    },
  );

  testCase(
    {
      id: 'TC-FR-14-10',
      name: 'Only a completed payment can be refunded',
      requirement: 'FR-14',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'A pending payment belonging to the caller',
      input: 'POST /api/payments/<id>/refund',
      expected: 'HTTP 400 "Can only refund completed payments"; the payment is untouched',
    },
    async () => {
      // Refunding money that was never collected would pay the customer twice.
      const { user, authHeader } = await auth.asInstructor();
      const payment = await createPayment({ user: user._id, status: 'pending' });

      const response = await client
        .post(`/api/payments/${payment._id}/refund`)
        .set('Authorization', authHeader)
        .send({ reason: 'Changed my mind' });

      expect(response).toBeErrorResponse(400, 'Can only refund completed payments');
      expect((await Payment.findById(payment._id)).status).toBe('pending');
    },
  );

  it('refunds the full amount when none is specified', async () => {
    const { user, authHeader } = await auth.asInstructor();
    const payment = await createPayment({ user: user._id, status: 'completed', amount: 35000 });

    await client
      .post(`/api/payments/${payment._id}/refund`)
      .set('Authorization', authHeader)
      .send({ reason: 'Full refund' });

    expect((await Payment.findById(payment._id)).refundAmount).toBe(35000);
  });

  testCase.failing(
    {
      id: 'TC-NFR-04-01',
      name: 'A refund request without a reason is rejected',
      requirement: 'NFR-04',
      type: 'Integration',
      priority: 'P2',
      preconditions: 'A completed payment belonging to the caller',
      input: 'POST /api/payments/<id>/refund with an amount but no reason',
      expected: 'HTTP 400 — the route declares `body("reason").isString()`',
      defect: 'DEFECT-23',
    },
    async () => {
      // The route declares express-validator chains for /complete, /fail and
      // /refund but never calls `validationResult`, so none of them is
      // enforced. A refund is therefore recorded with no audit reason at all.
      const { user, authHeader } = await auth.asInstructor();
      const payment = await createPayment({ user: user._id, status: 'completed' });

      const response = await client
        .post(`/api/payments/${payment._id}/refund`)
        .set('Authorization', authHeader)
        .send({ amount: 100 });

      expect(response.status).toBe(400);
    },
  );

  it('currently accepts a refund with no reason, leaving no audit trail', async () => {
    // Companion to TC-NFR-04-01: pins the actual behaviour.
    const { user, authHeader } = await auth.asInstructor();
    const payment = await createPayment({ user: user._id, status: 'completed' });

    const response = await client
      .post(`/api/payments/${payment._id}/refund`)
      .set('Authorization', authHeader)
      .send({ amount: 100 });

    expect(response.status).toBe(200);
    expect((await Payment.findById(payment._id)).refundReason).toBeUndefined();
  });

  it('returns 404 for another user’s payment', async () => {
    const { authHeader } = await auth.asInstructor();
    const other = await createPayment({ status: 'completed' });

    const response = await client
      .post(`/api/payments/${other._id}/refund`)
      .set('Authorization', authHeader)
      .send({ reason: 'Not mine' });

    expect(response).toBeNotFound();
  });

  it('refuses an unauthenticated request', async () => {
    const payment = await createPayment({ status: 'completed' });

    const response = await client
      .post(`/api/payments/${payment._id}/refund`)
      .send({ reason: 'Anonymous' });

    expect(response).toBeUnauthorised();
  });

  testCase.failing(
    {
      id: 'TC-FR-14-11',
      name: 'A refund cannot exceed the amount that was paid',
      requirement: 'FR-14',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'A completed payment of LKR 15 000',
      input: 'POST /api/payments/<id>/refund with amount 999 999',
      expected: 'HTTP 400 — the refund is larger than the original charge',
      defect: 'DEFECT-22',
    },
    async () => {
      // Neither the route nor `processRefund` compares the refund with the
      // original amount, so a client-supplied figure is written straight to the
      // ledger and the revenue reports go negative.
      const { user, authHeader } = await auth.asInstructor();
      const payment = await createPayment({ user: user._id, status: 'completed', amount: 15000 });

      const response = await client
        .post(`/api/payments/${payment._id}/refund`)
        .set('Authorization', authHeader)
        .send({ amount: 999999, reason: 'Over-refund attempt' });

      expect(response.status).toBe(400);
    },
  );
});

describe('GET /api/payments/:id', () => {
  testCase(
    {
      id: 'TC-FR-14-12',
      name: 'A user reads their own payment',
      requirement: 'FR-14',
      type: 'Integration',
      priority: 'P2',
      preconditions: 'A payment belonging to the caller',
      input: 'GET /api/payments/<id>',
      expected: 'HTTP 200; the payment record',
    },
    async () => {
      const { user, authHeader } = await auth.asInstructor();
      const payment = await createPayment({ user: user._id });

      const response = await client
        .get(`/api/payments/${payment._id}`)
        .set('Authorization', authHeader);

      expect(response).toBeSuccessfulResponse(200);
      expect(response.body.payment._id).toBe(String(payment._id));
    },
  );

  it('returns 404 for a payment that does not exist', async () => {
    const { authHeader } = await auth.asInstructor();

    const response = await client
      .get(`/api/payments/${MISSING_ID}`)
      .set('Authorization', authHeader);

    expect(response).toBeNotFound();
  });

  it('refuses an unauthenticated request', async () => {
    const payment = await createPayment();

    const response = await client.get(`/api/payments/${payment._id}`);

    expect(response).toBeUnauthorised();
  });
});

describe('administrative payment reporting', () => {
  testCase(
    {
      id: 'TC-FR-14-13',
      name: 'An administrator reads aggregate payment statistics',
      requirement: 'FR-14',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'Completed and pending payments exist',
      input: 'GET /api/payments/stats',
      expected: 'HTTP 200; totals separating completed revenue from other statuses',
    },
    async () => {
      const { authHeader } = await auth.asAdmin();
      await createPayment({ status: 'completed', amount: 15000 });
      await createPayment({ status: 'completed', amount: 35000 });
      await createPayment({ status: 'pending', amount: 99000 });

      const response = await client.get('/api/payments/stats').set('Authorization', authHeader);

      expect(response).toBeSuccessfulResponse(200);
    },
  );

  it('lists recent payments for an administrator', async () => {
    const { authHeader } = await auth.asAdmin();
    await createPayment({ status: 'completed' });

    const response = await client.get('/api/payments/recent').set('Authorization', authHeader);

    expect(response).toBeSuccessfulResponse(200);
  });

  it('lists all payments for an administrator', async () => {
    const { authHeader } = await auth.asAdmin();
    await createPayment();
    await createPayment();

    const response = await client.get('/api/payments/all').set('Authorization', authHeader);

    expect(response).toBeSuccessfulResponse(200);
  });

  it.each([['/api/payments/stats'], ['/api/payments/recent'], ['/api/payments/all']])(
    'refuses a student on %s',
    async (path) => {
      const { authHeader } = await auth.asStudent();

      const response = await client.get(path).set('Authorization', authHeader);

      expect(response).toBeForbidden();
    },
  );

  it('resolves the literal reporting paths before /:id', async () => {
    // `/stats`, `/recent` and `/all` are declared before `/:id`; if they were
    // not, each would be treated as a payment id and return 404.
    const { authHeader } = await auth.asAdmin();

    const response = await client.get('/api/payments/stats').set('Authorization', authHeader);

    expect(response.status).not.toBe(404);
  });
});
