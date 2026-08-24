import { Queue, QueueEvents } from 'bullmq';
import env from '../config/env.js';
import logger from '../config/logger.js';
import { getRedis } from './connection.js';

export const QUEUE_NAMES = {
  scan: 'scan',
  email: 'email',
  maintenance: 'maintenance',
};

export const defaultJobOptions = {
  attempts: env.queue.attempts,
  backoff: { type: 'exponential', delay: env.queue.backoffMs },
  removeOnComplete: { count: env.queue.removeOnCompleteCount },
  removeOnFail: { count: env.queue.removeOnFailCount },
};

const queues = new Map();

export const getQueue = (name) => {
  if (!Object.values(QUEUE_NAMES).includes(name)) throw new Error(`Unknown queue: ${name}`);
  if (!queues.has(name)) {
    queues.set(
      name,
      new Queue(name, { connection: getRedis(), prefix: env.redis.prefix, defaultJobOptions }),
    );
  }
  return queues.get(name);
};

export const scanQueue = () => getQueue(QUEUE_NAMES.scan);
export const emailQueue = () => getQueue(QUEUE_NAMES.email);
export const maintenanceQueue = () => getQueue(QUEUE_NAMES.maintenance);

export const enqueueScan = (payload, options = {}) =>
  scanQueue().add('scan-repository', payload, { jobId: payload.scanId, priority: options.priority ?? 5, ...options });

export const enqueueEmail = (payload, options = {}) =>
  emailQueue()
    .add(payload.template || 'email', payload, { priority: options.priority ?? 10, ...options })
    .catch((error) => {
      // Notifications must never take down the request that triggered them.
      logger.error('email enqueue failed', { event: 'queue.email_failed', template: payload.template, error: error.message });
      return null;
    });

export const queueStats = async () => {
  const names = Object.values(QUEUE_NAMES);
  const entries = await Promise.all(
    names.map(async (name) => {
      try {
        const counts = await getQueue(name).getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed', 'paused');
        return [name, counts];
      } catch (error) {
        return [name, { error: error.message }];
      }
    }),
  );
  return Object.fromEntries(entries);
};

export const createQueueEvents = (name) =>
  new QueueEvents(name, { connection: getRedis().duplicate(), prefix: env.redis.prefix });

export const closeQueues = async () => {
  const open = [...queues.values()];
  queues.clear();
  await Promise.allSettled(open.map((queue) => queue.close()));
};
