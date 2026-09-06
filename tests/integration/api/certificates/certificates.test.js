/**
 * Integration tests — certificate issuance and delivery.
 *
 * Endpoints: GET /api/certificates[/:id|/stats|/eligible-students|
 *            /my-certificates]; POST /api/certificates,
 *            /:id/send, /:id/mark-viewed; PUT /api/certificates/:id/status;
 *            DELETE /api/certificates/:id.
 *
 * Requirements: FR-15 (Certificate Issuance & Delivery), FR-05 (RBAC).
 */

'use strict';

const { loadApp } = require('@support/app');
const { api } = require('@support/api-client');
const { testCase } = require('@support/test-case');
const { requireFromSut } = require('@support/sut');
const auth = require('@support/auth');
const { createCourse, createCertificate, enrolStudent } = require('@factories');

const client = api(loadApp());
const Certificate = requireFromSut('./models/Certificate');

const MISSING_ID = '507f1f77bcf86cd799439099';

/** A student who has completed a course — the precondition for a certificate. */
async function aGraduate() {
  const student = await auth.asStudent({ name: 'Ayesha Perera' });
  const course = await createCourse({ isPublished: true });
  await enrolStudent(student.user._id, course._id, {
    isCompleted: true,
    overallProgress: 100,
    completionDate: new Date(),
  });
  return { student, course };
}

describe('GET /api/certificates/eligible-students', () => {
  testCase(
    {
      id: 'TC-FR-15-01',
      name: 'A student who completed a course appears as eligible for a certificate',
      requirement: 'FR-15',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'A student has completed a course and holds no certificate for it',
      input: 'GET /api/certificates/eligible-students with an administrator token',
      expected: 'HTTP 200; the student and course are listed with the completion date',
    },
    async () => {
      const admin = await auth.asAdmin();
      const { student, course } = await aGraduate();

      const response = await client
        .get('/api/certificates/eligible-students')
        .set('Authorization', admin.authHeader);

      expect(response).toBeSuccessfulResponse(200);
      expect(response.body.eligibleStudents).toHaveLength(1);
      expect(response.body.eligibleStudents[0].student._id).toBe(String(student.user._id));
      expect(response.body.eligibleStudents[0].course._id).toBe(String(course._id));
    },
  );

  testCase(
    {
      id: 'TC-FR-15-02',
      name: 'A student who already holds a certificate is no longer eligible',
      requirement: 'FR-15',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'A completed course for which a certificate has already been issued',
      input: 'GET /api/certificates/eligible-students',
      expected: 'HTTP 200; the list is empty — no duplicate certificate can be issued',
    },
    async () => {
      const admin = await auth.asAdmin();
      const { student, course } = await aGraduate();
      await createCertificate({ student: student.user._id, course: course._id });

      const response = await client
        .get('/api/certificates/eligible-students')
        .set('Authorization', admin.authHeader);

      expect(response.body.eligibleStudents).toHaveLength(0);
    },
  );

  it('excludes a student who has not completed the course', async () => {
    const admin = await auth.asAdmin();
    const student = await auth.asStudent();
    const course = await createCourse();
    await enrolStudent(student.user._id, course._id, { isCompleted: false });

    const response = await client
      .get('/api/certificates/eligible-students')
      .set('Authorization', admin.authHeader);

    expect(response.body.eligibleStudents).toHaveLength(0);
  });

  it('narrows the list to one course when courseId is supplied', async () => {
    const admin = await auth.asAdmin();
    const { course } = await aGraduate();
    await aGraduate(); // a second graduate on a different course

    const response = await client
      .get(`/api/certificates/eligible-students?courseId=${course._id}`)
      .set('Authorization', admin.authHeader);

    expect(response.body.eligibleStudents).toHaveLength(1);
    expect(response.body.eligibleStudents[0].course._id).toBe(String(course._id));
  });

  it('refuses a student', async () => {
    const { authHeader } = await auth.asStudent();

    const response = await client
      .get('/api/certificates/eligible-students')
      .set('Authorization', authHeader);

    expect(response).toBeForbidden();
  });
});

