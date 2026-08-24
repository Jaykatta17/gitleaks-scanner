import crypto from 'node:crypto';
import { AuditLog } from '../models/auditLog.model.js';
import syslogClient, { SEVERITY, buildStructuredData } from '../config/syslog.js';
import logger, { redact } from '../config/logger.js';

const SEVERITY_BY_OUTCOME = { success: SEVERITY.info, failure: SEVERITY.warning, denied: SEVERITY.warning };

/** Actions that are always escalated regardless of outcome. */
const HIGH_SIGNAL_ACTIONS = new Set([
  'auth.login.failed',
  'auth.account.locked',
  'user.role.changed',
  'user.deleted',
  'user.disabled',
  'settings.updated',
  'finding.status.changed',
  'auth.mfa.disabled',
]);

const severityFor = (action, outcome) => {
  if (outcome === 'failure' || outcome === 'denied') return SEVERITY.warning;
  if (HIGH_SIGNAL_ACTIONS.has(action)) return SEVERITY.notice;
  return SEVERITY_BY_OUTCOME[outcome] ?? SEVERITY.info;
};

const severityLabel = (code) =>
  ({ [SEVERITY.warning]: 'warning', [SEVERITY.notice]: 'notice', [SEVERITY.error]: 'error' })[code] || 'info';

export const buildAuditEvent = ({
  action,
  category = 'system',
  outcome = 'success',
  actor = {},
  target = {},
  context = {},
  message = '',
  metadata = {},
}) => ({
  eventId: crypto.randomUUID(),
  action,
  category,
  outcome,
  severity: severityLabel(severityFor(action, outcome)),
  actor: {
    id: actor.id ?? actor._id,
    username: actor.username || 'anonymous',
    displayName: actor.displayName || '',
    role: actor.role || '',
    authProvider: actor.authProvider || '',
  },
  target: { type: target.type || '', id: target.id ? String(target.id) : '', name: target.name || '' },
  context: {
    ip: context.ip || '',
    userAgent: (context.userAgent || '').slice(0, 256),
    requestId: context.requestId || '',
    method: context.method || '',
    path: context.path || '',
    statusCode: context.statusCode,
    durationMs: context.durationMs,
  },
  message: message || `${action} (${outcome})`,
  metadata: redact(metadata),
});

/** Emits one RFC 5424 record per audit event so the SIEM has the same trail as Mongo. */
export const forwardToSyslog = (event) => {
  if (!syslogClient.enabled) return false;
  return syslogClient.send({
    severity: severityFor(event.action, event.outcome),
    msgId: event.action,
    structuredData:
      buildStructuredData('audit@32473', {
        eventId: event.eventId,
        category: event.category,
        outcome: event.outcome,
        actor: event.actor.username,
        actorRole: event.actor.role,
        authProvider: event.actor.authProvider,
        targetType: event.target.type,
        targetId: event.target.id,
        targetName: event.target.name,
      }) +
      buildStructuredData('origin@32473', {
        ip: event.context.ip,
        requestId: event.context.requestId,
        method: event.context.method,
        path: event.context.path,
        statusCode: event.context.statusCode,
      }),
    message: `${event.message}${Object.keys(event.metadata || {}).length ? ` ${JSON.stringify(event.metadata)}` : ''}`,
  });
};

/**
 * Records an audit event. Never throws: a failure to audit must be visible in
 * the application log but must not break the user-facing request.
 */
export const recordAudit = async (input) => {
  const event = buildAuditEvent(input);
  let forwarded = false;
  try {
    forwarded = forwardToSyslog(event);
  } catch (error) {
    logger.error('syslog forward failed', { event: 'audit.syslog_failed', error: error.message });
  }
  try {
    await AuditLog.create({ ...event, forwardedToSyslog: forwarded });
  } catch (error) {
    logger.error('audit persist failed', { event: 'audit.persist_failed', action: event.action, error: error.message });
  }
  return event;
};

export default recordAudit;
