import { Project } from '../models/project.model.js';
import { Scan } from '../models/scan.model.js';
import { Finding } from '../models/finding.model.js';
import { recordAudit } from '../services/audit.service.js';
import { asyncHandler, conflict, notFound } from '../utils/errors.js';
import { parsePagination, buildSort, paginated } from '../utils/pagination.js';

const contextOf = (req) => ({
  ip: req.ip,
  userAgent: req.get('user-agent'),
  requestId: req.id,
  method: req.method,
  path: req.originalUrl.split('?')[0],
});

export const listProjects = asyncHandler(async (req, res) => {
  const query = req.validatedQuery || {};
  const { page, limit, skip } = parsePagination(query);
  const filter = { archived: query.archived === 'true' };
  if (query.criticality) filter.criticality = query.criticality;
  if (query.tag) filter.tags = query.tag;
  if (query.q) {
    const rx = new RegExp(query.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ name: rx }, { key: rx }, { repoUrl: rx }, { businessUnit: rx }];
  }
  const sort = buildSort(query.sort, ['createdAt', 'name', 'key', 'criticality', 'stats.lastScanAt', 'stats.openFindings']);
  const [items, total] = await Promise.all([
    Project.find(filter).sort(sort).skip(skip).limit(limit).lean({ virtuals: true }),
    Project.countDocuments(filter),
  ]);
  res.json(paginated(items, total, { page, limit }));
});

export const getProject = asyncHandler(async (req, res) => {
  const project = await Project.findById(req.params.id).lean({ virtuals: true });
  if (!project) throw notFound('Project not found');
  const [recentScans, severityBreakdown] = await Promise.all([
    Scan.find({ project: project._id }).sort({ createdAt: -1 }).limit(10).lean(),
    Finding.aggregate([
      { $match: { project: project._id, status: { $in: ['open', 'triaged'] } } },
      { $group: { _id: '$severity', count: { $sum: 1 } } },
    ]),
  ]);
  res.json({
    project,
    recentScans,
    severityBreakdown: Object.fromEntries(severityBreakdown.map(({ _id, count }) => [_id, count])),
  });
});

export const createProject = asyncHandler(async (req, res) => {
  if (await Project.exists({ key: req.body.key })) throw conflict(`Project key ${req.body.key} is already taken`);
  const project = await Project.create({ ...req.body, createdBy: req.user._id, updatedBy: req.user._id });
  await recordAudit({
    action: 'project.created',
    category: 'project_management',
    outcome: 'success',
    actor: req.user,
    target: { type: 'project', id: project._id, name: project.key },
    context: contextOf(req),
    message: `${req.user.username} onboarded project ${project.key} (${project.name})`,
    metadata: { repoUrl: project.repoUrl, criticality: project.criticality },
  });
  res.status(201).json({ project });
});

export const updateProject = asyncHandler(async (req, res) => {
  const project = await Project.findById(req.params.id);
  if (!project) throw notFound('Project not found');
  const changed = Object.keys(req.body).filter(
    (key) => JSON.stringify(project.get(key)) !== JSON.stringify(req.body[key]),
  );
  Object.assign(project, req.body, { updatedBy: req.user._id });
  await project.save();
  await recordAudit({
    action: 'project.updated',
    category: 'project_management',
    outcome: 'success',
    actor: req.user,
    target: { type: 'project', id: project._id, name: project.key },
    context: contextOf(req),
    message: `${req.user.username} updated project ${project.key}`,
    metadata: { changedFields: changed },
  });
  res.json({ project });
});

export const deleteProject = asyncHandler(async (req, res) => {
  const project = await Project.findById(req.params.id);
  if (!project) throw notFound('Project not found');
  // Archive rather than delete: scan history is evidence and must survive.
  project.archived = true;
  project.updatedBy = req.user._id;
  await project.save();
  await recordAudit({
    action: 'project.archived',
    category: 'project_management',
    outcome: 'success',
    actor: req.user,
    target: { type: 'project', id: project._id, name: project.key },
    context: contextOf(req),
    message: `${req.user.username} archived project ${project.key}`,
  });
  res.json({ project });
});

export const projectStats = asyncHandler(async (req, res) => {
  const project = await Project.findById(req.params.id).lean();
  if (!project) throw notFound('Project not found');
  const [trend, byRule] = await Promise.all([
    Scan.aggregate([
      { $match: { project: project._id, status: 'completed' } },
      { $sort: { finishedAt: 1 } },
      { $limit: 60 },
      {
        $project: {
          _id: 0,
          scanId: 1,
          finishedAt: 1,
          total: '$summary.total',
          critical: '$summary.critical',
          high: '$summary.high',
        },
      },
    ]),
    Finding.aggregate([
      { $match: { project: project._id, status: { $in: ['open', 'triaged'] } } },
      { $group: { _id: '$ruleId', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]),
  ]);
  res.json({ trend, topRules: byRule.map(({ _id, count }) => ({ ruleId: _id, count })) });
});
