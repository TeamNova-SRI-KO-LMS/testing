/**
 * Integration tests — subscription lifecycle.
 *
 * Endpoints: GET /api/subscriptions/plans, /current, /usage, /payments,
 *            /invoice/:id; POST /api/subscriptions/create;
 *            PUT /api/subscriptions/upgrade, /cancel.
 *
 * Requirements: FR-13 (Subscription Management), FR-14 (Billing).
 */

'use strict';

const { loadApp } = require('@support/app');
const { api } = require('@support/api-client');
const { testCase } = require('@support/test-case');
const { requireFromSut } = require('@support/sut');
const auth = require('@support/auth');
const { createSubscription, createPayment } = require('@factories');

const client = api(loadApp());
const Subscription = requireFromSut('./models/Subscription');
const Payment = requireFromSut('./models/Payment');

const MISSING_ID = '507f1f77bcf86cd799439099';

describe('GET /api/subscriptions/plans', () => {
  testCase(
    {
      id: 'TC-FR-13-01',
      name: 'The pricing page reads the three plans without authentication',
      requirement: 'FR-13',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'None',
      input: 'GET /api/subscriptions/plans with no Authorization header',
      expected: 'HTTP 200; starter, pro and premium, each with features and monthly/yearly pricing',
    },
    async () => {
      const response = await client.get('/api/subscriptions/plans');

      expect(response).toBeSuccessfulResponse(200);
      expect(response.body.data.map((plan) => plan.name)).toEqual(['starter', 'pro', 'premium']);

      for (const plan of response.body.data) {
        expect(plan).toHaveProperty('displayName');
        expect(plan).toHaveProperty('description');
        expect(plan.features).toHaveProperty('maxCourses');
        expect(plan.pricing).toHaveProperty('monthly');
        expect(plan.pricing).toHaveProperty('yearly');
      }
    },
  );

  it('publishes the documented prices in LKR', async () => {
    const response = await client.get('/api/subscriptions/plans');

    const byName = Object.fromEntries(response.body.data.map((plan) => [plan.name, plan]));
    expect(byName.starter.pricing.monthly).toBe(0);
    expect(byName.pro.pricing.monthly).toBe(15000);
    expect(byName.premium.pricing.yearly).toBe(350000);
  });
});

