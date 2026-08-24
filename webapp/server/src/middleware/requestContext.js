import crypto from 'node:crypto';
import logger from '../config/logger.js';

/** Assigns a correlation id used by logs, audit records and syslog structured data. */
export const requestContext = (req, res, next) => {
  const incoming = req.get('x-request-id');
  req.id = incoming && /^[\w.-]{1,64}$/.test(incoming) ? incoming : crypto.randomUUID();
  req.startedAt = Date.now();
  res.setHeader('x-request-id', req.id);
  req.log = logger.child({ requestId: req.id });
  next();
};

export const httpLogger = (req, res, next) => {
  res.on('finish', () => {
    const durationMs = Date.now() - req.startedAt;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'http';
    logger[level]('http request', {
      event: 'http.request',
      requestId: req.id,
      method: req.method,
      path: req.originalUrl.split('?')[0],
      status: res.statusCode,
      durationMs,
      ip: req.ip,
      actor: req.user?.username,
    });
  });
  next();
};

export default requestContext;
