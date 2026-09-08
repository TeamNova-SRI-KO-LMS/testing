/**
 * Integration tests — system settings.
 *
 * Endpoints: GET /api/admin/settings[/:section|/export/json];
 *            PUT /api/admin/settings[/:section];
 *            POST /api/admin/settings/reset, /import.
 *
 * Requirements: FR-22 (System Settings), FR-05 (RBAC).
 */

'use strict';

const { loadApp } = require('@support/app');
const { api } = require('@support/api-client');
const { testCase } = require('@support/test-case');
const { requireFromSut } = require('@support/sut');
const auth = require('@support/auth');

const client = api(loadApp());
const Settings = requireFromSut('./models/Settings');

describe('GET /api/admin/settings', () => {
  testCase(
    {
      id: 'TC-FR-22-01',
      name: 'The first read creates and returns the default settings document',
      requirement: 'FR-22',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'No settings document exists',
      input: 'GET /api/admin/settings with an administrator token',
      expected: 'HTTP 200; a settings document with the documented defaults; exactly one is stored',
    },
    async () => {
      const admin = await auth.asAdmin();

      const response = await client
        .get('/api/admin/settings')
        .set('Authorization', admin.authHeader);

      expect(response).toBeSuccessfulResponse(200);
      expect(response.body.settings.siteName).toBe('SRI-KO LMS');
      // Settings are a singleton: a second document would make behaviour depend
      // on which one `findOne` happened to return.
      expect(await Settings.countDocuments()).toBe(1);
    },
  );

  it('does not create a second document on a subsequent read', async () => {
    const admin = await auth.asAdmin();

    await client.get('/api/admin/settings').set('Authorization', admin.authHeader);
    await client.get('/api/admin/settings').set('Authorization', admin.authHeader);

    expect(await Settings.countDocuments()).toBe(1);
  });

  testCase(
    {
      id: 'TC-FR-05-07',
      name: 'A student cannot read the system settings',
      requirement: 'FR-05',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'An authenticated student',
      input: 'GET /api/admin/settings with a student token',
      expected: 'HTTP 403; no settings returned',
    },
    async () => {
      const { authHeader } = await auth.asStudent();

      const response = await client.get('/api/admin/settings').set('Authorization', authHeader);

      expect(response).toBeForbidden();
      expect(response.body.settings).toBeUndefined();
    },
  );

  it('refuses an unauthenticated request', async () => {
    const response = await client.get('/api/admin/settings');

    expect(response).toBeUnauthorised();
  });
});

describe('PUT /api/admin/settings', () => {
  testCase(
    {
      id: 'TC-FR-22-02',
      name: 'An administrator updates the settings and the change is attributed to them',
      requirement: 'FR-22',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'A settings document exists',
      input: 'PUT /api/admin/settings with a new siteName',
      expected: 'HTTP 200; the value is persisted and lastUpdatedBy names the administrator',
    },
    async () => {
      const admin = await auth.asAdmin();
      await client.get('/api/admin/settings').set('Authorization', admin.authHeader);

      const response = await client
        .put('/api/admin/settings')
        .set('Authorization', admin.authHeader)
        .send({ siteName: 'SRI-KO Korean Academy' });

      expect(response).toBeSuccessfulResponse(200);

      const stored = await Settings.findOne();
      expect(stored.siteName).toBe('SRI-KO Korean Academy');
      // Configuration changes need an audit trail.
      expect(String(stored.lastUpdatedBy)).toBe(admin.id);
    },
  );

  it('creates the document when none exists yet', async () => {
    const admin = await auth.asAdmin();

    const response = await client
      .put('/api/admin/settings')
      .set('Authorization', admin.authHeader)
      .send({ siteName: 'Created By Update' });

    expect(response).toBeSuccessfulResponse(200);
    expect(await Settings.countDocuments()).toBe(1);
  });

  it('refuses a student', async () => {
    const { authHeader } = await auth.asStudent();

    const response = await client
      .put('/api/admin/settings')
      .set('Authorization', authHeader)
      .send({ siteName: 'Hijacked Site Name' });

    expect(response).toBeForbidden();
    expect(await Settings.countDocuments()).toBe(0);
  });
});

