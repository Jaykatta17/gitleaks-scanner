import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { startTestMongo, stopTestMongo, clearCollections } from './helpers/mongo.js';

// The queue is exercised separately; here we only assert that the API enqueues.
const enqueued = { scans: [], emails: [] };

const APPLICATION = {
  key: 'PAY',
  name: 'Payments API',
  repository: { url: 'https://github.com/acme/payments.git', defaultBranch: 'main', provider: 'github' },
  hod: { name: 'Meera Iyer', email: 'meera.iyer@corp.local', designation: 'Head of Payments' },
  spoc: { name: 'Arjun Kumar', email: 'arjun.kumar@corp.local', phone: '+91 98450 11223' },
};
vi.mock('../src/queues/index.js', () => ({
  QUEUE_NAMES: { scan: 'scan', email: 'email', maintenance: 'maintenance' },
  getQueue: () => ({ getJob: async () => null, getJobCounts: async () => ({}) }),
  enqueueScan: async (payload) => {
    enqueued.scans.push(payload);
    return { id: `job-${enqueued.scans.length}` };
  },
  enqueueEmail: async (payload) => {
    enqueued.emails.push(payload);
    return { id: `mail-${enqueued.emails.length}` };
  },
  queueStats: async () => ({ scan: { waiting: 0, active: 0 } }),
  scanQueue: () => ({}),
  emailQueue: () => ({}),
  maintenanceQueue: () => ({}),
  closeQueues: async () => {},
}));

const mongo = await startTestMongo();
const describeIfMongo = mongo ? describe : describe.skip;

if (!mongo) {
  // eslint-disable-next-line no-console
  console.warn('[skip] No MongoDB available — set MONGO_TEST_URI to run the API integration suite.');
}

