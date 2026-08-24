import { Scan } from '../models/scan.model.js';
import { Finding } from '../models/finding.model.js';
import { Project } from '../models/project.model.js';
import { queueScanForProject } from '../services/scan.service.js';
import { recordAudit } from '../services/audit.service.js';
import { getQueue, QUEUE_NAMES } from '../queues/index.js';
import { asyncHandler, badRequest, notFound } from '../utils/errors.js';
import { parsePagination, buildSort, paginated } from '../utils/pagination.js';

const contextOf = (req) => ({
  ip: req.ip,
  userAgent: req.get('user-agent'),
  requestId: req.id,
  method: req.method,
  path: req.originalUrl.split('?')[0],
});

export const listScans = asyncHandler(async (req, res) => {
  const query = req.validatedQuery || {};
  const { page, limit, skip } = parsePagination(query);
  const filter = {};
  if (query.status) filter.status = query.status;
  if (query.projectId) filter.project = query.projectId;
  if (query.from || query.to) {
    filter.createdAt = {};
    if (query.from) filter.createdAt.$gte = query.from;
    if (query.to) filter.createdAt.$lte = query.to;
  }
  const sort = buildSort(query.sort, ['createdAt', 'finishedAt', 'summary.total', 'status']);
  const [items, total] = await Promise.all([
    Scan.find(filter).sort(sort).skip(skip).limit(limit).select('-logs').lean({ virtuals: true }),
    Scan.countDocuments(filter),
  ]);
  res.json(paginated(items, total, { page, limit }));
});

export const getScan = asyncHandler(async (req, res) => {
  const scan = await Scan.findOne({ scanId: req.params.scanId }).lean({ virtuals: true });
  if (!scan) throw notFound('Scan not found');
  const [findings, breakdown] = await Promise.all([
    Finding.find({ scan: scan._id }).sort({ severity: 1, file: 1 }).limit(500).lean(),
    Finding.aggregate([{ $match: { scan: scan._id } }, { $group: { _id: '$severity', count: { $sum: 1 } } }]),
  ]);
  res.json({
    scan,
    findings,
    breakdown: Object.fromEntries(breakdown.map(({ _id, count }) => [_id, count])),
  });
});

export const createScan = asyncHandler(async (req, res) => {
  const scan = await queueScanForProject({ ...req.body, user: req.user });
  await recordAudit({
    action: 'scan.queued',
    category: 'scan',
    outcome: 'success',
    actor: req.user,
    target: { type: 'scan', id: scan.scanId, name: scan.projectKey },
    context: contextOf(req),
    message: `${req.user.username} queued scan ${scan.scanId} for ${scan.projectKey} (${scan.branch})`,
    metadata: { branch: scan.branch, commitId: scan.commitId, trigger: scan.trigger },
  });
  res.status(202).json({ scan });
});

export const createBulkScans = asyncHandler(async (req, res) => {
  const results = [];
  for (const projectId of req.body.projectIds) {
    try {
      // Sequential on purpose: keeps queue ordering stable and bounds Mongo load.
      // eslint-disable-next-line no-await-in-loop
      const scan = await queueScanForProject({ projectId, trigger: req.body.trigger, user: req.user });
      results.push({ projectId, scanId: scan.scanId, status: 'queued' });
    } catch (error) {
      results.push({ projectId, status: 'failed', error: error.message });
    }
  }
  await recordAudit({
    action: 'scan.bulk_queued',
    category: 'scan',
    outcome: results.every((r) => r.status === 'queued') ? 'success' : 'failure',
    actor: req.user,
    context: contextOf(req),
    message: `${req.user.username} queued ${results.filter((r) => r.status === 'queued').length}/${results.length} scans`,
    metadata: { results },
  });
  res.status(202).json({ results });
});

export const cancelScan = asyncHandler(async (req, res) => {
  const scan = await Scan.findOne({ scanId: req.params.scanId });
  if (!scan) throw notFound('Scan not found');
  if (!['queued', 'running'].includes(scan.status)) throw badRequest(`Scan is already ${scan.status}`);

  if (scan.jobId) {
    const job = await getQueue(QUEUE_NAMES.scan).getJob(scan.jobId);
    // A running job is left to finish its current step; only waiting jobs are removed.
    if (job && (await job.isWaiting())) await job.remove();
  }
  scan.status = 'cancelled';
  scan.finishedAt = new Date();
  scan.logs.push({ level: 'warn', message: `Cancelled by ${req.user.username}` });
  await scan.save();
  await Project.updateOne({ _id: scan.project }, { $set: { 'stats.lastScanStatus': 'cancelled' } });

  await recordAudit({
    action: 'scan.cancelled',
    category: 'scan',
    outcome: 'success',
    actor: req.user,
    target: { type: 'scan', id: scan.scanId, name: scan.projectKey },
    context: contextOf(req),
    message: `${req.user.username} cancelled scan ${scan.scanId}`,
  });
  res.json({ scan });
});

export const retryScan = asyncHandler(async (req, res) => {
  const previous = await Scan.findOne({ scanId: req.params.scanId });
  if (!previous) throw notFound('Scan not found');
  const scan = await queueScanForProject({
    projectId: previous.project,
    branch: previous.branch,
    commitId: previous.commitId,
    trigger: 'manual',
    user: req.user,
  });
  await recordAudit({
    action: 'scan.retried',
    category: 'scan',
    outcome: 'success',
    actor: req.user,
    target: { type: 'scan', id: scan.scanId, name: scan.projectKey },
    context: contextOf(req),
    message: `${req.user.username} retried ${previous.scanId} as ${scan.scanId}`,
    metadata: { previousScanId: previous.scanId },
  });
  res.status(202).json({ scan });
});