describe('GET and PUT /api/admin/settings/:section', () => {
  testCase(
    {
      id: 'TC-FR-22-03',
      name: 'A single settings section can be read on its own',
      requirement: 'FR-22',
      type: 'Integration',
      priority: 'P2',
      preconditions: 'A settings document exists',
      input: 'GET /api/admin/settings/securitySettings',
      expected: 'HTTP 200; the section name and its data',
    },
    async () => {
      const admin = await auth.asAdmin();
      await client.get('/api/admin/settings').set('Authorization', admin.authHeader);

      const response = await client
        .get('/api/admin/settings/securitySettings')
        .set('Authorization', admin.authHeader);

      expect(response).toBeSuccessfulResponse(200);
      expect(response.body.section).toBe('securitySettings');
      expect(response.body.data).toBeDefined();
    },
  );

  it('returns 404 for a section that does not exist', async () => {
    const admin = await auth.asAdmin();
    await client.get('/api/admin/settings').set('Authorization', admin.authHeader);

    const response = await client
      .get('/api/admin/settings/nonexistentSection')
      .set('Authorization', admin.authHeader);

    expect(response).toBeNotFound();
  });

  testCase(
    {
      id: 'TC-FR-22-04',
      name: 'A single settings section can be updated on its own',
      requirement: 'FR-22',
      type: 'Integration',
      priority: 'P2',
      preconditions: 'A settings document exists',
      input: 'PUT /api/admin/settings/maintenanceSettings with a new maintenance message',
      expected: 'HTTP 200; the section is persisted',
    },
    async () => {
      const admin = await auth.asAdmin();
      await client.get('/api/admin/settings').set('Authorization', admin.authHeader);

      const response = await client
        .put('/api/admin/settings/maintenanceSettings')
        .set('Authorization', admin.authHeader)
        .send({ maintenanceMessage: 'Back at 09:00' });

      expect(response).toBeSuccessfulResponse(200);
      expect((await Settings.findOne()).maintenanceSettings.maintenanceMessage).toBe(
        'Back at 09:00',
      );
    },
  );

  it('refuses a student on both section endpoints', async () => {
    const { authHeader } = await auth.asStudent();

    expect(
      await client.get('/api/admin/settings/securitySettings').set('Authorization', authHeader),
    ).toBeForbidden();
    expect(
      await client
        .put('/api/admin/settings/securitySettings')
        .set('Authorization', authHeader)
        .send({ twoFactorAuth: false }),
    ).toBeForbidden();
  });
});

describe('POST /api/admin/settings/reset', () => {
  testCase(
    {
      id: 'TC-FR-22-05',
      name: 'Resetting restores the default settings and leaves one document',
      requirement: 'FR-22',
      type: 'Integration',
      priority: 'P2',
      preconditions: 'The settings have been customised',
      input: 'POST /api/admin/settings/reset',
      expected: 'HTTP 200; siteName is back to "SRI-KO LMS"; exactly one document remains',
    },
    async () => {
      const admin = await auth.asAdmin();
      await client
        .put('/api/admin/settings')
        .set('Authorization', admin.authHeader)
        .send({ siteName: 'Customised Name' });

      const response = await client
        .post('/api/admin/settings/reset')
        .set('Authorization', admin.authHeader);

      expect(response).toBeSuccessfulResponse(200);
      expect((await Settings.findOne()).siteName).toBe('SRI-KO LMS');
      expect(await Settings.countDocuments()).toBe(1);
    },
  );

  it('refuses a student', async () => {
    const admin = await auth.asAdmin();
    await client
      .put('/api/admin/settings')
      .set('Authorization', admin.authHeader)
      .send({ siteName: 'Customised Name' });
    const student = await auth.asStudent();

    const response = await client
      .post('/api/admin/settings/reset')
      .set('Authorization', student.authHeader);

    expect(response).toBeForbidden();
    expect((await Settings.findOne()).siteName).toBe('Customised Name');
  });
});

describe('settings export and import', () => {
  testCase(
    {
      id: 'TC-FR-22-06',
      name: 'Settings can be exported and re-imported',
      requirement: 'FR-22',
      type: 'Integration',
      priority: 'P2',
      preconditions: 'The settings have been customised',
      input: 'GET /api/admin/settings/export/json, then POST /api/admin/settings/import',
      expected: 'HTTP 200 for both; the imported value is persisted',
    },
    async () => {
      const admin = await auth.asAdmin();
      await client
        .put('/api/admin/settings')
        .set('Authorization', admin.authHeader)
        .send({ siteName: 'Exported Academy' });

      const exported = await client
        .get('/api/admin/settings/export/json')
        .set('Authorization', admin.authHeader);

      expect(exported).toBeSuccessfulResponse(200);

      await client.post('/api/admin/settings/reset').set('Authorization', admin.authHeader);

      const imported = await client
        .post('/api/admin/settings/import')
        .set('Authorization', admin.authHeader)
        .send({ settings: { siteName: 'Exported Academy' } });

      expect(imported.status).toBeGreaterThanOrEqual(200);
      expect(imported.status).toBeLessThan(300);
      expect((await Settings.findOne()).siteName).toBe('Exported Academy');
    },
  );

  it('refuses a student on export', async () => {
    const { authHeader } = await auth.asStudent();

    const response = await client
      .get('/api/admin/settings/export/json')
      .set('Authorization', authHeader);

    expect(response).toBeForbidden();
  });

  it('refuses a student on import', async () => {
    const { authHeader } = await auth.asStudent();

    const response = await client
      .post('/api/admin/settings/import')
      .set('Authorization', authHeader)
      .send({ settings: { siteName: 'Hijacked' } });

    expect(response).toBeForbidden();
  });

  it('resolves "export" as a literal path rather than as a section name', async () => {
    // `/:section` is declared before `/export/json`, but the extra path segment
    // keeps them distinct. A single-segment `/export` route would be shadowed.
    const admin = await auth.asAdmin();

    const response = await client
      .get('/api/admin/settings/export/json')
      .set('Authorization', admin.authHeader);

    expect(response.status).toBe(200);
    expect(response.body.section).toBeUndefined();
  });
});