describe('POST /api/subscriptions/create', () => {
  testCase(
    {
      id: 'TC-FR-13-02',
      name: 'A user starts a 14-day trial on the pro plan',
      requirement: 'FR-13',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'An authenticated user with no active subscription',
      input: 'POST /api/subscriptions/create with plan "pro" and billingCycle "monthly"',
      expected:
        'HTTP 201; status "trial"; trialEndDate 14 days out; a pending payment for LKR 15 000',
    },
    async () => {
      const { user, authHeader } = await auth.asInstructor();

      const response = await client
        .post('/api/subscriptions/create')
        .set('Authorization', authHeader)
        .send({ plan: 'pro', billingCycle: 'monthly' });

      expect(response).toBeSuccessfulResponse(201);
      expect(response.body.message).toBe('Trial started successfully');
      expect(response.body.subscription).toMatchObject({ plan: 'pro', status: 'trial' });

      const stored = await Subscription.findOne({ user: user._id });
      expect(stored.amount).toBe(15000);
      const daysUntilTrialEnd = (stored.trialEndDate - Date.now()) / (24 * 60 * 60 * 1000);
      expect(daysUntilTrialEnd).toBeGreaterThan(13.9);
      expect(daysUntilTrialEnd).toBeLessThan(14.1);

      // A paid plan schedules the first invoice up front, so billing has
      // something to collect when the trial ends.
      const payment = await Payment.findOne({ subscription: stored._id });
      expect(payment).not.toBeNull();
      expect(payment.status).toBe('pending');
      expect(payment.amount).toBe(15000);
    },
  );

  testCase(
    {
      id: 'TC-FR-13-03',
      name: 'The free starter plan activates immediately with no payment record',
      requirement: 'FR-13',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'An authenticated user with no active subscription',
      input: 'POST /api/subscriptions/create with plan "starter"',
      expected: 'HTTP 201; status "active"; amount 0; autoRenew false; no Payment created',
    },
    async () => {
      const { user, authHeader } = await auth.asInstructor();

      const response = await client
        .post('/api/subscriptions/create')
        .set('Authorization', authHeader)
        .send({ plan: 'starter', billingCycle: 'monthly' });

      expect(response).toBeSuccessfulResponse(201);
      expect(response.body.message).toBe('Starter plan activated successfully');

      const stored = await Subscription.findOne({ user: user._id });
      expect(stored.status).toBe('active');
      expect(stored.amount).toBe(0);
      expect(stored.autoRenew).toBe(false);
      // Creating a zero-value invoice would pollute the revenue reports.
      expect(await Payment.countDocuments({ subscription: stored._id })).toBe(0);
    },
  );

  testCase(
    {
      id: 'TC-FR-13-04',
      name: 'A user cannot hold two active subscriptions at once',
      requirement: 'FR-13',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'The user already has an active subscription',
      input: 'POST /api/subscriptions/create a second time',
      expected: 'HTTP 400 "User already has an active subscription"; still one subscription',
    },
    async () => {
      const { user, authHeader } = await auth.asInstructor();
      await createSubscription({ user: user._id, status: 'active' });

      const response = await client
        .post('/api/subscriptions/create')
        .set('Authorization', authHeader)
        .send({ plan: 'premium', billingCycle: 'yearly' });

      expect(response).toBeErrorResponse(400, 'User already has an active subscription');
      expect(await Subscription.countDocuments({ user: user._id })).toBe(1);
    },
  );

  it.each([
    ['an unknown plan', { plan: 'enterprise', billingCycle: 'monthly' }],
    ['an unknown billing cycle', { plan: 'pro', billingCycle: 'weekly' }],
    ['a missing plan', { billingCycle: 'monthly' }],
    ['an empty body', {}],
  ])('rejects %s with HTTP 400', async (_label, body) => {
    const { authHeader } = await auth.asInstructor();

    const response = await client
      .post('/api/subscriptions/create')
      .set('Authorization', authHeader)
      .send(body);

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Validation error');
  });

  it('refuses an unauthenticated request', async () => {
    const response = await client
      .post('/api/subscriptions/create')
      .send({ plan: 'pro', billingCycle: 'monthly' });

    expect(response).toBeUnauthorised();
  });
});

describe('GET /api/subscriptions/current', () => {
  testCase(
    {
      id: 'TC-FR-13-05',
      name: 'A subscriber reads their own current subscription',
      requirement: 'FR-13',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'The user has an active pro subscription',
      input: 'GET /api/subscriptions/current',
      expected: 'HTTP 200; the caller’s own subscription',
    },
    async () => {
      const { user, authHeader } = await auth.asInstructor();
      await createSubscription({ user: user._id, plan: 'pro', status: 'active' });

      const response = await client
        .get('/api/subscriptions/current')
        .set('Authorization', authHeader);

      expect(response).toBeSuccessfulResponse(200);
      expect(response.body.subscription.plan).toBe('pro');
    },
  );

  it('reports null rather than 404 when there is no subscription', async () => {
    // The pricing page needs to distinguish "no subscription" from an error, so
    // this deliberately succeeds with a null payload.
    const { authHeader } = await auth.asInstructor();

    const response = await client
      .get('/api/subscriptions/current')
      .set('Authorization', authHeader);

    expect(response).toBeSuccessfulResponse(200);
    expect(response.body.subscription).toBeNull();
    expect(response.body.message).toBe('No active subscription found');
  });

  it('does not return another user’s subscription', async () => {
    const { authHeader } = await auth.asInstructor();
    await createSubscription({ status: 'active' }); // belongs to somebody else

    const response = await client
      .get('/api/subscriptions/current')
      .set('Authorization', authHeader);

    expect(response.body.subscription).toBeNull();
  });

  it('ignores a cancelled subscription', async () => {
    const { user, authHeader } = await auth.asInstructor();
    await createSubscription({ user: user._id, status: 'cancelled' });

    const response = await client
      .get('/api/subscriptions/current')
      .set('Authorization', authHeader);

    expect(response.body.subscription).toBeNull();
  });

  it('refuses an unauthenticated request', async () => {
    const response = await client.get('/api/subscriptions/current');

    expect(response).toBeUnauthorised();
  });
});

