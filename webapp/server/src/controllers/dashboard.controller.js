import dayjs from 'dayjs';
import { Project } from '../models/project.model.js';
import { Scan } from '../models/scan.model.js';
import { Finding } from '../models/finding.model.js';
import { AuditLog } from '../models/auditLog.model.js';
import { queueStats } from '../queues/index.js';
import { asyncHandler } from '../utils/errors.js';

const OPEN_STATUSES = ['open', 'triaged'];

export const overview = asyncHandler(async (req, res) => {
  const days = Math.min(90, Math.max(7, Number.parseInt(req.query.days, 10) || 30));
  const since = dayjs().subtract(days, 'day').startOf('day').toDate();

  const [
    projectCount,
    activeProjects,
    scanCounts,
    severityCounts,
    statusCounts,
    trend,
    topProjects,
    topRules,
    recentScans,
    mttr,
    queues,
  ] = await Promise.all([
    Project.countDocuments({}),
    Project.countDocuments({ archived: false }),
    Scan.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    Finding.aggregate([
      { $match: { status: { $in: OPEN_STATUSES } } },
      { $group: { _id: '$severity', count: { $sum: 1 } } },
    ]),
    Finding.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    Scan.aggregate([
      { $match: { createdAt: { $gte: since }, status: { $in: ['completed', 'failed'] } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          scans: { $sum: 1 },
          findings: { $sum: '$summary.total' },
          critical: { $sum: '$summary.critical' },
          high: { $sum: '$summary.high' },
          failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    Finding.aggregate([
      { $match: { status: { $in: OPEN_STATUSES } } },
      {
        $group: {
          _id: { projectKey: '$projectKey', project: '$project' },
          open: { $sum: 1 },
          critical: { $sum: { $cond: [{ $eq: ['$severity', 'critical'] }, 1, 0] } },
        },
      },
      { $sort: { critical: -1, open: -1 } },
      { $limit: 8 },
    ]),
    Finding.aggregate([
      { $match: { status: { $in: OPEN_STATUSES } } },
      { $group: { _id: '$ruleId', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 8 },
    ]),
    Scan.find({}).sort({ createdAt: -1 }).limit(8).select('-logs').lean(),
    Finding.aggregate([
      { $match: { status: 'remediated', 'triage.updatedAt': { $ne: null } } },
      { $project: { hours: { $divide: [{ $subtract: ['$triage.updatedAt', '$firstSeenAt'] }, 3_600_000] } } },
      { $group: { _id: null, avgHours: { $avg: '$hours' }, count: { $sum: 1 } } },
    ]),
    queueStats().catch(() => ({})),
  ]);

  const asMap = (rows) => Object.fromEntries(rows.map(({ _id, count }) => [_id, count]));
  const severity = { critical: 0, high: 0, medium: 0, low: 0, ...asMap(severityCounts) };

  res.json({
    generatedAt: new Date().toISOString(),
    windowDays: days,
    projects: { total: projectCount, active: activeProjects, archived: projectCount - activeProjects },
    scans: { byStatus: asMap(scanCounts), recent: recentScans },
    findings: {
      openBySeverity: severity,
      openTotal: Object.values(severity).reduce((a, b) => a + b, 0),
      byStatus: asMap(statusCounts),
      meanTimeToRemediateHours: mttr[0]?.avgHours ? Number(mttr[0].avgHours.toFixed(1)) : null,
      remediatedCount: mttr[0]?.count || 0,
    },
    trend: trend.map(({ _id, ...rest }) => ({ date: _id, ...rest })),
    topProjects: topProjects.map(({ _id, open, critical }) => ({ projectKey: _id.projectKey, projectId: _id.project, open, critical })),
    topRules: topRules.map(({ _id, count }) => ({ ruleId: _id, count })),
    queues,
  });
});

export const activityFeed = asyncHandler(async (req, res) => {
  const limit = Math.min(50, Math.max(5, Number.parseInt(req.query.limit, 10) || 15));
  const events = await AuditLog.find({ category: { $ne: 'data_access' } })
    .sort({ createdAt: -1 })
    .limit(limit)
    .select('action category outcome severity actor.username actor.displayName target message createdAt')
    .lean();
  res.json({ events });
});
