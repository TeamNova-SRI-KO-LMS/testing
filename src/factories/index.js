/**
 * Test data factories.
 *
 * Factories exist so a test can say what it *cares about* and stay silent about
 * everything else. `buildUser({ role: 'admin' })` communicates "an admin"; a
 * literal object with eleven fields communicates nothing and breaks whenever
 * the schema gains a required field.
 *
 * Two flavours per entity:
 *   buildX(overrides)   → a plain attributes object, never touches the database
 *   createX(overrides)  → persists through the real Mongoose model
 *
 * `build*` is for unit tests, request bodies, and negative cases; `create*` is
 * for integration preconditions.
 *
 * Every value is deterministic-but-unique. Uniqueness matters because the
 * application enforces real unique indexes (User.email, Payment.invoiceNumber);
 * determinism matters because a test that fails should fail every time.
 */

'use strict';

const { requireFromSut } = require('../support/sut');

let sequence = 0;
/** Monotonic, collision-free suffix — unique across workers and re-runs. */
function nextId() {
  sequence += 1;
  const worker = process.env.JEST_WORKER_ID || '1';
  return `${worker}-${process.pid}-${sequence}`;
}

/** A password that satisfies the application's policy: upper, lower, digit, 6+. */
const VALID_PASSWORD = 'TestPass123';

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

function buildUser(overrides = {}) {
  const id = nextId();
  return {
    name: `Test User ${id}`,
    email: `user.${id}@sriko-test.lk`,
    password: VALID_PASSWORD,
    role: 'student',
    ...overrides,
  };
}

const buildStudent = (overrides = {}) => buildUser({ role: 'student', ...overrides });
const buildInstructor = (overrides = {}) => buildUser({ role: 'instructor', ...overrides });
const buildAdmin = (overrides = {}) => buildUser({ role: 'admin', ...overrides });

/**
 * Persist a user. The plain-text password is returned alongside the document
 * because the schema hashes it on save and marks it `select: false`, so a test
 * that later logs in has no other way to recover it.
 *
 * @returns {Promise<{user: object, password: string}>}
 */
async function createUser(overrides = {}) {
  const User = requireFromSut('./models/User');
  const attributes = buildUser(overrides);
  const password = attributes.password;
  const user = await User.create(attributes);
  return { user, password };
}

const createStudent = (overrides = {}) => createUser({ role: 'student', ...overrides });
const createInstructor = (overrides = {}) => createUser({ role: 'instructor', ...overrides });
const createAdmin = (overrides = {}) => createUser({ role: 'admin', ...overrides });

// ---------------------------------------------------------------------------
// Courses
// ---------------------------------------------------------------------------

function buildLesson(overrides = {}) {
  const id = nextId();
  return {
    title: `Lesson ${id}`,
    content: `Lesson content for ${id}`,
    duration: 30,
    type: 'video',
    isFreePreview: false,
    ...overrides,
  };
}

function buildCurriculumWeek(overrides = {}) {
  const id = nextId();
  return {
    week: 1,
    title: `Week ${id}`,
    description: `Description for week ${id}`,
    lessons: [buildLesson()],
    ...overrides,
  };
}

/**
 * A course payload. The default title and description deliberately avoid the
 * words "and"/"or" and the characters `--`, `;`, `/*`: the application's global
 * input filter (server.js) rejects any request body containing them. See
 * DEFECT-01 in docs/testing/DEFECT_REGISTER.md.
 */
function buildCourse(overrides = {}) {
  const id = nextId();
  return {
    title: `Korean Language Course ${id}`,
    description: `A structured Korean course covering hangul, grammar, vocabulary. Reference ${id}.`,
    category: 'other',
    level: 'beginner',
    duration: 8,
    price: 5000,
    isPublished: true,
    ...overrides,
  };
}