describe('PUT /api/subscriptions/upgrade', () => {
  testCase(
    {
      id: 'TC-FR-13-06',
      name: 'A pro subscriber upgrades to premium',
      requirement: 'FR-13',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'The user holds an active pro subscription',
      input: 'PUT /api/subscriptions/upgrade with plan "premium"',
      expected: 'HTTP 200; the stored plan becomes "premium"',
    },
    async () => {
      const { user, authHeader } = await auth.asInstructor();
      await createSubscription({ user: user._id, plan: 'pro', status: 'active' });

      const response = await client
        .put('/api/subscriptions/upgrade')
        .set('Authorization', authHeader)
        .send({ plan: 'premium', billingCycle: 'monthly' });

      expect(response).toBeSuccessfulResponse(200);
      expect((await Subscription.findOne({ user: user._id })).plan).toBe('premium');
    },
  );

  testCase(
    {
      id: 'TC-FR-13-07',
      name: 'A downgrade is refused through the upgrade endpoint',
      requirement: 'FR-13',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'The user holds an active premium subscription',
      input: 'PUT /api/subscriptions/upgrade with plan "pro"',
      expected: 'HTTP 400 "This is not an upgrade from your current plan"; the plan is unchanged',
    },
    async () => {
      // Treating a downgrade as an upgrade would charge the customer the wrong
      // amount and grant them fewer features than they paid for.
      const { user, authHeader } = await auth.asInstructor();
      await createSubscription({ user: user._id, plan: 'premium', status: 'active' });

      const response = await client
        .put('/api/subscriptions/upgrade')
        .set('Authorization', authHeader)
        .send({ plan: 'pro', billingCycle: 'monthly' });

      expect(response).toBeErrorResponse(400, 'This is not an upgrade from your current plan');
      expect((await Subscription.findOne({ user: user._id })).plan).toBe('premium');
    },
  );

  it('refuses an upgrade to the same plan', async () => {
    const { user, authHeader } = await auth.asInstructor();
    await createSubscription({ user: user._id, plan: 'pro', status: 'active' });

    const response = await client
      .put('/api/subscriptions/upgrade')
      .set('Authorization', authHeader)
      .send({ plan: 'pro', billingCycle: 'monthly' });

    expect(response.status).toBe(400);
  });

  it('returns 404 when there is no subscription to upgrade', async () => {
    const { authHeader } = await auth.asInstructor();

    const response = await client
      .put('/api/subscriptions/upgrade')
      .set('Authorization', authHeader)
      .send({ plan: 'premium', billingCycle: 'monthly' });

    expect(response).toBeNotFound();
  });

  it('rejects "starter" as an upgrade target', async () => {
    const { user, authHeader } = await auth.asInstructor();
    await createSubscription({ user: user._id, plan: 'pro', status: 'active' });

    const response = await client
      .put('/api/subscriptions/upgrade')
      .set('Authorization', authHeader)
      .send({ plan: 'starter', billingCycle: 'monthly' });

    expect(response.status).toBe(400);
  });

  it('refuses an unauthenticated request', async () => {
    const response = await client
      .put('/api/subscriptions/upgrade')
      .send({ plan: 'premium', billingCycle: 'monthly' });

    expect(response).toBeUnauthorised();
  });
});

