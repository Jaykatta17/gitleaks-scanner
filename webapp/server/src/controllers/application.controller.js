import { Application } from '../models/application.model.js';
import { Scan } from '../models/scan.model.js';
import { Finding } from '../models/finding.model.js';
import { recordAudit } from '../services/audit.service.js';
import { asyncHandler, badRequest, conflict, notFound } from '../utils/errors.js';
import { parsePagination, buildSort, paginated } from '../utils/pagination.js';

const contextOf = (req) => ({
  ip: req.ip,
  userAgent: req.get('user-agent'),
  requestId: req.id,
  method: req.method,
  path: req.originalUrl.split('?')[0],
});

const OPEN_STATUSES = ['open', 'triaged'];

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Recomputes per-branch and whole-application finding counters from the findings collection. */
export const refreshApplicationStats = async (applicationId) => {
  const application = await Application.findById(applicationId);
  if (!application) return null;

  const [perBranch, overall] = await Promise.all([
    Finding.aggregate([
      { $match: { application: application._id, status: { $in: OPEN_STATUSES } } },
      {
        $group: {
          _id: '$branch',
          open: { $sum: 1 },
          critical: { $sum: { $cond: [{ $eq: ['$severity', 'critical'] }, 1, 0] } },
        },
      },
    ]),
    Finding.aggregate([
      { $match: { application: application._id, status: { $in: OPEN_STATUSES } } },
      {
        $group: {
          _id: null,
          open: { $sum: 1 },
          critical: { $sum: { $cond: [{ $eq: ['$severity', 'critical'] }, 1, 0] } },
        },
      },
    ]),
  ]);

  const byBranch = new Map(perBranch.map((row) => [row._id, row]));
  for (const branch of application.branches) {
    const counts = byBranch.get(branch.name);
    branch.stats.openFindings = counts?.open || 0;
    branch.stats.criticalFindings = counts?.critical || 0;
  }
  application.stats.openFindings = overall[0]?.open || 0;
  application.stats.criticalFindings = overall[0]?.critical || 0;
  await application.save();
  return application;
};

export const listApplications = asyncHandler(async (req, res) => {
  const query = req.validatedQuery || {};
  const { page, limit, skip } = parsePagination(query);
  const filter = { archived: query.archived === 'true' };
  if (query.criticality) filter.criticality = query.criticality;
  if (query.businessUnit) filter.businessUnit = query.businessUnit;
  if (query.tag) filter.tags = query.tag;
  if (query.q) {
    const rx = new RegExp(escapeRegex(query.q), 'i');
    filter.$or = [
      { name: rx },
      { key: rx },
      { applicationId: rx },
      { 'repository.url': rx },
      { businessUnit: rx },
      { 'hod.name': rx },
      { 'hod.email': rx },
      { 'spoc.name': rx },
      { 'spoc.email': rx },
    ];
  }
  const sort = buildSort(query.sort, [
    'createdAt',
    'name',
    'key',
    'criticality',
    'businessUnit',
    'stats.lastScanAt',
    'stats.openFindings',
  ]);
  const [items, total] = await Promise.all([
    Application.find(filter).sort(sort).skip(skip).limit(limit).lean({ virtuals: true }),
    Application.countDocuments(filter),
  ]);
  res.json(paginated(items, total, { page, limit }));
});

export const getApplication = asyncHandler(async (req, res) => {
  const application = await Application.findById(req.params.id).lean({ virtuals: true });
  if (!application) throw notFound('Application not found');

  const [recentScans, severityBreakdown, branchSeverity] = await Promise.all([
    Scan.find({ application: application._id }).sort({ createdAt: -1 }).limit(15).select('-logs').lean(),
    Finding.aggregate([
      { $match: { application: application._id, status: { $in: OPEN_STATUSES } } },
      { $group: { _id: '$severity', count: { $sum: 1 } } },
    ]),
    Finding.aggregate([
      { $match: { application: application._id, status: { $in: OPEN_STATUSES } } },
      { $group: { _id: { branch: '$branch', severity: '$severity' }, count: { $sum: 1 } } },
    ]),
  ]);

  const perBranchSeverity = {};
  for (const row of branchSeverity) {
    perBranchSeverity[row._id.branch] = { ...(perBranchSeverity[row._id.branch] || {}), [row._id.severity]: row.count };
  }

  res.json({
    application,
    recentScans,
    severityBreakdown: Object.fromEntries(severityBreakdown.map(({ _id, count }) => [_id, count])),
    branchSeverity: perBranchSeverity,
  });
});

