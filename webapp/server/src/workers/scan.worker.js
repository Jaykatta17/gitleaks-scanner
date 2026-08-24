import { Worker } from 'bullmq';
import env from '../config/env.js';
import logger from '../config/logger.js';
import { createWorkerConnection } from '../queues/connection.js';
import { QUEUE_NAMES, enqueueEmail } from '../queues/index.js';
import { Scan } from '../models/scan.model.js';
import { Finding } from '../models/finding.model.js';
import { Application } from '../models/application.model.js';
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

const notifyRecipients = async (application, scan) => {
  const recipients = new Set();
  // The SPOC owns day-to-day remediation; the HOD is copied for accountability.
  if (application?.spoc?.email) recipients.add(application.spoc.email);
  if (application?.backupSpoc?.email) recipients.add(application.backupSpoc.email);
  if (application?.hod?.email) recipients.add(application.hod.email);
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
  await Application.updateOne(
    { _id: scan.application, 'branches.name': scan.branch },
    { $set: { 'stats.lastScanStatus': 'running', 'branches.$.stats.lastScanStatus': 'running' } },
  );

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
          application: scan.application,
          applicationKey: scan.applicationKey,
          branch: scan.branch,
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

    const application = await Application.findById(scan.application);
    if (application) {
      // Counters are kept per branch as well as for the application as a whole,
      // so one branch's exposure never hides behind another's.
      const [overall, forBranch] = await Promise.all([
        Finding.aggregate([
          { $match: { application: application._id, status: { $in: ['open', 'triaged'] } } },
          {
            $group: {
              _id: null,
              open: { $sum: 1 },
              critical: { $sum: { $cond: [{ $eq: ['$severity', 'critical'] }, 1, 0] } },
            },
          },
        ]),
        Finding.aggregate([
          { $match: { application: application._id, branch: scan.branch, status: { $in: ['open', 'triaged'] } } },
          {
            $group: {
              _id: null,
              open: { $sum: 1 },
              critical: { $sum: { $cond: [{ $eq: ['$severity', 'critical'] }, 1, 0] } },
            },
          },
        ]),
      ]);
      application.stats.lastScanAt = scan.finishedAt;
      application.stats.lastScanStatus = 'completed';
      application.stats.openFindings = overall[0]?.open || 0;
      application.stats.criticalFindings = overall[0]?.critical || 0;

      const branch = application.findBranch(scan.branch);
      if (branch) {
        branch.stats.lastScanAt = scan.finishedAt;
        branch.stats.lastScanStatus = 'completed';
        branch.stats.lastScanId = scan.scanId;
        branch.stats.openFindings = forBranch[0]?.open || 0;
        branch.stats.criticalFindings = forBranch[0]?.critical || 0;
      }
      await application.save();
    }

    const recipients = await notifyRecipients(application, scan);
    if (recipients.length) {
      void enqueueEmail({
        template: 'scanCompleted',
        to: recipients,
        data: {
          scanId: scan.scanId,
          applicationName: scan.applicationName,
          applicationKey: scan.applicationKey,
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
    if (result.summary.critical > 0 && application) {
      void enqueueEmail(
        {
          template: 'criticalFinding',
          to: recipients,
          data: {
            count: result.summary.critical,
            applicationName: application.name,
            applicationKey: application.key,
            scanId: scan.scanId,
            branch: scan.branch,
            spocEmail: application.spoc?.email,
            hodEmail: application.hod?.email,
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
      target: { type: 'scan', id: scan.scanId, name: `${scan.applicationKey}@${scan.branch}` },
      message: `Scan ${scan.scanId} completed for ${scan.applicationKey} on branch ${scan.branch}: ${result.summary.total} finding(s), ${result.summary.critical} critical`,
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
      await Application.updateOne(
        { _id: scan.application, 'branches.name': scan.branch },
        { $set: { 'stats.lastScanStatus': 'failed', 'branches.$.stats.lastScanStatus': 'failed' } },
      );
      const application = await Application.findById(scan.application).lean();
      const failureRecipients = [application?.spoc?.email, application?.hod?.email].filter(Boolean);
      if (failureRecipients.length) {
        void enqueueEmail({
          template: 'scanFailed',
          to: failureRecipients,
          data: {
            scanId: scan.scanId,
            applicationName: scan.applicationName,
            applicationKey: scan.applicationKey,
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
        target: { type: 'scan', id: scan.scanId, name: `${scan.applicationKey}@${scan.branch}` },
        message: `Scan ${scan.scanId} failed for ${scan.applicationKey} on branch ${scan.branch} after ${scan.attempts} attempt(s): ${error.message}`,
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
