import env from './config/env.js';
import logger from './config/logger.js';
import { createApp } from './app.js';
import { connectMongo, disconnectMongo } from './db/mongoose.js';
import { closeQueues } from './queues/index.js';
import { closeRedis } from './queues/connection.js';
import syslogClient from './config/syslog.js';
import { recordAudit } from './services/audit.service.js';

const start = async () => {
  await connectMongo();
  const app = createApp();
  const server = app.listen(env.port, () => {
    logger.info('api listening', {
      event: 'server.started',
      port: env.port,
      env: env.nodeEnv,
      ldap: env.ldap.enabled,
      smtp: env.smtp.enabled,
      syslog: env.syslog.enabled,
      scanner: env.scanner.driver,
    });
  });
  await recordAudit({
    action: 'system.api.started',
    category: 'system',
    outcome: 'success',
    actor: { username: 'system', displayName: 'API service' },
    message: `${env.appName} API started on port ${env.port}`,
    metadata: { node: process.version, env: env.nodeEnv },
  });

  const shutdown = async (signal) => {
    logger.info('shutting down', { event: 'server.shutdown', signal });
    server.close();
    await recordAudit({
      action: 'system.api.stopped',
      category: 'system',
      outcome: 'success',
      actor: { username: 'system', displayName: 'API service' },
      message: `${env.appName} API stopped (${signal})`,
    });
    await Promise.allSettled([closeQueues(), closeRedis(), disconnectMongo()]);
    syslogClient.close();
    process.exit(0);
  };

  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => void shutdown(signal));
  process.on('unhandledRejection', (reason) =>
    logger.error('unhandled rejection', { event: 'process.unhandled_rejection', error: String(reason) }),
  );
  process.on('uncaughtException', (error) => {
    logger.error('uncaught exception', { event: 'process.uncaught_exception', error: error.message, stack: error.stack });
    void shutdown('uncaughtException');
  });
};

start().catch((error) => {
  logger.error('failed to start api', { event: 'server.start_failed', error: error.message, stack: error.stack });
  process.exit(1);
});
