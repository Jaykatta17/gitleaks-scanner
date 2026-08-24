import { Finding } from '../models/finding.model.js';
import { refreshApplicationStats } from './application.controller.js';
import { recordAudit } from '../services/audit.service.js';
import { asyncHandler, notFound } from '../utils/errors.js';
import { parsePagination, buildSort, paginated } from '../utils/pagination.js';

const contextOf = (req) => ({
  ip: req.ip,
  userAgent: req.get('user-agent'),
  requestId: req.id,
  method: req.method,
  path: req.originalUrl.split('?')[0],
});

export const listFindings = asyncHandler(async (req, res) => {
  const query = req.validatedQuery || {};
  const { page, limit, skip } = parsePagination(query);
  const filter = {};
  if (query.severity) filter.severity = query.severity;
  if (query.status) filter.status = query.status;
  if (query.applicationId) filter.application = query.applicationId;
  if (query.branch) filter.branch = query.branch;
  if (query.scanId) filter.scanId = query.scanId;
  if (query.ruleId) filter.ruleId = query.ruleId;
  if (query.q) {
    const rx = new RegExp(query.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ file: rx }, { ruleId: rx }, { description: rx }, { author: rx }];
  }
  const sort = buildSort(query.sort, ['createdAt', 'severity', 'file', 'ruleId', 'lastSeenAt']);
  const [items, total] = await Promise.all([
    Finding.find(filter).sort(sort).skip(skip).limit(limit).populate('triage.assignee', 'username displayName').lean({ virtuals: true }),
    Finding.countDocuments(filter),
  ]);
  res.json(paginated(items, total, { page, limit }));
});

export const getFinding = asyncHandler(async (req, res) => {
  const finding = await Finding.findById(req.params.id)
    .populate('application', 'key name repository hod spoc')
    .populate('triage.assignee', 'username displayName email')
    .lean({ virtuals: true });
  if (!finding) throw notFound('Finding not found');
  // The same secret can be present on several branches; show every sighting.
  const history = await Finding.find({ fingerprint: finding.fingerprint })
    .sort({ createdAt: -1 })
    .limit(20)
    .select('scanId branch status severity createdAt')
    .lean();
  res.json({ finding, history });
});

export const updateFinding = asyncHandler(async (req, res) => {
  const finding = await Finding.findById(req.params.id);
  if (!finding) throw notFound('Finding not found');
  const before = { status: finding.status, severity: finding.severity };

  if (req.body.status) finding.status = req.body.status;
  if (req.body.severity) finding.severity = req.body.severity;
  if (req.body.assignee !== undefined) finding.triage.assignee = req.body.assignee;
  if (req.body.note !== undefined) finding.triage.note = req.body.note;
  finding.triage.updatedBy = req.user._id;
  finding.triage.updatedAt = new Date();
  await finding.save();
  await refreshApplicationStats(finding.application);

  if (before.status !== finding.status || before.severity !== finding.severity) {
    await recordAudit({
      action: 'finding.status.changed',
      category: 'finding',
      outcome: 'success',
      actor: req.user,
      target: { type: 'finding', id: finding._id, name: `${finding.applicationKey}/${finding.ruleId}` },
      context: contextOf(req),
      message: `${req.user.username} moved ${finding.ruleId} in ${finding.file} (${finding.applicationKey}@${finding.branch}) from ${before.status} to ${finding.status}`,
      metadata: { ...before, newStatus: finding.status, newSeverity: finding.severity, scanId: finding.scanId },
    });
  }
  res.json({ finding });
});

export const bulkUpdateFindings = asyncHandler(async (req, res) => {
  const { ids, status, note } = req.body;
  const findings = await Finding.find({ _id: { $in: ids } }).select('application');
  const result = await Finding.updateMany(
    { _id: { $in: ids } },
    {
      $set: {
        status,
        'triage.note': note ?? '',
        'triage.updatedBy': req.user._id,
        'triage.updatedAt': new Date(),
      },
    },
  );
  const affected = new Map(findings.map((finding) => [String(finding.application), finding.application]));
  await Promise.all([...affected.values()].map(refreshApplicationStats));

  await recordAudit({
    action: 'finding.bulk_updated',
    category: 'finding',
    outcome: 'success',
    actor: req.user,
    context: contextOf(req),
    message: `${req.user.username} set ${result.modifiedCount} finding(s) to ${status}`,
    metadata: { count: result.modifiedCount, status },
  });
  res.json({ modified: result.modifiedCount });
});

export const exportFindings = asyncHandler(async (req, res) => {
  const query = req.validatedQuery || {};
  const filter = {};
  if (query.severity) filter.severity = query.severity;
  if (query.status) filter.status = query.status;
  if (query.applicationId) filter.application = query.applicationId;
  if (query.branch) filter.branch = query.branch;
  if (query.scanId) filter.scanId = query.scanId;

  const findings = await Finding.find(filter).sort({ createdAt: -1 }).limit(20_000).lean();
  const columns = [
    'applicationKey',
    'branch',
    'scanId',
    'ruleId',
    'severity',
    'status',
    'file',
    'startLine',
    'commit',
    'author',
    'secretPreview',
    'createdAt',
  ];
  const escape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const csv = [columns.join(','), ...findings.map((row) => columns.map((column) => escape(row[column])).join(','))].join('\n');

  await recordAudit({
    action: 'finding.exported',
    category: 'data_access',
    outcome: 'success',
    actor: req.user,
    context: contextOf(req),
    message: `${req.user.username} exported ${findings.length} finding(s) to CSV`,
    metadata: { filter: query, count: findings.length },
  });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="findings-${Date.now()}.csv"`);
  res.send(csv);
});