async function createCourse(overrides = {}) {
  const Course = requireFromSut('./models/Course');
  const { instructor, ...rest } = overrides;

  let instructorId = instructor;
  if (!instructorId) {
    const created = await createInstructor();
    instructorId = created.user._id;
  }

  return Course.create({
    ...buildCourse(rest),
    curriculum: rest.curriculum || [buildCurriculumWeek()],
    instructor: instructorId,
  });
}

// ---------------------------------------------------------------------------
// Progress / enrolment
// ---------------------------------------------------------------------------

function buildProgress(overrides = {}) {
  return {
    currentWeek: 1,
    overallProgress: 0,
    timeSpent: 0,
    isCompleted: false,
    ...overrides,
  };
}

/**
 * Enrol a student in a course the way the application does: a Progress record,
 * the student on `course.enrolledStudents`, and the course on
 * `user.enrolledCourses`. Tests that only create a Progress record produce a
 * half-enrolled state the application never generates.
 */
async function enrolStudent(studentId, courseId, overrides = {}) {
  const Progress = requireFromSut('./models/Progress');
  const Course = requireFromSut('./models/Course');
  const User = requireFromSut('./models/User');

  const progress = await Progress.create({
    ...buildProgress(overrides),
    student: studentId,
    course: courseId,
  });

  await Course.findByIdAndUpdate(courseId, { $addToSet: { enrolledStudents: studentId } });
  await User.findByIdAndUpdate(studentId, { $addToSet: { enrolledCourses: courseId } });

  return progress;
}

// ---------------------------------------------------------------------------
// Subscriptions and payments
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

function buildSubscription(overrides = {}) {
  return {
    plan: 'pro',
    billingCycle: 'monthly',
    status: 'active',
    startDate: new Date(),
    endDate: new Date(Date.now() + 30 * DAY_MS),
    nextBillingDate: new Date(Date.now() + 30 * DAY_MS),
    amount: 15000,
    currency: 'LKR',
    paymentMethod: 'credit_card',
    paymentStatus: 'paid',
    autoRenew: true,
    ...overrides,
  };
}

async function createSubscription(overrides = {}) {
  const Subscription = requireFromSut('./models/Subscription');
  const { user, ...rest } = overrides;

  let userId = user;
  if (!userId) {
    const created = await createStudent();
    userId = created.user._id;
  }

  return Subscription.create({ ...buildSubscription(rest), user: userId });
}

function buildPayment(overrides = {}) {
  return {
    amount: 15000,
    currency: 'LKR',
    status: 'completed',
    paymentMethod: 'credit_card',
    paymentGateway: 'manual',
    plan: 'pro',
    billingCycle: 'monthly',
    billingPeriod: {
      startDate: new Date(),
      endDate: new Date(Date.now() + 30 * DAY_MS),
    },
    paymentDate: new Date(),
    paidDate: new Date(),
    ...overrides,
  };
}

async function createPayment(overrides = {}) {
  const Payment = requireFromSut('./models/Payment');
  const { user, subscription, ...rest } = overrides;

  let userId = user;
  let subscriptionId = subscription;

  if (!subscriptionId) {
    const created = await createSubscription(userId ? { user: userId } : {});
    subscriptionId = created._id;
    userId = userId || created.user;
  }

  return Payment.create({ ...buildPayment(rest), user: userId, subscription: subscriptionId });
}

// ---------------------------------------------------------------------------
// Certificates
// ---------------------------------------------------------------------------

function buildCertificate(overrides = {}) {
  const id = nextId();
  return {
    studentName: `Test Student ${id}`,
    courseName: `Korean Language Course ${id}`,
    completionDate: new Date(),
    issuedDate: new Date(),
    status: 'pending',
    ...overrides,
  };
}

async function createCertificate(overrides = {}) {
  const Certificate = requireFromSut('./models/Certificate');
  const { student, course, issuedBy, ...rest } = overrides;

  const studentId = student || (await createStudent()).user._id;
  const courseDoc = course ? { _id: course } : await createCourse();
  const issuerId = issuedBy || (await createAdmin()).user._id;

  return Certificate.create({
    ...buildCertificate(rest),
    student: studentId,
    course: courseDoc._id,
    issuedBy: issuerId,
  });
}