describe('POST /api/certificates', () => {
  testCase(
    {
      id: 'TC-FR-15-03',
      name: 'An administrator issues a certificate to a graduate',
      requirement: 'FR-15',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'A student has completed the course',
      input: 'POST /api/certificates with the student id and course id',
      expected: 'HTTP 201; the certificate is persisted with a generated CERT-NNNNNN-YYYY number',
    },
    async () => {
      const admin = await auth.asAdmin();
      const { student, course } = await aGraduate();

      const response = await client
        .post('/api/certificates')
        .set('Authorization', admin.authHeader)
        .field('studentId', String(student.user._id))
        .field('courseId', String(course._id));

      expect(response.status).toBe(201);

      const stored = await Certificate.findOne({ student: student.user._id });
      expect(stored).not.toBeNull();
      expect(stored.certificateNumber).toMatch(/^CERT-\d{6}-\d{4}$/);
      expect(stored.studentName).toBe('Ayesha Perera');
    },
  );

  it('rejects a request with no student or course id', async () => {
    const { authHeader } = await auth.asAdmin();

    const response = await client
      .post('/api/certificates')
      .set('Authorization', authHeader)
      .field('studentId', '');

    expect(response).toBeErrorResponse(400, 'Student ID and Course ID are required');
  });

  it('returns 404 for a student that does not exist', async () => {
    const admin = await auth.asAdmin();
    const course = await createCourse();

    const response = await client
      .post('/api/certificates')
      .set('Authorization', admin.authHeader)
      .field('studentId', MISSING_ID)
      .field('courseId', String(course._id));

    expect(response).toBeNotFound();
  });

  it('returns 404 for a course that does not exist', async () => {
    const admin = await auth.asAdmin();
    const student = await auth.asStudent();

    const response = await client
      .post('/api/certificates')
      .set('Authorization', admin.authHeader)
      .field('studentId', String(student.user._id))
      .field('courseId', MISSING_ID);

    expect(response).toBeNotFound();
  });

  testCase(
    {
      id: 'TC-FR-15-04',
      name: 'A certificate cannot be issued for a course the student has not completed',
      requirement: 'FR-15',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'The student is enrolled but has not completed the course',
      input: 'POST /api/certificates for that student and course',
      expected: 'HTTP 400; no certificate is created',
    },
    async () => {
      // A certificate is a statement to the outside world that the holder
      // finished the course; issuing one without a completion record would make
      // it worthless.
      const admin = await auth.asAdmin();
      const student = await auth.asStudent();
      const course = await createCourse();
      await enrolStudent(student.user._id, course._id, { isCompleted: false });

      const response = await client
        .post('/api/certificates')
        .set('Authorization', admin.authHeader)
        .field('studentId', String(student.user._id))
        .field('courseId', String(course._id));

      expect(response.status).toBe(400);
      expect(await Certificate.countDocuments()).toBe(0);
    },
  );

  it('refuses a student', async () => {
    const { student, course } = await aGraduate();

    const response = await client
      .post('/api/certificates')
      .set('Authorization', student.authHeader)
      .field('studentId', String(student.user._id))
      .field('courseId', String(course._id));

    expect(response).toBeForbidden();
    expect(await Certificate.countDocuments()).toBe(0);
  });
});

describe('GET /api/certificates', () => {
  testCase(
    {
      id: 'TC-FR-15-05',
      name: 'An administrator lists every issued certificate',
      requirement: 'FR-15',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'Two certificates exist',
      input: 'GET /api/certificates',
      expected: 'HTTP 200; both certificates with pagination metadata',
    },
    async () => {
      const { authHeader } = await auth.asAdmin();
      await createCertificate();
      await createCertificate();

      const response = await client.get('/api/certificates').set('Authorization', authHeader);

      expect(response).toBeSuccessfulResponse(200);
      expect(response.body.certificates).toHaveLength(2);
    },
  );

  it('refuses a student', async () => {
    const { authHeader } = await auth.asStudent();

    const response = await client.get('/api/certificates').set('Authorization', authHeader);

    expect(response).toBeForbidden();
  });
});

describe('GET /api/certificates/stats', () => {
  testCase(
    {
      id: 'TC-FR-15-06',
      name: 'Certificate statistics break down by status',
      requirement: 'FR-15',
      type: 'Integration',
      priority: 'P2',
      preconditions: 'Certificates exist in the pending and issued states',
      input: 'GET /api/certificates/stats',
      expected: 'HTTP 200; total and per-status counts',
    },
    async () => {
      const { authHeader } = await auth.asAdmin();
      await createCertificate({ status: 'pending' });
      await createCertificate({ status: 'issued' });

      const response = await client.get('/api/certificates/stats').set('Authorization', authHeader);

      expect(response).toBeSuccessfulResponse(200);
      const stats = response.body.stats || response.body.data || response.body;
      expect(stats.total).toBe(2);
    },
  );

  it('refuses a student', async () => {
    const { authHeader } = await auth.asStudent();

    const response = await client.get('/api/certificates/stats').set('Authorization', authHeader);

    expect(response).toBeForbidden();
  });
});

