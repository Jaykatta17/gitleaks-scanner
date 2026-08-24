import env from '../config/env.js';
import logger from '../config/logger.js';
import { connectMongo, disconnectMongo } from '../db/mongoose.js';
import { closeQueues } from '../queues/index.js';
import { closeRedis } from '../queues/connection.js';
import { recordAudit } from '../services/audit.service.js';
import syslogClient from '../config/syslog.js';
import createScanWorker from './scan.worker.js';
import createEmailWorker from './email.worker.js';
import createMaintenanceWorker, { scheduleMaintenanceJobs } from './maintenance.worker.js';

const start = async () => {
  await connectMongo();
  const workers = [createScanWorker(), createEmailWorker(), createMaintenanceWorker()];
  await scheduleMaintenanceJobs();

  logger.info('workers started', {
    event: 'worker.started',
    scanConcurrency: env.queue.scanConcurrency,
    emailConcurrency: env.queue.emailConcurrency,
    driver: env.scanner.driver,
  });
  await recordAudit({
    action: 'system.worker.started',
    category: 'system',
    outcome: 'success',
    actor: { username: 'system', displayName: 'Worker service' },
    message: 'Queue workers started',
    metadata: { queues: ['scan', 'email', 'maintenance'] },
  });

  const shutdown = async (signal) => {
    logger.info('workers shutting down', { event: 'worker.shutdown', signal });
    await Promise.allSettled(workers.map((worker) => worker.close()));
    await Promise.allSettled([closeQueues(), closeRedis(), disconnectMongo()]);
    syslogClient.close();
    process.exit(0);
  };
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => void shutdown(signal));
};

start().catch((error) => {
  logger.error('failed to start workers', { event: 'worker.start_failed', error: error.message, stack: error.stack });
  process.exit(1);
});
