import { Worker } from 'bullmq';
import env from '../config/env.js';
import logger from '../config/logger.js';
import { createWorkerConnection } from '../queues/connection.js';
import { QUEUE_NAMES, enqueueEmail } from '../queues/index.js';
import { Scan } from '../models/scan.model.js';
import { Finding } from '../models/finding.model.js';
import { Project } from '../models/project.model.js';
import { User } from '../models/user.model.js';
import { executeScan } from '../services/scanner.service.js';
import { recordAudit } from '../services/audit.service.js';

const log = logger.child({ worker: 'scan' });

const severityLabel = (summary) => {
  if (summary.critical > 0) return 'CRITICAL';
  if (summary.high > 0) return 'HIGH';
  if (summary.total > 0) return 'REVIEW';
  return 'CLEAN';
};

const notifyRecipients = async (project, scan) => {
  const recipients = new Set();
  if (project?.maintainerEmail) recipients.add(project.maintainerEmail);
  const subscribers = await User.find({
    status: 'active',
    role: { $in: ['admin', 'security_analyst'] },
    'notificationPreferences.scanCompleted': true,
  })
    .select('email')
    .lean();
  for (const subscriber of subscribers) recipients.add(subscriber.email);
  if (scan.requestedBy) {
    const requester = await User.findById(scan.requestedBy).select('email notificationPreferences').lean();
    if (requester?.notificationPreferences?.scanCompleted !== false && requester?.email) recipients.add(requester.email);
  }
  return [...recipients];
};

