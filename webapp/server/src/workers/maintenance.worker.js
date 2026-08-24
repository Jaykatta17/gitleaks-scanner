import { Worker } from 'bullmq';
import env from '../config/env.js';
import logger from '../config/logger.js';
import { createWorkerConnection } from '../queues/connection.js';
import { QUEUE_NAMES, maintenanceQueue } from '../queues/index.js';
import { Scan } from '../models/scan.model.js';
import { Application } from '../models/application.model.js';
import { queueScanForApplication } from '../services/scan.service.js';
import { recordAudit } from '../services/audit.service.js';

const log = logger.child({ worker: 'maintenance' });
const STALE_SCAN_MS = 6 * 60 * 60 * 1000;

/** Marks scans whose worker died mid-run so the UI never shows a permanent "running". */
export const reapStaleScans = async () => {
  const cutoff = new Date(Date.now() - STALE_SCAN_MS);
  const stale = await Scan.find({ status: 'running', startedAt: { $lt: cutoff } }).select('scanId application branch');
  if (!stale.length) return { reaped: 0 };
  await Scan.updateMany(
    { _id: { $in: stale.map((scan) => scan._id) } },
    {
      $set: {
        status: 'failed',
        finishedAt: new Date(),
        error: { message: 'Scan exceeded the maximum runtime and was reaped', stage: 'watchdog' },
      },
    },
  );
  await recordAudit({
    action: 'scan.reaped',
    category: 'system',
    outcome: 'failure',
    actor: { username: 'system', displayName: 'Maintenance worker' },
    message: `Reaped ${stale.length} stale scan(s) stuck in running state`,
    metadata: { scanIds: stale.map((scan) => scan.scanId) },
  });
  return { reaped: stale.length };
};

/**
 * Queues every branch whose schedule is enabled. Scheduling lives on the branch,
 * so an application can scan `main` nightly and a release branch weekly.
 */
export const runScheduledScans = async () => {
  const applications = await Application.find({
    archived: false,
    'branches.schedule.enabled': true,
  }).select('_id key branches');
  const queued = [];
  for (const application of applications) {
    const dueBranches = application.branches.filter(
      (branch) => branch.schedule?.enabled && branch.scanEnabled !== false,
    );
    for (const branch of dueBranches) {
      try {
        // eslint-disable-next-line no-await-in-loop -- bounded by the number of scheduled branches
        const scan = await queueScanForApplication({
          application,
          branch: branch.name,
          trigger: 'scheduled',
        });
        queued.push(scan.scanId);
      } catch (error) {
        log.error('scheduled scan failed to queue', {
          event: 'schedule.failed',
          application: application.key,
          branch: branch.name,
          error: error.message,
        });
      }
    }
  }
  if (queued.length) {
    await recordAudit({
      action: 'scan.scheduled_batch',
      category: 'scan',
      outcome: 'success',
      actor: { username: 'system', displayName: 'Scheduler' },
      message: `Scheduler queued ${queued.length} scan(s)`,
      metadata: { scanIds: queued },
    });
  }
  return { queued: queued.length };
};

const HANDLERS = { 'reap-stale-scans': reapStaleScans, 'run-scheduled-scans': runScheduledScans };

export const createMaintenanceWorker = () => {
  const worker = new Worker(
    QUEUE_NAMES.maintenance,
    async (job) => {
      const handler = HANDLERS[job.name];
      if (!handler) throw new Error(`Unknown maintenance job: ${job.name}`);
      const result = await handler();
      log.info('maintenance job finished', { event: 'maintenance.done', job: job.name, ...result });
      return result;
    },
    { connection: createWorkerConnection(), prefix: env.redis.prefix, concurrency: 1 },
  );
  return worker;
};

/** Repeatable jobs are idempotent by job id, so re-running this on every boot is safe. */
export const scheduleMaintenanceJobs = async () => {
  const queue = maintenanceQueue();
  await queue.add('reap-stale-scans', {}, { repeat: { pattern: '*/15 * * * *' }, jobId: 'reap-stale-scans' });
  await queue.add('run-scheduled-scans', {}, { repeat: { pattern: '0 * * * *' }, jobId: 'run-scheduled-scans' });
};

export default createMaintenanceWorker;