describe('PUT /api/subscriptions/cancel', () => {
  testCase(
    {
      id: 'TC-FR-13-08',
      name: 'A subscriber cancels and auto-renewal is switched off',
      requirement: 'FR-13',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'The user holds an active subscription with autoRenew true',
      input: 'PUT /api/subscriptions/cancel with a reason',
      expected: 'HTTP 200; status "cancelled"; reason stored; autoRenew false',
    },
    async () => {
      const { user, authHeader } = await auth.asInstructor();
      await createSubscription({ user: user._id, status: 'active', autoRenew: true });

      const response = await client
        .put('/api/subscriptions/cancel')
        .set('Authorization', authHeader)
        .send({ reason: 'Course finished' });

      expect(response).toBeSuccessfulResponse(200);

      const stored = await Subscription.findOne({ user: user._id });
      expect(stored.status).toBe('cancelled');
      expect(stored.cancellationReason).toBe('Course finished');
      // Leaving autoRenew on would re-bill a customer who has cancelled.
      expect(stored.autoRenew).toBe(false);
      expect(stored.cancelledAt).toBeRecentTimestamp();
    },
  );

  it('cancels without a reason', async () => {
    const { user, authHeader } = await auth.asInstructor();
    await createSubscription({ user: user._id, status: 'active' });

    const response = await client
      .put('/api/subscriptions/cancel')
      .set('Authorization', authHeader)
      .send({});

    expect(response).toBeSuccessfulResponse(200);
  });

  it('returns 404 when there is nothing to cancel', async () => {
    const { authHeader } = await auth.asInstructor();

    const response = await client
      .put('/api/subscriptions/cancel')
      .set('Authorization', authHeader)
      .send({ reason: 'Nothing here' });

    expect(response).toBeNotFound();
  });

  it('does not cancel another user’s subscription', async () => {
    const { authHeader } = await auth.asInstructor();
    const other = await createSubscription({ status: 'active' });

    await client
      .put('/api/subscriptions/cancel')
      .set('Authorization', authHeader)
      .send({ reason: 'Not mine' });

    expect((await Subscription.findById(other._id)).status).toBe('active');
  });

  it('refuses an unauthenticated request', async () => {
    const response = await client.put('/api/subscriptions/cancel').send({});

    expect(response).toBeUnauthorised();
  });
});

describe('GET /api/subscriptions/usage', () => {
  testCase(
    {
      id: 'TC-FR-13-09',
      name: 'Usage is reported against the plan limits',
      requirement: 'FR-13',
      type: 'Integration',
      priority: 'P2',
      preconditions: 'The user holds an active pro subscription with recorded usage',
      input: 'GET /api/subscriptions/usage',
      expected: 'HTTP 200; courses, students and apiCalls each with used, limit and unlimited',
    },
    async () => {
      const { user, authHeader } = await auth.asInstructor();
      await createSubscription({
        user: user._id,
        plan: 'pro',
        status: 'active',
        features: { maxCourses: -1, maxStudents: 500 },
        usage: { coursesCreated: 3, studentsEnrolled: 120, apiCalls: 42 },
      });

      const response = await client
        .get('/api/subscriptions/usage')
        .set('Authorization', authHeader);

      expect(response).toBeSuccessfulResponse(200);
      expect(response.body.usage.courses).toEqual({ used: 3, limit: -1, unlimited: true });
      expect(response.body.usage.students).toEqual({ used: 120, limit: 500, unlimited: false });
      expect(response.body.usage.apiCalls.unlimited).toBe(false);
    },
  );

  it('reports unlimited API calls on the premium plan', async () => {
    const { user, authHeader } = await auth.asInstructor();
    await createSubscription({ user: user._id, plan: 'premium', status: 'active' });

    const response = await client.get('/api/subscriptions/usage').set('Authorization', authHeader);

    expect(response.body.usage.apiCalls).toMatchObject({ limit: -1, unlimited: true });
  });

  it('returns 404 when there is no subscription', async () => {
    const { authHeader } = await auth.asInstructor();

    const response = await client.get('/api/subscriptions/usage').set('Authorization', authHeader);

    expect(response).toBeNotFound();
  });

  it('refuses an unauthenticated request', async () => {
    const response = await client.get('/api/subscriptions/usage');

    expect(response).toBeUnauthorised();
  });
});