export const processScanJob = async (job) => {
  const { scanId } = job.data;
  const scan = await Scan.findOne({ scanId });
  if (!scan) {
    log.warn('scan record missing, dropping job', { event: 'scan.missing', scanId });
    return { skipped: true };
  }
  if (scan.status === 'cancelled') {
    log.info('scan cancelled before start', { event: 'scan.cancelled', scanId });
    return { cancelled: true };
  }

  const logLines = [];
  const onLog = (message) => {
    logLines.push({ at: new Date(), level: 'info', message });
    log.info(message, { event: 'scan.progress', scanId });
  };

  scan.status = 'running';
  scan.startedAt = new Date();
  scan.attempts = job.attemptsMade + 1;
  scan.logs.push({ level: 'info', message: `Worker picked up the job (attempt ${scan.attempts})` });
  await scan.save();
  await Project.updateOne({ _id: scan.project }, { $set: { 'stats.lastScanStatus': 'running' } });

  try {
    const result = await executeScan(
      { repoUrl: scan.repoUrl, branch: scan.branch, commitId: scan.commitId },
      { onLog },
    );

    if (result.findings.length) {
      const now = new Date();
      await Finding.insertMany(
        result.findings.map((finding) => ({
          ...finding,
          scan: scan._id,
          scanId: scan.scanId,
          project: scan.project,
          projectKey: scan.projectKey,
          status: 'open',
          firstSeenAt: now,
          lastSeenAt: now,
        })),
        { ordered: false },
      );
    }

    scan.status = 'completed';
    scan.driver = result.driver;
    scan.commitId = result.commit || scan.commitId;
    scan.summary = { ...scan.summary.toObject(), ...result.summary };
    scan.finishedAt = new Date();
    scan.durationMs = scan.finishedAt - scan.startedAt;
    scan.logs.push(...logLines, { level: 'info', message: `Completed with ${result.summary.total} finding(s)` });
    await scan.save();

    const project = await Project.findById(scan.project);
    if (project) {
      const [openCounts] = await Finding.aggregate([
        { $match: { project: project._id, status: { $in: ['open', 'triaged'] } } },
        {
          $group: {
            _id: null,
            open: { $sum: 1 },
            critical: { $sum: { $cond: [{ $eq: ['$severity', 'critical'] }, 1, 0] } },
          },
        },
      ]);
      project.stats.lastScanAt = scan.finishedAt;
      project.stats.lastScanStatus = 'completed';
      project.stats.openFindings = openCounts?.open || 0;
      project.stats.criticalFindings = openCounts?.critical || 0;
      await project.save();
    }

    const recipients = await notifyRecipients(project, scan);
    if (recipients.length) {
      void enqueueEmail({
        template: 'scanCompleted',
        to: recipients,
        data: {
          scanId: scan.scanId,
          projectName: scan.projectName,
          repoUrl: scan.repoUrl,
          branch: scan.branch,
          commitId: scan.commitId,
          total: result.summary.total,
          critical: result.summary.critical,
          high: result.summary.high,
          medium: result.summary.medium,
          low: result.summary.low,
          durationSeconds: Math.round(scan.durationMs / 1000),
          severityLabel: severityLabel(result.summary),
        },
      });
    }
    if (result.summary.critical > 0 && project) {
      void enqueueEmail(
        {
          template: 'criticalFinding',
          to: [...new Set([project.maintainerEmail, ...recipients])],
          data: {
            count: result.summary.critical,
            projectName: project.name,
            scanId: scan.scanId,
            branch: scan.branch,
            maintainerEmail: project.maintainerEmail,
            samples: result.findings.filter((f) => f.severity === 'critical').slice(0, 5),
          },
        },
        { priority: 1 },
      );
    }

    await recordAudit({
      action: 'scan.completed',
      category: 'scan',
      outcome: 'success',
      actor: { username: scan.requestedByName || 'system', displayName: 'Scan worker' },
      target: { type: 'scan', id: scan.scanId, name: scan.projectKey },
      message: `Scan ${scan.scanId} completed for ${scan.projectKey}: ${result.summary.total} finding(s), ${result.summary.critical} critical`,
      metadata: { ...result.summary, driver: result.driver, durationMs: scan.durationMs },
    });
    return { scanId: scan.scanId, ...result.summary };
  } catch (error) {
    const finalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? env.queue.attempts);
    scan.logs.push(...logLines, { level: 'error', message: error.message });
    scan.error = { message: error.message, stage: 'execute' };
    scan.attempts = job.attemptsMade + 1;
    if (finalAttempt) {
      scan.status = 'failed';
      scan.finishedAt = new Date();
      scan.durationMs = scan.startedAt ? scan.finishedAt - scan.startedAt : 0;
    }
    await scan.save();

    if (finalAttempt) {
      await Project.updateOne({ _id: scan.project }, { $set: { 'stats.lastScanStatus': 'failed' } });
      const project = await Project.findById(scan.project).lean();
      if (project?.maintainerEmail) {
        void enqueueEmail({
          template: 'scanFailed',
          to: project.maintainerEmail,
          data: {
            scanId: scan.scanId,
            projectName: scan.projectName,
            repoUrl: scan.repoUrl,
            branch: scan.branch,
            stage: 'execute',
            reason: error.message,
            attempts: scan.attempts,
          },
        });
      }
      await recordAudit({
        action: 'scan.failed',
        category: 'scan',
        outcome: 'failure',
        actor: { username: scan.requestedByName || 'system', displayName: 'Scan worker' },
        target: { type: 'scan', id: scan.scanId, name: scan.projectKey },
        message: `Scan ${scan.scanId} failed after ${scan.attempts} attempt(s): ${error.message}`,
        metadata: { error: error.message, attempts: scan.attempts },
      });
    }
    throw error;
  }
};

export const createScanWorker = () => {
  const worker = new Worker(QUEUE_NAMES.scan, processScanJob, {
    connection: createWorkerConnection(),
    prefix: env.redis.prefix,
    concurrency: env.queue.scanConcurrency,
    lockDuration: Math.max(60_000, env.scanner.timeoutMs / 2),
  });
  worker.on('completed', (job, result) =>
    log.info('scan job completed', { event: 'queue.completed', jobId: job.id, ...result }),
  );
  worker.on('failed', (job, error) =>
    log.error('scan job failed', { event: 'queue.failed', jobId: job?.id, attempts: job?.attemptsMade, error: error.message }),
  );
  return worker;
};

export default createScanWorker;
