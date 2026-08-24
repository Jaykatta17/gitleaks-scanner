import os from 'node:os';
import mongoose from 'mongoose';
import env from '../config/env.js';
import { Setting } from '../models/setting.model.js';
import { mongoHealth } from '../db/mongoose.js';
import { redisHealth } from '../queues/connection.js';
import { queueStats } from '../queues/index.js';
import { verifySmtp, sendTemplateMail } from '../services/mail.service.js';
import { testLdapConnection } from '../services/ldap.service.js';
import syslogClient from '../config/syslog.js';
import { recordAudit } from '../services/audit.service.js';
import { asyncHandler } from '../utils/errors.js';

export const liveness = (_req, res) => res.json({ status: 'ok', uptimeSeconds: Math.round(process.uptime()) });

/** Readiness fails (503) when a hard dependency is down, so orchestrators can pull the pod. */
export const readiness = asyncHandler(async (_req, res) => {
  const [mongo, redis] = await Promise.all([Promise.resolve(mongoHealth()), redisHealth()]);
  const ready = mongo.status === 'connected' && redis.status === 'connected';
  res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'degraded', mongo, redis });
});

export const health = asyncHandler(async (_req, res) => {
  const [redis, queues, smtp, ldap] = await Promise.all([
    redisHealth(),
    queueStats().catch((error) => ({ error: error.message })),
    verifySmtp().catch((error) => ({ ok: false, message: error.message })),
    env.ldap.enabled ? testLdapConnection().catch((error) => ({ ok: false, message: error.message })) : Promise.resolve({ ok: false, enabled: false }),
  ]);
  res.json({
    app: {
      name: env.appName,
      env: env.nodeEnv,
      version: process.env.npm_package_version || '1.0.0',
      node: process.version,
      uptimeSeconds: Math.round(process.uptime()),
      host: os.hostname(),
      memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    },
    mongo: { ...mongoHealth(), collections: Object.keys(mongoose.connection.collections).length },
    redis,
    queues,
    smtp,
    ldap,
    syslog: syslogClient.stats(),
    scanner: { driver: env.scanner.driver, image: env.scanner.gitleaksImage },
  });
});

/**
 * Public, deliberately minimal: the sign-in screen needs to know which methods
 * to offer before anyone is authenticated. No hostnames, no policy internals.
 */
export const authMethods = (_req, res) =>
  res.json({
    appName: env.appName,
    methods: {
      local: true,
      ldap: env.ldap.enabled,
    },
    passwordMinLength: env.security.passwordMinLength,
    mfaMandatoryForAdmins: env.security.requireMfaForAdmins,
  });

/** Effective, non-secret configuration — what the settings screen renders. */
export const configuration = asyncHandler(async (_req, res) => {
  const overrides = await Setting.find({}).lean();
  res.json({
    auth: {
      ldapEnabled: env.ldap.enabled,
      ldapUrl: env.ldap.enabled ? env.ldap.url : null,
      ldapSearchBase: env.ldap.searchBase,
      ldapRoleMappings: env.ldap.roleMappings,
      passwordMinLength: env.security.passwordMinLength,
      passwordHistory: env.security.passwordHistory,
      maxFailedLogins: env.security.maxFailedLogins,
      lockoutMinutes: env.security.lockoutMinutes,
      requireMfaForAdmins: env.security.requireMfaForAdmins,
      accessTokenTtl: env.jwt.accessTtl,
      refreshTokenDays: env.jwt.refreshTtlDays,
    },
    smtp: {
      enabled: env.smtp.enabled,
      host: env.smtp.host,
      port: env.smtp.port,
      secure: env.smtp.secure,
      from: env.smtp.from,
      authenticated: Boolean(env.smtp.user),
    },
    syslog: {
      enabled: env.syslog.enabled,
      host: env.syslog.host,
      port: env.syslog.port,
      protocol: env.syslog.protocol,
      facility: env.syslog.facility,
      rfc: env.syslog.rfc,
      retentionDays: env.audit.retentionDays,
    },
    scanner: {
      driver: env.scanner.driver,
      image: env.scanner.gitleaksImage,
      cloneDepth: env.scanner.cloneDepth,
      timeoutMs: env.scanner.timeoutMs,
      redactSecrets: env.scanner.redactSecrets,
    },
    queue: {
      scanConcurrency: env.queue.scanConcurrency,
      emailConcurrency: env.queue.emailConcurrency,
      attempts: env.queue.attempts,
    },
    overrides,
  });
});

export const upsertSetting = asyncHandler(async (req, res) => {
  const { key, value, description } = req.body;
  const setting = await Setting.findOneAndUpdate(
    { key },
    { $set: { value, description: description ?? '', updatedBy: req.user._id } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
  await recordAudit({
    action: 'settings.updated',
    category: 'configuration',
    outcome: 'success',
    actor: req.user,
    target: { type: 'setting', id: setting._id, name: key },
    context: { ip: req.ip, userAgent: req.get('user-agent'), requestId: req.id, method: req.method, path: req.path },
    message: `${req.user.username} updated setting ${key}`,
    metadata: { key, value },
  });
  res.json({ setting });
});

export const testSmtp = asyncHandler(async (req, res) => {
  const to = req.body.to;
  const result = await sendTemplateMail({
    to,
    template: 'securityAlert',
    subject: `${env.appName} SMTP test`,
    data: {
      title: 'SMTP test message',
      summary: `This message confirms that ${env.appName} can deliver mail through the configured relay.`,
      details: { Host: env.smtp.host, Port: env.smtp.port, 'Triggered by': req.user.username, 'Sent at': new Date().toISOString() },
    },
  });
  await recordAudit({
    action: 'settings.smtp.tested',
    category: 'configuration',
    outcome: 'success',
    actor: req.user,
    context: { ip: req.ip, userAgent: req.get('user-agent'), requestId: req.id, method: req.method, path: req.path },
    message: `${req.user.username} sent an SMTP test message to ${to}`,
    metadata: { to, simulated: result.simulated },
  });
  res.json(result);
});

export const testLdap = asyncHandler(async (req, res) => {
  const result = await testLdapConnection();
  await recordAudit({
    action: 'settings.ldap.tested',
    category: 'configuration',
    outcome: result.ok ? 'success' : 'failure',
    actor: req.user,
    context: { ip: req.ip, userAgent: req.get('user-agent'), requestId: req.id, method: req.method, path: req.path },
    message: `${req.user.username} tested the directory connection (${result.ok ? 'reachable' : 'unreachable'})`,
    metadata: result,
  });
  res.json(result);
});
