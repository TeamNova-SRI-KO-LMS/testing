/**
 * Integration tests — the public "Join Us" enquiry funnel.
 *
 * Endpoints: POST /api/join-us/submit;
 *            GET /api/join-us/submissions[/:id], /stats;
 *            PUT /api/join-us/submissions/:id/status;
 *            DELETE /api/join-us/submissions/:id.
 *
 * Requirements: FR-23 (Enquiry Submission), FR-05 (RBAC), NFR-04 (Validation).
 */

'use strict';

const { loadApp } = require('@support/app');
const { api } = require('@support/api-client');
const { testCase } = require('@support/test-case');
const { requireFromSut } = require('@support/sut');
const auth = require('@support/auth');
const { createJoinUsSubmission, buildJoinUsSubmission } = require('@factories');

const client = api(loadApp());
const JoinUsSubmission = requireFromSut('./models/JoinUsSubmission');

const MISSING_ID = '507f1f77bcf86cd799439099';

describe('POST /api/join-us/submit', () => {
  testCase(
    {
      id: 'TC-FR-23-01',
      name: 'A prospective student submits an enquiry without an account',
      requirement: 'FR-23',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'No submission exists for the given email address',
      input: 'POST /api/join-us/submit with a complete, valid enquiry and no Authorization header',
      expected: 'HTTP 201; a submission id; the record is stored with status "pending"',
    },
    async () => {
      const payload = buildJoinUsSubmission({ name: 'Ayesha Perera' });

      const response = await client.post('/api/join-us/submit').send(payload);

      expect(response).toBeSuccessfulResponse(201);
      expect(response.body.message).toMatch(/Thank you/i);
      expect(response.body.submissionId).toBeObjectId();

      const stored = await JoinUsSubmission.findById(response.body.submissionId);
      expect(stored.name).toBe('Ayesha Perera');
      expect(stored.status).toBe('pending');
    },
  );

  it('accepts an enquiry carrying only a name and an email', async () => {
    const response = await client.post('/api/join-us/submit').send({
      name: 'Minimal Enquiry',
      email: 'minimal@sriko-test.lk',
    });

    expect(response).toBeSuccessfulResponse(201);
  });

  testCase(
    {
      id: 'TC-FR-23-02',
      name: 'A duplicate enquiry from the same email address is refused',
      requirement: 'FR-23',
      type: 'Integration',
      priority: 'P2',
      preconditions: 'A submission already exists for the email address',
      input: 'POST /api/join-us/submit with that same email',
      expected:
        'HTTP 400; a message directing the enquirer to contact the academy; one record only',
    },
    async () => {
      const payload = buildJoinUsSubmission();
      await client.post('/api/join-us/submit').send(payload);

      const response = await client.post('/api/join-us/submit').send(payload);

      expect(response.status).toBe(400);
      expect(response.body.message).toMatch(/already exists/i);
      expect(await JoinUsSubmission.countDocuments({ email: payload.email })).toBe(1);
    },
  );

  it.each([
    ['a one-character name', { name: 'A' }, 'name'],
    ['a malformed email', { email: 'not-an-email' }, 'email'],
    ['an age of 15', { age: 15 }, 'age'],
    ['an age of 81', { age: 81 }, 'age'],
    ['an unrecognised Korean level', { currentLevel: 'Fluent' }, 'currentLevel'],
    ['an unrecognised preferred time', { preferredTime: 'Midnight' }, 'preferredTime'],
    ['an unrecognised referral source', { hearAboutUs: 'billboard' }, 'hearAboutUs'],
    ['a 1001-character message', { message: 'x'.repeat(1001) }, 'message'],
  ])('rejects an enquiry with %s', async (_label, override, field) => {
    const response = await client.post('/api/join-us/submit').send(buildJoinUsSubmission(override));

    expect(response).toFailValidation(field);
    expect(await JoinUsSubmission.countDocuments()).toBe(0);
  });

  it('rejects an unrecognised interest inside the array', async () => {
    const response = await client
      .post('/api/join-us/submit')
      .send(buildJoinUsSubmission({ interests: ['Rocket Science'] }));

    expect(response).toFailValidation();
  });

  testCase(
    {
      id: 'TC-FR-23-03',
      name: 'The submission records the enquirer’s IP address and user agent',
      requirement: 'FR-23',
      type: 'Integration',
      priority: 'P3',
      preconditions: 'None',
      input: 'POST /api/join-us/submit with a User-Agent header',
      expected: 'HTTP 201; ipAddress and userAgent are stored for anti-abuse triage',
    },
    async () => {
      const response = await client
        .post('/api/join-us/submit')
        .set('User-Agent', 'SRI-KO-Test-Agent/1.0')
        .send(buildJoinUsSubmission());

      const stored = await JoinUsSubmission.findById(response.body.submissionId);
      expect(stored.userAgent).toBe('SRI-KO-Test-Agent/1.0');
      expect(stored.ipAddress).toBeTruthy();
    },
  );
});