export const createApplication = asyncHandler(async (req, res) => {
  const payload = req.body;
  if (await Application.exists({ key: payload.key })) throw conflict(`Application key ${payload.key} is already taken`);

  // An application always tracks at least one branch. When the caller listed
  // none, seed it from the repository's default; when they did list branches,
  // the model picks the default among them (never inventing an extra one).
  const branches = payload.branches?.length
    ? [...payload.branches]
    : [{ name: payload.repository.defaultBranch, environment: 'production', isDefault: true, scanEnabled: true }];

  const application = new Application({
    ...payload,
    branches: branches.map((branch) => ({ ...branch, addedBy: req.user._id })),
    createdBy: req.user._id,
    updatedBy: req.user._id,
  });
  await application.save();

  await recordAudit({
    action: 'application.registered',
    category: 'application_management',
    outcome: 'success',
    actor: req.user,
    target: { type: 'application', id: application._id, name: application.key },
    context: contextOf(req),
    message: `${req.user.username} registered application ${application.key} (${application.name}) with ${application.branches.length} branch(es)`,
    metadata: {
      repository: application.repository.url,
      criticality: application.criticality,
      hod: application.hod.email,
      spoc: application.spoc.email,
      branches: application.branches.map((branch) => branch.name),
    },
  });
  res.status(201).json({ application });
});

export const updateApplication = asyncHandler(async (req, res) => {
  const application = await Application.findById(req.params.id);
  if (!application) throw notFound('Application not found');
  if (req.body.key && req.body.key !== application.key && (await Application.exists({ key: req.body.key }))) {
    throw conflict(`Application key ${req.body.key} is already taken`);
  }

  const changed = Object.keys(req.body).filter(
    (key) => JSON.stringify(application.get(key)) !== JSON.stringify(req.body[key]),
  );
  // Merge nested blocks so a partial update cannot blank out contact details.
  const { hod, spoc, backupSpoc, repository, ...rest } = req.body;
  Object.assign(application, rest);
  if (hod) application.hod = { ...application.hod.toObject(), ...hod };
  if (spoc) application.spoc = { ...application.spoc.toObject(), ...spoc };
  if (backupSpoc) application.backupSpoc = { ...(application.backupSpoc?.toObject() || {}), ...backupSpoc };
  if (repository) application.repository = { ...application.repository.toObject(), ...repository };
  application.updatedBy = req.user._id;
  await application.save();

  await recordAudit({
    action: 'application.updated',
    category: 'application_management',
    outcome: 'success',
    actor: req.user,
    target: { type: 'application', id: application._id, name: application.key },
    context: contextOf(req),
    message: `${req.user.username} updated application ${application.key}`,
    metadata: { changedFields: changed },
  });
  res.json({ application });
});

export const archiveApplication = asyncHandler(async (req, res) => {
  const application = await Application.findById(req.params.id);
  if (!application) throw notFound('Application not found');
  // Archive rather than delete: scan history is evidence and must survive.
  application.archived = true;
  application.updatedBy = req.user._id;
  await application.save();

  await recordAudit({
    action: 'application.archived',
    category: 'application_management',
    outcome: 'success',
    actor: req.user,
    target: { type: 'application', id: application._id, name: application.key },
    context: contextOf(req),
    message: `${req.user.username} archived application ${application.key}`,
  });
  res.json({ application });
});

export const listBranches = asyncHandler(async (req, res) => {
  const application = await Application.findById(req.params.id).lean();
  if (!application) throw notFound('Application not found');

  const [scanCounts, lastScans] = await Promise.all([
    Scan.aggregate([
      { $match: { application: application._id } },
      { $group: { _id: '$branch', total: { $sum: 1 }, failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } } } },
    ]),
    Scan.aggregate([
      { $match: { application: application._id } },
      { $sort: { createdAt: -1 } },
      { $group: { _id: '$branch', scanId: { $first: '$scanId' }, status: { $first: '$status' }, at: { $first: '$createdAt' }, summary: { $first: '$summary' } } },
    ]),
  ]);
  const counts = new Map(scanCounts.map((row) => [row._id, row]));
  const latest = new Map(lastScans.map((row) => [row._id, row]));

  res.json({
    branches: application.branches.map((branch) => ({
      ...branch,
      scanCount: counts.get(branch.name)?.total || 0,
      failedScans: counts.get(branch.name)?.failed || 0,
      lastScan: latest.get(branch.name) || null,
    })),
  });
});