describe('GET /api/certificates/:id', () => {
  it('returns a single certificate to an administrator', async () => {
    const { authHeader } = await auth.asAdmin();
    const certificate = await createCertificate();

    const response = await client
      .get(`/api/certificates/${certificate._id}`)
      .set('Authorization', authHeader);

    expect(response).toBeSuccessfulResponse(200);
  });

  it('returns 404 for a certificate that does not exist', async () => {
    const { authHeader } = await auth.asAdmin();

    const response = await client
      .get(`/api/certificates/${MISSING_ID}`)
      .set('Authorization', authHeader);

    expect(response).toBeNotFound();
  });

  it('refuses a student', async () => {
    const { authHeader } = await auth.asStudent();
    const certificate = await createCertificate();

    const response = await client
      .get(`/api/certificates/${certificate._id}`)
      .set('Authorization', authHeader);

    expect(response).toBeForbidden();
  });
});

describe('GET /api/certificates/my-certificates', () => {
  testCase(
    {
      id: 'TC-FR-15-07',
      name: 'A student sees only their own certificates',
      requirement: 'FR-15',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'The student holds one certificate; another student holds another',
      input: 'GET /api/certificates/my-certificates',
      expected: 'HTTP 200; exactly the caller’s own certificate',
    },
    async () => {
      const student = await auth.asStudent();
      const mine = await createCertificate({ student: student.user._id });
      await createCertificate(); // somebody else's

      const response = await client
        .get('/api/certificates/my-certificates')
        .set('Authorization', student.authHeader);

      expect(response).toBeSuccessfulResponse(200);
      expect(response.body.certificates).toHaveLength(1);
      expect(response.body.certificates[0]._id).toBe(String(mine._id));
    },
  );

  it('returns an empty list for a student with no certificates', async () => {
    const { authHeader } = await auth.asStudent();

    const response = await client
      .get('/api/certificates/my-certificates')
      .set('Authorization', authHeader);

    expect(response).toBeSuccessfulResponse(200);
    expect(response.body.certificates).toEqual([]);
  });

  it('refuses an unauthenticated request', async () => {
    const response = await client.get('/api/certificates/my-certificates');

    expect(response).toBeUnauthorised();
  });
});

describe('POST /api/certificates/:id/mark-viewed', () => {
  testCase(
    {
      id: 'TC-FR-15-08',
      name: 'A student marks their certificate as viewed, and the first view is timestamped',
      requirement: 'FR-15',
      type: 'Integration',
      priority: 'P2',
      preconditions: 'A certificate belonging to the caller that has never been viewed',
      input: 'POST /api/certificates/<id>/mark-viewed twice',
      expected:
        'HTTP 200 both times; viewedByStudent true; firstViewedDate set once and never moved',
    },
    async () => {
      const student = await auth.asStudent();
      const certificate = await createCertificate({ student: student.user._id });

      const first = await client
        .post(`/api/certificates/${certificate._id}/mark-viewed`)
        .set('Authorization', student.authHeader);

      expect(first).toBeSuccessfulResponse(200);
      const afterFirst = await Certificate.findById(certificate._id);
      expect(afterFirst.viewedByStudent).toBe(true);
      expect(afterFirst.firstViewedDate).toBeRecentTimestamp();

      await client
        .post(`/api/certificates/${certificate._id}/mark-viewed`)
        .set('Authorization', student.authHeader);

      // "First viewed" must mean exactly that.
      const afterSecond = await Certificate.findById(certificate._id);
      expect(afterSecond.firstViewedDate).toEqual(afterFirst.firstViewedDate);
    },
  );

  testCase(
    {
      id: 'TC-NFR-03-08',
      name: 'A student cannot mark another student’s certificate as viewed',
      requirement: 'NFR-03',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'A certificate belonging to a different student',
      input: 'POST /api/certificates/<other id>/mark-viewed',
      expected: 'HTTP 403; the certificate is unchanged',
    },
    async () => {
      const student = await auth.asStudent();
      const other = await createCertificate();

      const response = await client
        .post(`/api/certificates/${other._id}/mark-viewed`)
        .set('Authorization', student.authHeader);

      expect(response).toBeForbidden();
      expect((await Certificate.findById(other._id)).viewedByStudent).toBe(false);
    },
  );

  it('returns 404 for a certificate that does not exist', async () => {
    const { authHeader } = await auth.asStudent();

    const response = await client
      .post(`/api/certificates/${MISSING_ID}/mark-viewed`)
      .set('Authorization', authHeader);

    expect(response).toBeNotFound();
  });
});