// ---------------------------------------------------------------------------
// Join Us submissions
// ---------------------------------------------------------------------------

function buildJoinUsSubmission(overrides = {}) {
  const id = nextId();
  return {
    name: `Prospective Student ${id}`,
    email: `prospect.${id}@sriko-test.lk`,
    phone: '0771234567',
    age: 25,
    currentLevel: 'Complete Beginner',
    preferredTime: 'Evening (6:00 PM - 9:00 PM)',
    interests: ['Korean Language Basics'],
    hearAboutUs: 'website',
    message: `I would like to learn Korean. Reference ${id}.`,
    ...overrides,
  };
}

function createJoinUsSubmission(overrides = {}) {
  const JoinUsSubmission = requireFromSut('./models/JoinUsSubmission');
  return JoinUsSubmission.create(buildJoinUsSubmission(overrides));
}

// ---------------------------------------------------------------------------
// Announcements, forums, notifications
// ---------------------------------------------------------------------------

function buildAnnouncement(overrides = {}) {
  const id = nextId();
  return {
    title: `Announcement ${id}`,
    content: `Important information for all students. Reference ${id}.`,
    type: 'general',
    priority: 'medium',
    targetAudience: 'all',
    isActive: true,
    startDate: new Date(Date.now() - DAY_MS),
    // `endDate` is required by the schema and gates the "active announcements"
    // query, so it defaults to the future — an expired announcement has to be
    // requested explicitly.
    endDate: new Date(Date.now() + 30 * DAY_MS),
    ...overrides,
  };
}

async function createAnnouncement(overrides = {}) {
  const Announcement = requireFromSut('./models/Announcement');
  const { createdBy, ...rest } = overrides;
  const authorId = createdBy || (await createAdmin()).user._id;
  return Announcement.create({ ...buildAnnouncement(rest), createdBy: authorId });
}

function buildForum(overrides = {}) {
  const id = nextId();
  return {
    title: `Discussion Forum ${id}`,
    description: `A place to discuss Korean grammar. Reference ${id}.`,
    category: 'general',
    level: 'all',
    isActive: true,
    ...overrides,
  };
}

async function createForum(overrides = {}) {
  const DiscussionForum = requireFromSut('./models/DiscussionForum');
  const { createdBy, ...rest } = overrides;
  const authorId = createdBy || (await createAdmin()).user._id;
  return DiscussionForum.create({ ...buildForum(rest), createdBy: authorId });
}

function buildNotification(overrides = {}) {
  const id = nextId();
  return {
    title: `Notification ${id}`,
    message: `You have a new update. Reference ${id}.`,
    type: 'general',
    priority: 'medium',
    targetAudience: 'all',
    isActive: true,
    scheduledFor: new Date(Date.now() - DAY_MS),
    // Required by the schema, and the "my notifications" query filters on it.
    expiresAt: new Date(Date.now() + 30 * DAY_MS),
    ...overrides,
  };
}

async function createNotification(overrides = {}) {
  const Notification = requireFromSut('./models/Notification');
  const { createdBy, ...rest } = overrides;
  const authorId = createdBy || (await createAdmin()).user._id;
  return Notification.create({ ...buildNotification(rest), createdBy: authorId });
}

module.exports = {
  VALID_PASSWORD,
  nextId,

  buildUser,
  buildStudent,
  buildInstructor,
  buildAdmin,
  createUser,
  createStudent,
  createInstructor,
  createAdmin,

  buildLesson,
  buildCurriculumWeek,
  buildCourse,
  createCourse,

  buildProgress,
  enrolStudent,

  buildSubscription,
  createSubscription,
  buildPayment,
  createPayment,

  buildCertificate,
  createCertificate,

  buildJoinUsSubmission,
  createJoinUsSubmission,

  buildAnnouncement,
  createAnnouncement,
  buildForum,
  createForum,
  buildNotification,
  createNotification,
};
