import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';

// No Mongo or Redis is required here: this suite proves the HTTP surface wires
// up (every route/controller module imports cleanly) and that the security
// middleware is applied, which is the check most likely to catch a bad refactor.
vi.mock('../src/queues/index.js', () => ({
  QUEUE_NAMES: { scan: 'scan', email: 'email', maintenance: 'maintenance' },
  getQueue: () => ({ getJob: async () => null, getJobCounts: async () => ({}) }),
  enqueueScan: async () => ({ id: 'job-1' }),
  enqueueEmail: async () => ({ id: 'mail-1' }),
  queueStats: async () => ({}),
  scanQueue: () => ({}),
  emailQueue: () => ({}),
  maintenanceQueue: () => ({}),
  closeQueues: async () => {},
}));

describe('HTTP surface', () => {
  let app;

  beforeAll(async () => {
    const { createApp } = await import('../src/app.js');
    app = createApp();
  });

  it('answers the liveness probe without a database', async () => {
    const response = await request(app).get('/api/v1/system/health/live');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'ok' });
  });

  it('exposes the enabled sign-in methods without authentication', async () => {
    const response = await request(app).get('/api/v1/system/auth-methods');
    expect(response.status).toBe(200);
    expect(response.body.methods).toMatchObject({ local: true, ldap: false });
    // The public endpoint must not leak directory or relay hostnames.
    expect(JSON.stringify(response.body)).not.toMatch(/ldap:\/\/|ldaps:\/\/|smtp/i);
  });

  it('advertises the API root', async () => {
    const response = await request(app).get('/');
    expect(response.status).toBe(200);
    expect(response.body.api).toBe('/api/v1');
  });

  it('returns a correlation id on every response', async () => {
    const response = await request(app).get('/api/v1/system/health/live');
    expect(response.headers['x-request-id']).toMatch(/[0-9a-f-]{36}/);
  });

  it('echoes a caller-supplied correlation id', async () => {
    const response = await request(app).get('/api/v1/system/health/live').set('x-request-id', 'trace-123');
    expect(response.headers['x-request-id']).toBe('trace-123');
  });

  it('sets hardening headers and hides the framework', async () => {
    const response = await request(app).get('/api/v1/system/health/live');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('requires authentication on protected routes', async () => {
    for (const path of ['/api/v1/applications', '/api/v1/scans', '/api/v1/findings', '/api/v1/audit-logs', '/api/v1/users']) {
      // eslint-disable-next-line no-await-in-loop
      const response = await request(app).get(path);
      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('missing_token');
    }
  });

  it('rejects a forged bearer token', async () => {
    const response = await request(app).get('/api/v1/applications').set('Authorization', 'Bearer not.a.jwt');
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('invalid_token');
  });

  it('validates the login payload before touching the database', async () => {
    const response = await request(app).post('/api/v1/auth/login').send({ username: '' });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('bad_request');
    expect(response.body.error.details.map((detail) => detail.field)).toContain('password');
  });

  it('returns a structured 404 for unknown routes', async () => {
    const response = await request(app).get('/api/v1/nope');
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('not_found');
    expect(response.body.error.requestId).toBeTruthy();
  });
});