describe('GET /api/join-us/submissions', () => {
  testCase(
    {
      id: 'TC-FR-23-04',
      name: 'An administrator reviews the enquiry queue',
      requirement: 'FR-23',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'Two enquiries exist',
      input: 'GET /api/join-us/submissions with an administrator token',
      expected: 'HTTP 200; both enquiries are listed',
    },
    async () => {
      const admin = await auth.asAdmin();
      await createJoinUsSubmission();
      await createJoinUsSubmission();

      const response = await client
        .get('/api/join-us/submissions')
        .set('Authorization', admin.authHeader);

      expect(response).toBeSuccessfulResponse(200);
      const submissions = response.body.submissions || response.body.data || [];
      expect(submissions).toHaveLength(2);
    },
  );

  testCase(
    {
      id: 'TC-NFR-03-10',
      name: 'A student cannot read the enquiry queue',
      requirement: 'NFR-03',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'An enquiry containing a name, email and phone number exists',
      input: 'GET /api/join-us/submissions with a student token',
      expected: 'HTTP 403 — enquiries carry personal data and are administrator-only',
    },
    async () => {
      const { authHeader } = await auth.asStudent();
      await createJoinUsSubmission();

      const response = await client
        .get('/api/join-us/submissions')
        .set('Authorization', authHeader);

      expect(response).toBeForbidden();
    },
  );

  it('refuses an unauthenticated request', async () => {
    const response = await client.get('/api/join-us/submissions');

    expect(response).toBeUnauthorised();
  });
});

describe('GET /api/join-us/submissions/:id', () => {
  it('returns a single enquiry to an administrator', async () => {
    const admin = await auth.asAdmin();
    const submission = await createJoinUsSubmission({ name: 'Ayesha Perera' });

    const response = await client
      .get(`/api/join-us/submissions/${submission._id}`)
      .set('Authorization', admin.authHeader);

    expect(response).toBeSuccessfulResponse(200);
  });

  it('returns 404 for an enquiry that does not exist', async () => {
    const admin = await auth.asAdmin();

    const response = await client
      .get(`/api/join-us/submissions/${MISSING_ID}`)
      .set('Authorization', admin.authHeader);

    expect(response).toBeNotFound();
  });

  it('refuses a student', async () => {
    const { authHeader } = await auth.asStudent();
    const submission = await createJoinUsSubmission();

    const response = await client
      .get(`/api/join-us/submissions/${submission._id}`)
      .set('Authorization', authHeader);

    expect(response).toBeForbidden();
  });
});

