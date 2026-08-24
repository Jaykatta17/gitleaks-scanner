import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import env from '../config/env.js';
import { recordAudit } from '../services/audit.service.js';

const onLimitReached = (action) => async (req, _res, _next, options) => {
  await recordAudit({
    action,
    category: 'authentication',
    outcome: 'denied',
    actor: req.user || { username: req.body?.username || 'anonymous' },
    context: { ip: req.ip, userAgent: req.get('user-agent'), requestId: req.id, method: req.method, path: req.path },
    message: `Rate limit exceeded for ${req.originalUrl}`,
    metadata: { limit: options.limit, windowMs: options.windowMs },
  });
  _res.status(options.statusCode).json({ error: { code: 'rate_limited', message: options.message } });
};

const base = { standardHeaders: 'draft-7', legacyHeaders: false, skip: () => env.isTest };

export const apiLimiter = rateLimit({
  ...base,
  windowMs: 60_000,
  limit: 300,
  message: 'Too many requests, slow down.',
  handler: onLimitReached('ratelimit.api'),
});

export const loginLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60_000,
  limit: 10,
  // Per account+IP so one noisy office NAT cannot lock out an entire floor.
  keyGenerator: (req) => `${ipKeyGenerator(req.ip)}:${String(req.body?.username || '').toLowerCase()}`,
  message: 'Too many sign-in attempts. Try again later.',
  handler: onLimitReached('ratelimit.login'),
});

export const passwordResetLimiter = rateLimit({
  ...base,
  windowMs: 60 * 60_000,
  limit: 5,
  message: 'Too many password reset requests.',
  handler: onLimitReached('ratelimit.password_reset'),
});

export const scanLimiter = rateLimit({
  ...base,
  windowMs: 60_000,
  limit: 30,
  keyGenerator: (req) => String(req.user?._id || ipKeyGenerator(req.ip)),
  message: 'Scan submission rate exceeded.',
  handler: onLimitReached('ratelimit.scan'),
});
