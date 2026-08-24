import { AuditLog } from '../models/auditLog.model.js';
import { recordAudit } from '../services/audit.service.js';
import syslogClient from '../config/syslog.js';
import env from '../config/env.js';
import { asyncHandler, notFound } from '../utils/errors.js';
import { parsePagination, paginated } from '../utils/pagination.js';

const buildFilter = (query) => {
  const filter = {};
  if (query.action) filter.action = query.action;
  if (query.category) filter.category = query.category;
  if (query.outcome) filter.outcome = query.outcome;
  if (query.actor) filter['actor.username'] = query.actor;
  if (query.from || query.to) {
    filter.createdAt = {};
    if (query.from) filter.createdAt.$gte = query.from;
    if (query.to) filter.createdAt.$lte = query.to;
  }
  if (query.q) {
    const rx = new RegExp(query.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ message: rx }, { action: rx }, { 'actor.username': rx }, { 'target.name': rx }, { 'context.ip': rx }];
  }
  return filter;
};

export const listAuditLogs = asyncHandler(async (req, res) => {
  const query = req.validatedQuery || {};
  const { page, limit, skip } = parsePagination(query, { defaultLimit: 50 });
  const filter = buildFilter(query);
  const [items, total] = await Promise.all([
    AuditLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    AuditLog.countDocuments(filter),
  ]);
  res.json(paginated(items, total, { page, limit }));
});

export const getAuditLog = asyncHandler(async (req, res) => {
  const entry = await AuditLog.findById(req.params.id).lean();
  if (!entry) throw notFound('Audit entry not found');
  res.json({ entry });
});

export const auditFacets = asyncHandler(async (_req, res) => {
  const [actions, categories, actors] = await Promise.all([
    AuditLog.distinct('action'),
    AuditLog.distinct('category'),
    AuditLog.aggregate([
      { $group: { _id: '$actor.username', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 25 },
    ]),
  ]);
  res.json({
    actions: actions.sort(),
    categories: categories.sort(),
    actors: actors.map(({ _id, count }) => ({ username: _id, count })),
  });
});

/** CSV export for evidence packs; the export itself is audited. */
export const exportAuditLogs = asyncHandler(async (req, res) => {
  const query = req.validatedQuery || {};
  const filter = buildFilter(query);
  const entries = await AuditLog.find(filter).sort({ createdAt: -1 }).limit(50_000).lean();
  const columns = [
    ['createdAt', (e) => e.createdAt?.toISOString()],
    ['eventId', (e) => e.eventId],
    ['action', (e) => e.action],
    ['category', (e) => e.category],
    ['outcome', (e) => e.outcome],
    ['severity', (e) => e.severity],
    ['actor', (e) => e.actor?.username],
    ['actorRole', (e) => e.actor?.role],
    ['targetType', (e) => e.target?.type],
    ['targetName', (e) => e.target?.name],
    ['ip', (e) => e.context?.ip],
    ['requestId', (e) => e.context?.requestId],
    ['statusCode', (e) => e.context?.statusCode],
    ['message', (e) => e.message],
  ];
  const escape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const csv = [
    columns.map(([name]) => name).join(','),
    ...entries.map((entry) => columns.map(([, get]) => escape(get(entry))).join(',')),
  ].join('\n');

  await recordAudit({
    action: 'audit.exported',
    category: 'data_access',
    outcome: 'success',
    actor: req.user,
    context: { ip: req.ip, userAgent: req.get('user-agent'), requestId: req.id, method: req.method, path: req.path },
    message: `${req.user.username} exported ${entries.length} audit record(s)`,
    metadata: { filter: query, count: entries.length },
  });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="audit-${Date.now()}.csv"`);
  res.send(csv);
});

export const syslogStatus = asyncHandler(async (_req, res) => {
  const [forwarded, total] = await Promise.all([
    AuditLog.countDocuments({ forwardedToSyslog: true }),
    AuditLog.countDocuments({}),
  ]);
  res.json({
    ...syslogClient.stats(),
    retentionDays: env.audit.retentionDays,
    persisted: total,
    forwarded,
    unforwarded: total - forwarded,
  });
});

/** Sends a probe record so operators can confirm the collector is wired up. */
export const testSyslog = asyncHandler(async (req, res) => {
  const event = await recordAudit({
    action: 'system.syslog.test',
    category: 'system',
    outcome: 'success',
    actor: req.user,
    context: { ip: req.ip, userAgent: req.get('user-agent'), requestId: req.id, method: req.method, path: req.path },
    message: `Syslog connectivity probe sent by ${req.user.username}`,
    metadata: { target: syslogClient.stats().target },
  });
  res.json({ sent: syslogClient.enabled, event, stats: syslogClient.stats() });
});
