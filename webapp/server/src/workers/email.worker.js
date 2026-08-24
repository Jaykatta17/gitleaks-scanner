import { Worker } from 'bullmq';
import env from '../config/env.js';
import logger from '../config/logger.js';
import { createWorkerConnection } from '../queues/connection.js';
import { QUEUE_NAMES } from '../queues/index.js';
import { sendTemplateMail } from '../services/mail.service.js';
import { recordAudit } from '../services/audit.service.js';

const log = logger.child({ worker: 'email' });

export const processEmailJob = async (job) => {
  const { to, template, data, subject } = job.data;
  const recipients = Array.isArray(to) ? to.filter(Boolean) : [to].filter(Boolean);
  if (!recipients.length) return { skipped: true, reason: 'no recipients' };

  const result = await sendTemplateMail({ to: recipients, template, data, subject });
  log.info('notification delivered', {
    event: 'email.delivered',
    template,
    recipients: recipients.length,
    simulated: result.simulated,
  });
  return { messageId: result.messageId, recipients: recipients.length, simulated: result.simulated };
};

export const createEmailWorker = () => {
  const worker = new Worker(QUEUE_NAMES.email, processEmailJob, {
    connection: createWorkerConnection(),
    prefix: env.redis.prefix,
    concurrency: env.queue.emailConcurrency,
  });
  worker.on('failed', async (job, error) => {
    log.error('email job failed', {
      event: 'email.failed',
      jobId: job?.id,
      template: job?.data?.template,
      attempts: job?.attemptsMade,
      error: error.message,
    });
    if ((job?.attemptsMade ?? 0) + 1 >= (job?.opts?.attempts ?? env.queue.attempts)) {
      // A permanently undeliverable notification is itself an auditable event.
      await recordAudit({
        action: 'notification.delivery_failed',
        category: 'system',
        outcome: 'failure',
        actor: { username: 'system', displayName: 'Email worker' },
        message: `Notification ${job?.data?.template} could not be delivered after ${job?.attemptsMade + 1} attempt(s)`,
        metadata: { template: job?.data?.template, error: error.message },
      });
    }
  });
  return worker;
};

export default createEmailWorker;
