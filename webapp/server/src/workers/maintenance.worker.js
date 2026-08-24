import { Worker } from 'bullmq';
import env from '../config/env.js';
import logger from '../config/logger.js';
import { createWorkerConnection } from '../queues/connection.js';
import { QUEUE_NAMES, maintenanceQueue } from '../queues/index.js';
import { Scan } from '../models/scan.model.js';
import { Project } from '../models/project.model.js';
import { queueScanForProject } from '../services/scan.service.js';
import { recordAudit } from '../services/audit.service.js';

const log = logger.child({ worker: 'maintenance' });
const STALE_SCAN_MS = 6 * 60 * 60 * 1000;

/** Marks scans whose worker died mid-run so the UI never shows a permanent "running". */
export const reapStaleScans = async () => {
  const cutoff = new Date(Date.now() - STALE_SCAN_MS);
  const stale = await Scan.find({ status: 'running', startedAt: { $lt: cutoff } }).select('scanId project');
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

/** Queues every project whose schedule window has come round. */
export const runScheduledScans = async () => {
  const projects = await Project.find({ archived: false, 'schedule.enabled': true }).select('_id key');
  const queued = [];
  for (const project of projects) {
    try {
      // eslint-disable-next-line no-await-in-loop -- bounded by the number of scheduled projects
      const scan = await queueScanForProject({ projectId: project._id, trigger: 'scheduled' });
      queued.push(scan.scanId);
    } catch (error) {
      log.error('scheduled scan failed to queue', { event: 'schedule.failed', project: project.key, error: error.message });
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
