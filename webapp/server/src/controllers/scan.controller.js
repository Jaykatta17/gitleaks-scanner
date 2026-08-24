import { Scan } from '../models/scan.model.js';
import { Finding } from '../models/finding.model.js';
import { Application } from '../models/application.model.js';
import { queueScanForApplication, queueScansForBranches } from '../services/scan.service.js';
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
  if (query.applicationId) filter.application = query.applicationId;
  if (query.branch) filter.branch = query.branch;
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
  const scan = await queueScanForApplication({ ...req.body, user: req.user });
  await recordAudit({
    action: 'scan.queued',
    category: 'scan',
    outcome: 'success',
    actor: req.user,
    target: { type: 'scan', id: scan.scanId, name: `${scan.applicationKey}@${scan.branch}` },
    context: contextOf(req),
    message: `${req.user.username} queued scan ${scan.scanId} for ${scan.applicationKey} on branch ${scan.branch}`,
    metadata: { branch: scan.branch, commitId: scan.commitId, trigger: scan.trigger },
  });
  res.status(202).json({ scan });
});

export const createBulkScans = asyncHandler(async (req, res) => {
  const { applicationIds, applicationId, branches, allBranches, trigger } = req.body;

  if (applicationId) {
    const { application, results } = await queueScansForBranches({
      applicationId,
      branches,
      allBranches,
      trigger,
      user: req.user,
    });
    const queued = results.filter((result) => result.status === 'queued').length;
    await recordAudit({
      action: 'scan.bulk_queued',
      category: 'scan',
      outcome: queued === results.length ? 'success' : 'failure',
      actor: req.user,
      target: { type: 'application', id: application._id, name: application.key },
      context: contextOf(req),
      message: `${req.user.username} queued ${queued}/${results.length} branch scan(s) for ${application.key}`,
      metadata: { applicationKey: application.key, results },
    });
    return res.status(202).json({ applicationKey: application.key, results });
  }

  const results = [];
  for (const id of applicationIds) {
    try {
      // Sequential on purpose: keeps queue ordering stable and bounds Mongo load.
      // eslint-disable-next-line no-await-in-loop
      const scan = await queueScanForApplication({ applicationId: id, trigger, user: req.user });
      results.push({ applicationId: id, applicationKey: scan.applicationKey, branch: scan.branch, scanId: scan.scanId, status: 'queued' });
    } catch (error) {
      results.push({ applicationId: id, status: 'failed', error: error.message });
    }
  }
  await recordAudit({
    action: 'scan.bulk_queued',
    category: 'scan',
    outcome: results.every((result) => result.status === 'queued') ? 'success' : 'failure',
    actor: req.user,
    context: contextOf(req),
    message: `${req.user.username} queued ${results.filter((result) => result.status === 'queued').length}/${results.length} scans`,
    metadata: { results },
  });
  return res.status(202).json({ results });
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
  await Application.updateOne(
    { _id: scan.application, 'branches.name': scan.branch },
    { $set: { 'stats.lastScanStatus': 'cancelled', 'branches.$.stats.lastScanStatus': 'cancelled' } },
  );

  await recordAudit({
    action: 'scan.cancelled',
    category: 'scan',
    outcome: 'success',
    actor: req.user,
    target: { type: 'scan', id: scan.scanId, name: `${scan.applicationKey}@${scan.branch}` },
    context: contextOf(req),
    message: `${req.user.username} cancelled scan ${scan.scanId} (${scan.applicationKey} on ${scan.branch})`,
  });
  res.json({ scan });
});

export const retryScan = asyncHandler(async (req, res) => {
  const previous = await Scan.findOne({ scanId: req.params.scanId });
  if (!previous) throw notFound('Scan not found');
  const scan = await queueScanForApplication({
    applicationId: previous.application,
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
    target: { type: 'scan', id: scan.scanId, name: `${scan.applicationKey}@${scan.branch}` },
    context: contextOf(req),
    message: `${req.user.username} retried ${previous.scanId} as ${scan.scanId} (${scan.applicationKey} on ${scan.branch})`,
    metadata: { previousScanId: previous.scanId },
  });
  res.status(202).json({ scan });
});