describe('GET /api/subscriptions/payments', () => {
  testCase(
    {
      id: 'TC-FR-14-01',
      name: 'A subscriber reads only their own payment history',
      requirement: 'FR-14',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'The caller has two payments; another user has one',
      input: 'GET /api/subscriptions/payments',
      expected: 'HTTP 200; exactly the caller’s two payments, with pagination metadata',
    },
    async () => {
      const { user, authHeader } = await auth.asInstructor();
      await createPayment({ user: user._id });
      await createPayment({ user: user._id });
      await createPayment(); // another user's payment

      const response = await client
        .get('/api/subscriptions/payments')
        .set('Authorization', authHeader);

      expect(response).toBeSuccessfulResponse(200);
      expect(response.body.payments).toHaveLength(2);
      expect(response.body.pagination.total).toBe(2);
      for (const payment of response.body.payments) {
        expect(String(payment.user)).toBe(String(user._id));
      }
    },
  );

  it('returns an empty history for a user with no payments', async () => {
    const { authHeader } = await auth.asInstructor();

    const response = await client
      .get('/api/subscriptions/payments')
      .set('Authorization', authHeader);

    expect(response).toBeSuccessfulResponse(200);
    expect(response.body.payments).toEqual([]);
  });

  it('refuses an unauthenticated request', async () => {
    const response = await client.get('/api/subscriptions/payments');

    expect(response).toBeUnauthorised();
  });
});

describe('GET /api/subscriptions/invoice/:id', () => {
  testCase(
    {
      id: 'TC-FR-14-02',
      name: 'A subscriber downloads their own invoice',
      requirement: 'FR-14',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'A completed payment belonging to the caller',
      input: 'GET /api/subscriptions/invoice/<payment id>',
      expected: 'HTTP 200; the payment with its invoice number and populated user',
    },
    async () => {
      const { user, authHeader } = await auth.asInstructor();
      const payment = await createPayment({ user: user._id });

      const response = await client
        .get(`/api/subscriptions/invoice/${payment._id}`)
        .set('Authorization', authHeader);

      expect(response).toBeSuccessfulResponse(200);
      expect(response.body.payment._id).toBe(String(payment._id));
      expect(response.body.payment.invoiceNumber).toMatch(/^INV-\d{6}-\d{4}$/);
    },
  );

  testCase(
    {
      id: 'TC-NFR-03-06',
      name: 'A subscriber cannot download another customer’s invoice',
      requirement: 'NFR-03',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'A payment belonging to a different user',
      input: 'GET /api/subscriptions/invoice/<other user’s payment id>',
      expected: 'HTTP 404 — the query is scoped to the caller, so the record is not disclosed',
    },
    async () => {
      // An invoice carries a name, an email address and an amount; scoping the
      // lookup by user is what prevents an IDOR here (OWASP A01).
      const { authHeader } = await auth.asInstructor();
      const other = await createPayment();

      const response = await client
        .get(`/api/subscriptions/invoice/${other._id}`)
        .set('Authorization', authHeader);

      expect(response).toBeNotFound();
      expect(response.body.payment).toBeUndefined();
    },
  );

  it('returns 404 for a payment that does not exist', async () => {
    const { authHeader } = await auth.asInstructor();

    const response = await client
      .get(`/api/subscriptions/invoice/${MISSING_ID}`)
      .set('Authorization', authHeader);

    expect(response).toBeNotFound();
  });

  it('refuses an unauthenticated request', async () => {
    const payment = await createPayment();

    const response = await client.get(`/api/subscriptions/invoice/${payment._id}`);

    expect(response).toBeUnauthorised();
  });
});