describe('PUT /api/join-us/submissions/:id/status', () => {
  testCase(
    {
      id: 'TC-FR-23-05',
      name: 'An administrator marks an enquiry as contacted',
      requirement: 'FR-23',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'A pending enquiry exists',
      input: 'PUT /api/join-us/submissions/<id>/status with status "contacted" and a note',
      expected:
        'HTTP 200; status "contacted"; the note stored; contactedAt stamped; contactedBy names the administrator',
    },
    async () => {
      const admin = await auth.asAdmin();
      const submission = await createJoinUsSubmission();

      const response = await client
        .put(`/api/join-us/submissions/${submission._id}/status`)
        .set('Authorization', admin.authHeader)
        .send({ status: 'contacted', notes: 'Called on 3 March, will enrol next term.' });

      expect(response).toBeSuccessfulResponse(200);

      const stored = await JoinUsSubmission.findById(submission._id);
      expect(stored.status).toBe('contacted');
      expect(stored.notes).toBe('Called on 3 March, will enrol next term.');
      expect(stored.contactedAt).toBeRecentTimestamp();
      expect(String(stored.contactedBy)).toBe(admin.id);
    },
  );

  it.each(['pending', 'contacted', 'enrolled', 'rejected'])(
    'accepts the status "%s"',
    async (status) => {
      const admin = await auth.asAdmin();
      const submission = await createJoinUsSubmission();

      const response = await client
        .put(`/api/join-us/submissions/${submission._id}/status`)
        .set('Authorization', admin.authHeader)
        .send({ status });

      expect(response).toBeSuccessfulResponse(200);
    },
  );

  it('rejects a status outside the enumeration', async () => {
    const admin = await auth.asAdmin();
    const submission = await createJoinUsSubmission();

    const response = await client
      .put(`/api/join-us/submissions/${submission._id}/status`)
      .set('Authorization', admin.authHeader)
      .send({ status: 'maybe' });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/Invalid status/);
  });

  it('rejects a request with no status', async () => {
    const admin = await auth.asAdmin();
    const submission = await createJoinUsSubmission();

    const response = await client
      .put(`/api/join-us/submissions/${submission._id}/status`)
      .set('Authorization', admin.authHeader)
      .send({});

    expect(response.status).toBe(400);
  });

  it('returns 404 for an enquiry that does not exist', async () => {
    const admin = await auth.asAdmin();

    const response = await client
      .put(`/api/join-us/submissions/${MISSING_ID}/status`)
      .set('Authorization', admin.authHeader)
      .send({ status: 'contacted' });

    expect(response).toBeNotFound();
  });

  it('refuses a student', async () => {
    const { authHeader } = await auth.asStudent();
    const submission = await createJoinUsSubmission();

    const response = await client
      .put(`/api/join-us/submissions/${submission._id}/status`)
      .set('Authorization', authHeader)
      .send({ status: 'enrolled' });

    expect(response).toBeForbidden();
    expect((await JoinUsSubmission.findById(submission._id)).status).toBe('pending');
  });
});

describe('GET /api/join-us/stats', () => {
  testCase(
    {
      id: 'TC-FR-23-06',
      name: 'Enquiry statistics break down by status',
      requirement: 'FR-23',
      type: 'Integration',
      priority: 'P2',
      preconditions: 'Enquiries exist in the pending and enrolled states',
      input: 'GET /api/join-us/stats',
      expected: 'HTTP 200; a statistics payload',
    },
    async () => {
      const admin = await auth.asAdmin();
      await createJoinUsSubmission({ status: 'pending' });
      await createJoinUsSubmission({ status: 'enrolled' });

      const response = await client
        .get('/api/join-us/stats')
        .set('Authorization', admin.authHeader);

      expect(response).toBeSuccessfulResponse(200);
    },
  );

  it('refuses a student', async () => {
    const { authHeader } = await auth.asStudent();

    const response = await client.get('/api/join-us/stats').set('Authorization', authHeader);

    expect(response).toBeForbidden();
  });

  it('resolves "stats" as a literal path rather than a submission id', async () => {
    const admin = await auth.asAdmin();

    const response = await client.get('/api/join-us/stats').set('Authorization', admin.authHeader);

    expect(response.status).toBe(200);
  });
});

describe('DELETE /api/join-us/submissions/:id', () => {
  testCase(
    {
      id: 'TC-FR-23-07',
      name: 'An administrator deletes an enquiry',
      requirement: 'FR-23',
      type: 'Integration',
      priority: 'P2',
      preconditions: 'An enquiry exists',
      input: 'DELETE /api/join-us/submissions/<id>',
      expected: 'HTTP 200; the enquiry no longer exists',
    },
    async () => {
      const admin = await auth.asAdmin();
      const submission = await createJoinUsSubmission();

      const response = await client
        .delete(`/api/join-us/submissions/${submission._id}`)
        .set('Authorization', admin.authHeader);

      expect(response).toBeSuccessfulResponse(200);
      expect(await JoinUsSubmission.findById(submission._id)).toBeNull();
    },
  );

  it('returns 404 for an enquiry that does not exist', async () => {
    const admin = await auth.asAdmin();

    const response = await client
      .delete(`/api/join-us/submissions/${MISSING_ID}`)
      .set('Authorization', admin.authHeader);

    expect(response).toBeNotFound();
  });

  it('refuses a student', async () => {
    const { authHeader } = await auth.asStudent();
    const submission = await createJoinUsSubmission();

    const response = await client
      .delete(`/api/join-us/submissions/${submission._id}`)
      .set('Authorization', authHeader);

    expect(response).toBeForbidden();
    expect(await JoinUsSubmission.findById(submission._id)).not.toBeNull();
  });
});