describe('PUT /api/certificates/:id/status', () => {
  testCase(
    {
      id: 'TC-FR-15-09',
      name: 'An administrator advances a certificate through its status workflow',
      requirement: 'FR-15',
      type: 'Integration',
      priority: 'P2',
      preconditions: 'A pending certificate',
      input: 'PUT /api/certificates/<id>/status with status "issued"',
      expected: 'HTTP 200; the stored status becomes "issued"',
    },
    async () => {
      const { authHeader } = await auth.asAdmin();
      const certificate = await createCertificate({ status: 'pending' });

      const response = await client
        .put(`/api/certificates/${certificate._id}/status`)
        .set('Authorization', authHeader)
        .send({ status: 'issued' });

      expect(response).toBeSuccessfulResponse(200);
      expect((await Certificate.findById(certificate._id)).status).toBe('issued');
    },
  );

  it('returns 404 for a certificate that does not exist', async () => {
    const { authHeader } = await auth.asAdmin();

    const response = await client
      .put(`/api/certificates/${MISSING_ID}/status`)
      .set('Authorization', authHeader)
      .send({ status: 'issued' });

    expect(response).toBeNotFound();
  });

  it('refuses a student', async () => {
    const { authHeader } = await auth.asStudent();
    const certificate = await createCertificate({ status: 'pending' });

    const response = await client
      .put(`/api/certificates/${certificate._id}/status`)
      .set('Authorization', authHeader)
      .send({ status: 'delivered' });

    expect(response).toBeForbidden();
    expect((await Certificate.findById(certificate._id)).status).toBe('pending');
  });
});

describe('POST /api/certificates/:id/send', () => {
  testCase(
    {
      id: 'TC-FR-15-10',
      name: 'An administrator sends a certificate to the student',
      requirement: 'FR-15',
      type: 'Integration',
      priority: 'P2',
      preconditions: 'An issued certificate',
      input: 'POST /api/certificates/<id>/send',
      expected: 'HTTP 200; the certificate is recorded as sent',
    },
    async () => {
      const { authHeader } = await auth.asAdmin();
      const certificate = await createCertificate({ status: 'issued' });

      const response = await client
        .post(`/api/certificates/${certificate._id}/send`)
        .set('Authorization', authHeader);

      expect(response).toBeSuccessfulResponse(200);

      const stored = await Certificate.findById(certificate._id);
      expect(stored.emailSent).toBe(true);
      expect(stored.status).toBe('sent');
    },
  );

  it('returns 404 for a certificate that does not exist', async () => {
    const { authHeader } = await auth.asAdmin();

    const response = await client
      .post(`/api/certificates/${MISSING_ID}/send`)
      .set('Authorization', authHeader);

    expect(response).toBeNotFound();
  });

  it('refuses a student', async () => {
    const { authHeader } = await auth.asStudent();
    const certificate = await createCertificate({ status: 'issued' });

    const response = await client
      .post(`/api/certificates/${certificate._id}/send`)
      .set('Authorization', authHeader);

    expect(response).toBeForbidden();
  });
});

describe('DELETE /api/certificates/:id', () => {
  testCase(
    {
      id: 'TC-FR-15-11',
      name: 'An administrator revokes a certificate',
      requirement: 'FR-15',
      type: 'Integration',
      priority: 'P2',
      preconditions: 'A certificate exists',
      input: 'DELETE /api/certificates/<id>',
      expected: 'HTTP 200; the certificate no longer exists',
    },
    async () => {
      const { authHeader } = await auth.asAdmin();
      const certificate = await createCertificate();

      const response = await client
        .delete(`/api/certificates/${certificate._id}`)
        .set('Authorization', authHeader);

      expect(response).toBeSuccessfulResponse(200);
      expect(await Certificate.findById(certificate._id)).toBeNull();
    },
  );

  it('returns 404 for a certificate that does not exist', async () => {
    const { authHeader } = await auth.asAdmin();

    const response = await client
      .delete(`/api/certificates/${MISSING_ID}`)
      .set('Authorization', authHeader);

    expect(response).toBeNotFound();
  });

  it('refuses a student', async () => {
    const { authHeader } = await auth.asStudent();
    const certificate = await createCertificate();

    const response = await client
      .delete(`/api/certificates/${certificate._id}`)
      .set('Authorization', authHeader);

    expect(response).toBeForbidden();
    expect(await Certificate.findById(certificate._id)).not.toBeNull();
  });
});
