/**
 * Unit tests — models/Subscription.js
 *
 * Requirements: FR-13 (Subscription Plan Management), FR-14 (Billing).
 *
 * The plan-limit methods are commercial logic: `canCreateCourse` and
 * `canEnrollStudents` decide what a paying customer is allowed to do, and an
 * off-by-one there either blocks a legitimate customer or gives away capacity.
 * Both are tested one below, exactly on, and one above their limits.
 *
 * Methods that end in `this.save()` are exercised with `save` stubbed, so the
 * state transition is asserted without a database.
 */

'use strict';

const { requireFromSut } = require('@support/sut');
const { testCase } = require('@support/test-case');
const { buildSubscription } = require('@factories');

const Subscription = requireFromSut('./models/Subscription');
const mongoose = requireFromSut('mongoose');

const anObjectId = () => new mongoose.Types.ObjectId();

/** A subscription whose `save()` is a no-op, so state changes stay in memory. */
function aSubscription(overrides = {}) {
  const subscription = new Subscription({
    ...buildSubscription(overrides),
    user: overrides.user || anObjectId(),
  });
  subscription.save = jest.fn().mockResolvedValue(subscription);
  return subscription;
}

const DAY_MS = 24 * 60 * 60 * 1000;

describe('models/Subscription', () => {
  describe('schema validation', () => {
    it('accepts a well-formed subscription and applies its defaults', () => {
      const subscription = aSubscription({ status: undefined, paymentStatus: undefined });

      expect(subscription.validateSync()).toBeUndefined();
      expect(subscription.status).toBe('trial');
      expect(subscription.paymentStatus).toBe('pending');
      expect(subscription.currency).toBe('LKR');
      expect(subscription.autoRenew).toBe(true);
      expect(subscription.usage.coursesCreated).toBe(0);
    });

    it.each(['user', 'plan', 'billingCycle', 'endDate', 'amount'])(
      'rejects a subscription with no %s',
      (field) => {
        const subscription = aSubscription();
        subscription[field] = undefined;

        expect(subscription.validateSync().errors[field]).toBeDefined();
      },
    );

    it.each(['starter', 'pro', 'premium'])('accepts the plan "%s"', (plan) => {
      expect(aSubscription({ plan }).validateSync()).toBeUndefined();
    });

    it('rejects a plan outside the enumeration', () => {
      expect(aSubscription({ plan: 'enterprise' }).validateSync().errors.plan).toBeDefined();
    });

    it.each(['active', 'inactive', 'cancelled', 'expired', 'trial'])(
      'accepts the status "%s"',
      (status) => {
        expect(aSubscription({ status }).validateSync()).toBeUndefined();
      },
    );

    it('defaults the starter feature limits', () => {
      const subscription = aSubscription();

      expect(subscription.features.maxCourses).toBe(5);
      expect(subscription.features.maxStudents).toBe(50);
      expect(subscription.features.apiAccess).toBe(false);
      expect(subscription.features.whiteLabel).toBe(false);
    });
  });

  describe('canCreateCourse', () => {
    testCase(
      {
        id: 'TC-FR-13-U01',
        name: 'A starter subscription may create courses up to its limit and no further',
        requirement: 'FR-13',
        type: 'Unit',
        priority: 'P1',
        preconditions: 'A starter subscription with maxCourses = 5',
        input: 'canCreateCourse() at 4, 5 and 6 courses already created',
        expected: 'true at 4, false at 5 (the limit is reached), false at 6',
      },
      () => {
        const at = (coursesCreated) =>
          aSubscription({
            plan: 'starter',
            features: { maxCourses: 5 },
            usage: { coursesCreated },
          }).canCreateCourse();

        expect(at(4)).toBe(true);
        expect(at(5)).toBe(false);
        expect(at(6)).toBe(false);
      },
    );

    it('allows a starter subscription with nothing created yet', () => {
      expect(aSubscription({ plan: 'starter' }).canCreateCourse()).toBe(true);
    });

    it.each(['pro', 'premium'])('gives the "%s" plan unlimited courses', (plan) => {
      const subscription = aSubscription({
        plan,
        features: { maxCourses: 5 },
        usage: { coursesCreated: 9999 },
      });

      expect(subscription.canCreateCourse()).toBe(true);
    });
  });

  describe('canEnrollStudents', () => {
    testCase(
      {
        id: 'TC-FR-13-U02',
        name: 'Student enrolment is allowed only while the batch fits inside the plan limit',
        requirement: 'FR-13',
        type: 'Unit',
        priority: 'P1',
        preconditions: 'A pro subscription with maxStudents = 500 and 499 already enrolled',
        input: 'canEnrollStudents(1) and canEnrollStudents(2)',
        expected: 'true for one more student (reaching exactly 500); false for two',
      },
      () => {
        const subscription = aSubscription({
          plan: 'pro',
          features: { maxStudents: 500 },
          usage: { studentsEnrolled: 499 },
        });

        expect(subscription.canEnrollStudents(1)).toBe(true);
        expect(subscription.canEnrollStudents(2)).toBe(false);
      },
    );

    it('defaults to a batch of one student', () => {
      const subscription = aSubscription({
        plan: 'starter',
        features: { maxStudents: 50 },
        usage: { studentsEnrolled: 49 },
      });

      expect(subscription.canEnrollStudents()).toBe(true);
    });

    it('refuses once the limit is already reached', () => {
      const subscription = aSubscription({
        plan: 'starter',
        features: { maxStudents: 50 },
        usage: { studentsEnrolled: 50 },
      });

      expect(subscription.canEnrollStudents()).toBe(false);
    });

    it('gives the premium plan unlimited students', () => {
      const subscription = aSubscription({
        plan: 'premium',
        features: { maxStudents: 50 },
        usage: { studentsEnrolled: 100000 },
      });

      expect(subscription.canEnrollStudents(5000)).toBe(true);
    });
  });

  describe('updateUsage', () => {
    it.each([
      ['course', 'coursesCreated'],
      ['student', 'studentsEnrolled'],
      ['api', 'apiCalls'],
    ])('increments %s usage', async (type, field) => {
      const subscription = aSubscription();
      const before = subscription.usage[field];

      await subscription.updateUsage(type);

      expect(subscription.usage[field]).toBe(before + 1);
      expect(subscription.save).toHaveBeenCalledTimes(1);
    });

    it('accepts an explicit increment', async () => {
      const subscription = aSubscription();

      await subscription.updateUsage('student', 25);

      expect(subscription.usage.studentsEnrolled).toBe(25);
    });

    it('supports a negative increment, so an un-enrolment can release capacity', async () => {
      const subscription = aSubscription({ usage: { studentsEnrolled: 10 } });

      await subscription.updateUsage('student', -1);

      expect(subscription.usage.studentsEnrolled).toBe(9);
    });

    it('leaves usage untouched for an unrecognised type', async () => {
      const subscription = aSubscription();

      await subscription.updateUsage('storage');

      expect(subscription.usage.coursesCreated).toBe(0);
      expect(subscription.usage.studentsEnrolled).toBe(0);
      expect(subscription.usage.apiCalls).toBe(0);
    });
  });

  describe('cancel', () => {
    testCase(
      {
        id: 'TC-FR-13-U03',
        name: 'Cancelling records the reason and stops auto-renewal',
        requirement: 'FR-13',
        type: 'Unit',
        priority: 'P1',
        preconditions: 'An active subscription with autoRenew true',
        input: 'subscription.cancel("Too expensive")',
        expected: 'status "cancelled"; reason stored; cancelledAt stamped; autoRenew false',
      },
      async () => {
        const subscription = aSubscription({ status: 'active', autoRenew: true });

        await subscription.cancel('Too expensive');

        expect(subscription.status).toBe('cancelled');
        expect(subscription.cancellationReason).toBe('Too expensive');
        expect(subscription.cancelledAt).toBeRecentTimestamp();
        // Leaving autoRenew on would re-bill a cancelled customer.
        expect(subscription.autoRenew).toBe(false);
        expect(subscription.save).toHaveBeenCalledTimes(1);
      },
    );

    it('cancels without a reason', async () => {
      const subscription = aSubscription({ status: 'active' });

      await subscription.cancel();

      expect(subscription.status).toBe('cancelled');
      expect(subscription.cancellationReason).toBeUndefined();
    });
  });

  describe('renew', () => {
    testCase(
      {
        id: 'TC-FR-13-U04',
        name: 'Renewing a monthly subscription extends it by 30 days from now',
        requirement: 'FR-13',
        type: 'Unit',
        priority: 'P1',
        preconditions: 'An expired monthly subscription',
        input: 'subscription.renew()',
        expected: 'status "active"; endDate and nextBillingDate 30 days from now',
      },
      async () => {
        jest.useFakeTimers().setSystemTime(new Date('2026-03-01T00:00:00.000Z'));
        const subscription = aSubscription({ billingCycle: 'monthly', status: 'expired' });

        await subscription.renew();

        expect(subscription.status).toBe('active');
        expect(subscription.endDate).toEqual(new Date('2026-03-31T00:00:00.000Z'));
        expect(subscription.nextBillingDate).toEqual(subscription.endDate);
      },
    );

    it('extends a yearly subscription by 365 days', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-03-01T00:00:00.000Z'));
      const subscription = aSubscription({ billingCycle: 'yearly' });

      await subscription.renew();

      expect(subscription.endDate).toEqual(
        new Date(Date.parse('2026-03-01T00:00:00.000Z') + 365 * DAY_MS),
      );
    });

    it('renews from the present rather than from the previous end date', async () => {
      // Extending from a long-past endDate would leave the subscription
      // immediately expired again.
      jest.useFakeTimers().setSystemTime(new Date('2026-06-01T00:00:00.000Z'));
      const subscription = aSubscription({
        billingCycle: 'monthly',
        endDate: new Date('2026-01-01T00:00:00.000Z'),
      });

      await subscription.renew();

      expect(subscription.endDate.getTime()).toBeGreaterThan(
        Date.parse('2026-06-01T00:00:00.000Z'),
      );
    });
  });

  describe('getPlanFeatures (static)', () => {
    testCase(
      {
        id: 'TC-FR-13-U05',
        name: 'Each plan exposes its documented feature set',
        requirement: 'FR-13',
        type: 'Unit',
        priority: 'P2',
        preconditions: 'None',
        input: 'Subscription.getPlanFeatures() for starter, pro and premium',
        expected:
          'Starter is limited; pro unlocks unlimited courses and API access; premium unlocks everything',
      },
      () => {
        const starter = Subscription.getPlanFeatures('starter');
        expect(starter).toMatchObject({ maxCourses: 5, maxStudents: 50, apiAccess: false });

        const pro = Subscription.getPlanFeatures('pro');
        expect(pro).toMatchObject({
          maxCourses: -1,
          maxStudents: 500,
          apiAccess: true,
          whiteLabel: false,
        });

        const premium = Subscription.getPlanFeatures('premium');
        expect(premium).toMatchObject({
          maxCourses: -1,
          maxStudents: -1,
          whiteLabel: true,
          ssoIntegration: true,
          dedicatedManager: true,
        });
      },
    );

    it('falls back to the starter feature set for an unknown plan', () => {
      // Failing closed matters: an unknown plan must not inherit premium limits.
      expect(Subscription.getPlanFeatures('enterprise')).toEqual(
        Subscription.getPlanFeatures('starter'),
      );
      expect(Subscription.getPlanFeatures(undefined)).toEqual(
        Subscription.getPlanFeatures('starter'),
      );
    });

    it('uses -1 to mean unlimited rather than a large finite number', () => {
      expect(Subscription.getPlanFeatures('premium').maxStudents).toBe(-1);
    });
  });

  describe('getPlanPricing (static)', () => {
    it.each([
      ['starter', 'monthly', 0],
      ['starter', 'yearly', 0],
      ['pro', 'monthly', 15000],
      ['pro', 'yearly', 150000],
      ['premium', 'monthly', 35000],
      ['premium', 'yearly', 350000],
    ])('prices %s / %s at LKR %s', (plan, cycle, expected) => {
      expect(Subscription.getPlanPricing(plan, cycle)).toBe(expected);
    });

    it('offers two months free on an annual commitment for paid plans', () => {
      // 12 × monthly would be 180 000; the yearly price is 150 000.
      expect(Subscription.getPlanPricing('pro', 'yearly')).toBe(
        Subscription.getPlanPricing('pro', 'monthly') * 10,
      );
      expect(Subscription.getPlanPricing('premium', 'yearly')).toBe(
        Subscription.getPlanPricing('premium', 'monthly') * 10,
      );
    });

    it.each([
      ['an unknown plan', 'enterprise', 'monthly'],
      ['an unknown billing cycle', 'pro', 'weekly'],
      ['both unknown', 'enterprise', 'weekly'],
    ])('returns zero for %s', (_label, plan, cycle) => {
      expect(Subscription.getPlanPricing(plan, cycle)).toBe(0);
    });
  });

  describe('virtuals', () => {
    it('reports an active, unexpired subscription as active', () => {
      const subscription = aSubscription({
        status: 'active',
        endDate: new Date(Date.now() + DAY_MS),
      });

      expect(subscription.isActive).toBe(true);
    });

    it.each([
      ['an active subscription past its end date', 'active', -DAY_MS],
      ['a cancelled subscription still inside its term', 'cancelled', DAY_MS],
      ['an expired subscription', 'expired', DAY_MS],
    ])('reports %s as not active', (_label, status, offset) => {
      const subscription = aSubscription({ status, endDate: new Date(Date.now() + offset) });

      expect(subscription.isActive).toBe(false);
    });

    it('reports a trial as in-trial only while the trial end date is in the future', () => {
      expect(
        aSubscription({ status: 'trial', trialEndDate: new Date(Date.now() + DAY_MS) }).isTrial,
      ).toBe(true);
      expect(
        aSubscription({ status: 'trial', trialEndDate: new Date(Date.now() - DAY_MS) }).isTrial,
      ).toBe(false);
    });
  });
});