describeIfMongo('API integration', () => {
  let app;
  let User;
  let Application;
  let AuditLog;
  const PASSWORD = 'Sentinel-Test-2026!';

  const signIn = async (username, password = PASSWORD, extra = {}) =>
    request(app).post('/api/v1/auth/login').send({ username, password, ...extra });

  const createUser = async (overrides = {}) => {
    const user = new User({
      username: 'admin',
      email: 'admin@sentinel.local',
      displayName: 'Admin',
      role: 'admin',
      authProvider: 'local',
      status: 'active',
      ...overrides,
    });
    await user.setPassword(overrides.password || PASSWORD);
    await user.save();
    return user;
  };

  beforeAll(async () => {
    const { createApp } = await import('../src/app.js');
    app = createApp();
    ({ User } = await import('../src/models/user.model.js'));
    ({ Application } = await import('../src/models/application.model.js'));
    ({ AuditLog } = await import('../src/models/auditLog.model.js'));
  });

  afterAll(async () => {
    await stopTestMongo();
  });

  beforeEach(async () => {
    await clearCollections();
    enqueued.scans.length = 0;
    enqueued.emails.length = 0;
  });

  describe('authentication', () => {
    it('issues an access token and audits the sign-in', async () => {
      await createUser();
      const response = await signIn('admin');
      expect(response.status).toBe(200);
      expect(response.body.accessToken).toBeTruthy();
      expect(response.body.user.passwordHash).toBeUndefined();

      const audit = await AuditLog.findOne({ action: 'auth.login.success' });
      expect(audit.actor.username).toBe('admin');
      expect(audit.context.ip).toBeTruthy();
    });

    it('rejects a wrong password without revealing whether the account exists', async () => {
      await createUser();
      const known = await signIn('admin', 'wrong-password');
      const unknown = await signIn('ghost', 'wrong-password');
      expect(known.status).toBe(401);
      expect(unknown.status).toBe(401);
      expect(known.body.error.message).toBe(unknown.body.error.message);

      const failures = await AuditLog.find({ action: 'auth.login.failed' }).lean();
      expect(failures).toHaveLength(2);
      expect(failures.every((entry) => entry.outcome === 'failure')).toBe(true);
    });

    it('locks the account after the configured number of failures', async () => {
      await createUser();
      for (let attempt = 0; attempt < 5; attempt += 1) {
        // eslint-disable-next-line no-await-in-loop
        await signIn('admin', 'wrong-password');
      }
      const locked = await signIn('admin');
      expect(locked.status).toBe(403);
      expect(await AuditLog.exists({ action: 'auth.account.locked' })).toBeTruthy();
      expect(enqueued.emails.some((mail) => mail.template === 'securityAlert')).toBe(true);
    });

    it('rotates refresh tokens and revokes the family on replay', async () => {
      await createUser();
      const { body } = await signIn('admin');
      const first = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: body.refreshToken });
      expect(first.status).toBe(200);
      expect(first.body.refreshToken).not.toBe(body.refreshToken);

      const replay = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: body.refreshToken });
      expect(replay.status).toBe(401);
      expect(replay.body.error.code).toBe('refresh_replay');

      const rotatedAgain = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: first.body.refreshToken });
      expect(rotatedAgain.status).toBe(401);
    });

    it('refuses protected routes without a token', async () => {
      const response = await request(app).get('/api/v1/projects');
      expect(response.status).toBe(401);
    });
  });

  describe('authorisation', () => {
    it('denies application registration to viewers and records the denial', async () => {
      await createUser({ username: 'viewer', email: 'viewer@sentinel.local', role: 'viewer' });
      const { body } = await signIn('viewer');
      const response = await request(app)
        .post('/api/v1/applications')
        .set('Authorization', `Bearer ${body.accessToken}`)
        .send(APPLICATION);

      expect(response.status).toBe(403);
      const denial = await AuditLog.findOne({ action: 'authz.denied' });
      expect(denial.outcome).toBe('denied');
      expect(denial.metadata.actualRole).toBe('viewer');
    });

    it('stops the last administrator from being demoted', async () => {
      const admin = await createUser();
      await createUser({ username: 'dev', email: 'dev@sentinel.local', role: 'developer' });
      const { body } = await signIn('admin');
      const response = await request(app)
        .patch(`/api/v1/users/${admin._id}`)
        .set('Authorization', `Bearer ${body.accessToken}`)
        .send({ role: 'viewer' });
      expect(response.status).toBe(400);
    });
  });

  describe('application registration', () => {
    const register = async (token, overrides = {}) =>
      request(app)
        .post('/api/v1/applications')
        .set('Authorization', `Bearer ${token}`)
        .send({ ...APPLICATION, ...overrides });

    it('records the application with its HOD, SPOC and repository details', async () => {
      await createUser({ username: 'analyst', email: 'analyst@sentinel.local', role: 'security_analyst' });
      const { body } = await signIn('analyst');
      const response = await register(body.accessToken, { key: 'pay' });

      expect(response.status).toBe(201);
      expect(response.body.application).toMatchObject({
        key: 'PAY',
        hod: { name: 'Meera Iyer', email: 'meera.iyer@corp.local' },
        spoc: { name: 'Arjun Kumar' },
        repository: { url: 'https://github.com/acme/payments.git', provider: 'github' },
      });

      const audit = await AuditLog.findOne({ action: 'application.registered' });
      expect(audit.metadata.hod).toBe('meera.iyer@corp.local');
      expect(audit.metadata.spoc).toBe('arjun.kumar@corp.local');
    });

    it('always tracks the default branch, even when none were listed', async () => {
      await createUser();
      const { body } = await signIn('admin');
      const response = await register(body.accessToken);
      expect(response.body.application.branches).toHaveLength(1);
      expect(response.body.application.branches[0]).toMatchObject({ name: 'main', isDefault: true });
    });

    it('registers the branches supplied at registration time', async () => {
      await createUser();
      const { body } = await signIn('admin');
      const response = await register(body.accessToken, {
        branches: [
          { name: 'main', isDefault: true, environment: 'production' },
          { name: 'release/2.4', environment: 'release' },
          { name: 'develop', environment: 'development' },
        ],
      });
      expect(response.body.application.branches.map((branch) => branch.name)).toEqual([
        'main',
        'release/2.4',
        'develop',
      ]);
      expect(response.body.application.stats.branchCount).toBe(3);
    });

    it('does not invent a branch the caller did not ask for', async () => {
      await createUser();
      const { body } = await signIn('admin');
      const response = await register(body.accessToken, {
        repository: { url: 'https://github.com/acme/legacy.git', defaultBranch: 'main' },
        branches: [{ name: 'trunk', isDefault: true }, { name: 'legacy/2019' }],
      });
      expect(response.body.application.branches.map((branch) => branch.name)).toEqual(['trunk', 'legacy/2019']);
      // The repository's default follows the branch that was marked default.
      expect(response.body.application.repository.defaultBranch).toBe('trunk');
    });

    it('rejects a duplicate application key', async () => {
      await createUser();
      const { body } = await signIn('admin');
      await register(body.accessToken);
      const duplicate = await register(body.accessToken, { name: 'Another' });
      expect(duplicate.status).toBe(409);
    });

    it('rejects a registration without SPOC details', async () => {
      await createUser();
      const { body } = await signIn('admin');
      const { spoc, ...withoutSpoc } = APPLICATION;
      const response = await request(app)
        .post('/api/v1/applications')
        .set('Authorization', `Bearer ${body.accessToken}`)
        .send(withoutSpoc);
      expect(response.status).toBe(400);
      expect(response.body.error.details.some((detail) => detail.field.startsWith('spoc'))).toBe(true);
    });
  });

  describe('branch management', () => {
    let token;
    let applicationId;

    beforeEach(async () => {
      await createUser();
      ({ body: { accessToken: token } } = await signIn('admin'));
      const created = await request(app)
        .post('/api/v1/applications')
        .set('Authorization', `Bearer ${token}`)
        .send({ ...APPLICATION, branches: [{ name: 'main', isDefault: true }, { name: 'develop' }] });
      applicationId = created.body.application._id;
    });

    it('adds a branch and audits it', async () => {
      const response = await request(app)
        .post(`/api/v1/applications/${applicationId}/branches`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'release/2.4', environment: 'release' });

      expect(response.status).toBe(201);
      expect(response.body.application.branches.map((branch) => branch.name)).toContain('release/2.4');
      expect(await AuditLog.exists({ action: 'application.branch.added' })).toBeTruthy();
    });

    it('refuses a duplicate branch', async () => {
      const response = await request(app)
        .post(`/api/v1/applications/${applicationId}/branches`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'develop' });
      expect(response.status).toBe(409);
    });

    it('moves the default flag to exactly one branch', async () => {
      const response = await request(app)
        .patch(`/api/v1/applications/${applicationId}/branches/develop`)
        .set('Authorization', `Bearer ${token}`)
        .send({ isDefault: true });

      const defaults = response.body.application.branches.filter((branch) => branch.isDefault);
      expect(defaults).toHaveLength(1);
      expect(defaults[0].name).toBe('develop');
      expect(response.body.application.repository.defaultBranch).toBe('develop');
    });

    it('will not remove the default branch', async () => {
      const response = await request(app)
        .delete(`/api/v1/applications/${applicationId}/branches/main`)
        .set('Authorization', `Bearer ${token}`);
      expect(response.status).toBe(400);
    });

    it('removes a non-default branch', async () => {
      const response = await request(app)
        .delete(`/api/v1/applications/${applicationId}/branches/develop`)
        .set('Authorization', `Bearer ${token}`);
      expect(response.status).toBe(200);
      expect(response.body.application.branches.map((branch) => branch.name)).toEqual(['main']);
    });

    it('lists branches with their scan history', async () => {
      await request(app)
        .post('/api/v1/scans')
        .set('Authorization', `Bearer ${token}`)
        .send({ applicationId, branch: 'develop' });

      const response = await request(app)
        .get(`/api/v1/applications/${applicationId}/branches`)
        .set('Authorization', `Bearer ${token}`);

      const develop = response.body.branches.find((branch) => branch.name === 'develop');
      expect(develop.scanCount).toBe(1);
      expect(develop.lastScan.status).toBe('queued');
    });
  });

  describe('scans', () => {
    let token;
    let applicationId;

    beforeEach(async () => {
      await createUser();
      ({ body: { accessToken: token } } = await signIn('admin'));
      const created = await request(app)
        .post('/api/v1/applications')
        .set('Authorization', `Bearer ${token}`)
        .send({
          ...APPLICATION,
          branches: [
            { name: 'main', isDefault: true },
            { name: 'release/2.4' },
            { name: 'develop', scanEnabled: false },
          ],
        });
      applicationId = created.body.application._id;
    });

    it('queues a scan on the default branch when none is given', async () => {
      const response = await request(app)
        .post('/api/v1/scans')
        .set('Authorization', `Bearer ${token}`)
        .send({ applicationId });

      expect(response.status).toBe(202);
      expect(response.body.scan).toMatchObject({ status: 'queued', branch: 'main', applicationKey: 'PAY' });
      expect(response.body.scan.scanId).toMatch(/^GLS-\d{8}-[A-Z0-9]{6}$/);
      expect(enqueued.scans[0]).toMatchObject({ branch: 'main', spocEmail: 'arjun.kumar@corp.local' });
    });

    it('queues independent scans for different branches of the same application', async () => {
      const first = await request(app)
        .post('/api/v1/scans')
        .set('Authorization', `Bearer ${token}`)
        .send({ applicationId, branch: 'main' });
      const second = await request(app)
        .post('/api/v1/scans')
        .set('Authorization', `Bearer ${token}`)
        .send({ applicationId, branch: 'release/2.4' });

      expect(first.body.scan.scanId).not.toBe(second.body.scan.scanId);
      expect(enqueued.scans.map((job) => job.branch)).toEqual(['main', 'release/2.4']);

      const listed = await request(app)
        .get('/api/v1/scans')
        .query({ applicationId, branch: 'release/2.4' })
        .set('Authorization', `Bearer ${token}`);
      expect(listed.body.items).toHaveLength(1);
      expect(listed.body.items[0].branch).toBe('release/2.4');
    });

    it('fans out across selected branches in one request', async () => {
      const response = await request(app)
        .post('/api/v1/scans/bulk')
        .set('Authorization', `Bearer ${token}`)
        .send({ applicationId, branches: ['main', 'release/2.4'] });

      expect(response.status).toBe(202);
      expect(response.body.results.every((result) => result.status === 'queued')).toBe(true);
      expect(enqueued.scans).toHaveLength(2);
    });

    it('skips branches with scanning disabled when scanning them all', async () => {
      const response = await request(app)
        .post('/api/v1/scans/bulk')
        .set('Authorization', `Bearer ${token}`)
        .send({ applicationId, allBranches: true });

      expect(response.body.results.map((result) => result.branch)).toEqual(['main', 'release/2.4']);
    });

    it('registers a branch that is scanned ad hoc', async () => {
      await request(app)
        .post('/api/v1/scans')
        .set('Authorization', `Bearer ${token}`)
        .send({ applicationId, branch: 'hotfix/urgent' });

      const application = await Application.findById(applicationId);
      expect(application.findBranch('hotfix/urgent')).toBeTruthy();
    });

    it('refuses an ad-hoc branch when registration is turned off', async () => {
      const response = await request(app)
        .post('/api/v1/scans')
        .set('Authorization', `Bearer ${token}`)
        .send({ applicationId, branch: 'nope', registerBranch: false });
      expect(response.status).toBe(400);
    });

    it('tracks queued counters per branch', async () => {
      await request(app)
        .post('/api/v1/scans')
        .set('Authorization', `Bearer ${token}`)
        .send({ applicationId, branch: 'release/2.4' });

      const application = await Application.findById(applicationId);
      expect(application.findBranch('release/2.4').stats.totalScans).toBe(1);
      expect(application.findBranch('main').stats.totalScans).toBe(0);
    });

    it('rejects an invalid application id with a field-level error', async () => {
      const response = await request(app)
        .post('/api/v1/scans')
        .set('Authorization', `Bearer ${token}`)
        .send({ applicationId: 'not-an-id' });
      expect(response.status).toBe(400);
      expect(response.body.error.details[0].field).toBe('applicationId');
    });
  });

  describe('audit trail', () => {
    it('is readable by analysts and hidden from developers', async () => {
      await createUser({ username: 'analyst', email: 'analyst@sentinel.local', role: 'security_analyst' });
      await createUser({ username: 'dev', email: 'dev@sentinel.local', role: 'developer' });

      const analyst = await signIn('analyst');
      const developer = await signIn('dev');

      const allowed = await request(app).get('/api/v1/audit-logs').set('Authorization', `Bearer ${analyst.body.accessToken}`);
      const denied = await request(app).get('/api/v1/audit-logs').set('Authorization', `Bearer ${developer.body.accessToken}`);

      expect(allowed.status).toBe(200);
      expect(allowed.body.items.length).toBeGreaterThan(0);
      expect(denied.status).toBe(403);
    });

    it('never persists submitted passwords in the audit metadata', async () => {
      await createUser();
      const { body } = await signIn('admin');
      await request(app)
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${body.accessToken}`)
        .send({
          username: 'newbie',
          email: 'newbie@sentinel.local',
          displayName: 'New Bie',
          password: 'Another-Strong-Pass-1',
        });

      const entries = await AuditLog.find({}).lean();
      expect(JSON.stringify(entries)).not.toContain('Another-Strong-Pass-1');
      expect(JSON.stringify(entries)).not.toContain(PASSWORD);
    });
  });

  describe('health', () => {
    it('serves liveness without authentication', async () => {
      const response = await request(app).get('/api/v1/system/health/live');
      expect(response.status).toBe(200);
      expect(response.body.status).toBe('ok');
    });
  });
});
