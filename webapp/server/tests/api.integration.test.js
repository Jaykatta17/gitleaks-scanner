import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { startTestMongo, stopTestMongo, clearCollections } from './helpers/mongo.js';

// The queue is exercised separately; here we only assert that the API enqueues.
const enqueued = { scans: [], emails: [] };
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
  let Project;
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
    ({ Project } = await import('../src/models/project.model.js'));
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
    it('denies project creation to viewers and records the denial', async () => {
      await createUser({ username: 'viewer', email: 'viewer@sentinel.local', role: 'viewer' });
      const { body } = await signIn('viewer');
      const response = await request(app)
        .post('/api/v1/projects')
        .set('Authorization', `Bearer ${body.accessToken}`)
        .send({ key: 'PAY', name: 'Payments', repoUrl: 'https://github.com/acme/pay.git', maintainerEmail: 'a@b.com' });

      expect(response.status).toBe(403);
      const denial = await AuditLog.findOne({ action: 'authz.denied' });
      expect(denial.outcome).toBe('denied');
      expect(denial.metadata.actualRole).toBe('viewer');
    });

    it('lets an analyst create a project and audits it', async () => {
      await createUser({ username: 'analyst', email: 'analyst@sentinel.local', role: 'security_analyst' });
      const { body } = await signIn('analyst');
      const response = await request(app)
        .post('/api/v1/projects')
        .set('Authorization', `Bearer ${body.accessToken}`)
        .send({ key: 'pay', name: 'Payments API', repoUrl: 'https://github.com/acme/pay.git', maintainerEmail: 'lead@corp.local' });

      expect(response.status).toBe(201);
      expect(response.body.project.key).toBe('PAY');
      expect(await AuditLog.exists({ action: 'project.created' })).toBeTruthy();
    });

    it('stops the last administrator from being demoted', async () => {
      const admin = await createUser();
      const other = await createUser({ username: 'dev', email: 'dev@sentinel.local', role: 'developer' });
      const { body } = await signIn('admin');
      const response = await request(app)
        .patch(`/api/v1/users/${admin._id}`)
        .set('Authorization', `Bearer ${body.accessToken}`)
        .send({ role: 'viewer' });
      expect(response.status).toBe(400);
      expect(other.role).toBe('developer');
    });
  });

  describe('scans', () => {
    it('queues a scan and stores it as queued', async () => {
      await createUser();
      const { body } = await signIn('admin');
      const project = await Project.create({
        key: 'PAY',
        name: 'Payments API',
        repoUrl: 'https://github.com/acme/pay.git',
        maintainerEmail: 'lead@corp.local',
      });

      const response = await request(app)
        .post('/api/v1/scans')
        .set('Authorization', `Bearer ${body.accessToken}`)
        .send({ projectId: String(project._id) });

      expect(response.status).toBe(202);
      expect(response.body.scan.status).toBe('queued');
      expect(response.body.scan.scanId).toMatch(/^GLS-\d{8}-[A-Z0-9]{6}$/);
      expect(enqueued.scans).toHaveLength(1);
      expect(enqueued.scans[0].repoUrl).toBe(project.repoUrl);
      expect(await AuditLog.exists({ action: 'scan.queued' })).toBeTruthy();
    });

    it('rejects an invalid project id with a field-level error', async () => {
      await createUser();
      const { body } = await signIn('admin');
      const response = await request(app)
        .post('/api/v1/scans')
        .set('Authorization', `Bearer ${body.accessToken}`)
        .send({ projectId: 'not-an-id' });
      expect(response.status).toBe(400);
      expect(response.body.error.details[0].field).toBe('projectId');
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