export const addBranch = asyncHandler(async (req, res) => {
  const application = await Application.findById(req.params.id);
  if (!application) throw notFound('Application not found');
  if (application.archived) throw badRequest('Cannot add branches to an archived application');
  if (application.findBranch(req.body.name)) throw conflict(`Branch ${req.body.name} is already registered`);

  application.branches.push({ ...req.body, addedBy: req.user._id });
  if (req.body.isDefault) {
    application.branches.forEach((branch) => {
      branch.isDefault = branch.name === req.body.name;
    });
  }
  application.updatedBy = req.user._id;
  await application.save();

  await recordAudit({
    action: 'application.branch.added',
    category: 'application_management',
    outcome: 'success',
    actor: req.user,
    target: { type: 'application', id: application._id, name: application.key },
    context: contextOf(req),
    message: `${req.user.username} registered branch ${req.body.name} on ${application.key}`,
    metadata: { branch: req.body.name, environment: req.body.environment },
  });
  res.status(201).json({ application });
});

export const updateBranch = asyncHandler(async (req, res) => {
  const application = await Application.findById(req.params.id);
  if (!application) throw notFound('Application not found');
  const branch = application.findBranch(req.params.branch);
  if (!branch) throw notFound(`Branch ${req.params.branch} is not registered`);

  Object.assign(branch, req.body);
  if (req.body.isDefault) {
    application.branches.forEach((candidate) => {
      candidate.isDefault = candidate.name === branch.name;
    });
  }
  application.updatedBy = req.user._id;
  await application.save();

  await recordAudit({
    action: 'application.branch.updated',
    category: 'application_management',
    outcome: 'success',
    actor: req.user,
    target: { type: 'application', id: application._id, name: application.key },
    context: contextOf(req),
    message: `${req.user.username} updated branch ${branch.name} on ${application.key}`,
    metadata: { branch: branch.name, changes: req.body },
  });
  res.json({ application });
});

export const removeBranch = asyncHandler(async (req, res) => {
  const application = await Application.findById(req.params.id);
  if (!application) throw notFound('Application not found');
  const branch = application.findBranch(req.params.branch);
  if (!branch) throw notFound(`Branch ${req.params.branch} is not registered`);
  if (branch.isDefault) throw badRequest('Set another branch as default before removing this one');

  application.branches = application.branches.filter((candidate) => candidate.name !== branch.name);
  application.updatedBy = req.user._id;
  await application.save();

  await recordAudit({
    action: 'application.branch.removed',
    category: 'application_management',
    outcome: 'success',
    actor: req.user,
    target: { type: 'application', id: application._id, name: application.key },
    context: contextOf(req),
    // Scans and findings for the branch are kept; only the tracking entry goes.
    message: `${req.user.username} stopped tracking branch ${branch.name} on ${application.key}`,
    metadata: { branch: branch.name },
  });
  res.json({ application });
});

export const applicationStats = asyncHandler(async (req, res) => {
  const application = await Application.findById(req.params.id).lean();
  if (!application) throw notFound('Application not found');

  const [trend, byRule, byBranch] = await Promise.all([
    Scan.aggregate([
      { $match: { application: application._id, status: 'completed' } },
      { $sort: { finishedAt: 1 } },
      { $limit: 120 },
      {
        $project: {
          _id: 0,
          scanId: 1,
          branch: 1,
          finishedAt: 1,
          total: '$summary.total',
          critical: '$summary.critical',
          high: '$summary.high',
        },
      },
    ]),
    Finding.aggregate([
      { $match: { application: application._id, status: { $in: OPEN_STATUSES } } },
      { $group: { _id: '$ruleId', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]),
    Finding.aggregate([
      { $match: { application: application._id, status: { $in: OPEN_STATUSES } } },
      {
        $group: {
          _id: '$branch',
          open: { $sum: 1 },
          critical: { $sum: { $cond: [{ $eq: ['$severity', 'critical'] }, 1, 0] } },
        },
      },
      { $sort: { open: -1 } },
    ]),
  ]);

  res.json({
    trend,
    topRules: byRule.map(({ _id, count }) => ({ ruleId: _id, count })),
    branchExposure: byBranch.map(({ _id, open, critical }) => ({ branch: _id, open, critical })),
  });
});
