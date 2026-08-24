import env from '../config/env.js';
import { recordAudit } from '../services/audit.service.js';

/**
 * Route-level audit decorator. Attach to any mutating endpoint:
 *
 *   router.post('/', auditAction('application.registered', 'application_management', {
 *     target: (req, res) => ({ type: 'application', id: res.locals.application?.id, name: req.body.key }),
 *   }), handler)
 *
 * The event is written after the response is flushed, with the real status code,
 * so the trail reflects what actually happened rather than what was attempted.
 */
export const auditAction = (action, category = 'system', options = {}) => (req, res, next) => {
  res.on('finish', () => {
    if (options.skip?.(req, res)) return;
    const outcome = res.statusCode < 400 ? 'success' : res.statusCode === 403 ? 'denied' : 'failure';
    const metadata = {
      ...(typeof options.metadata === 'function' ? options.metadata(req, res) : options.metadata || {}),
    };
    if (env.audit.logRequestBodies && options.includeBody !== false && req.method !== 'GET') {
      metadata.request = req.body;
    }
    const target = typeof options.target === 'function' ? options.target(req, res) : options.target || {};

    void recordAudit({
      action,
      category,
      outcome,
      actor: req.user || { username: req.body?.username || 'anonymous' },
      target,
      context: {
        ip: req.ip,
        userAgent: req.get('user-agent'),
        requestId: req.id,
        method: req.method,
        path: req.originalUrl.split('?')[0],
        statusCode: res.statusCode,
        durationMs: Date.now() - req.startedAt,
      },
      message: options.message
        ? typeof options.message === 'function'
          ? options.message(req, res)
          : options.message
        : `${action} by ${req.user?.username || 'anonymous'}`,
      metadata,
    });
  });
  next();
};

export default auditAction;
