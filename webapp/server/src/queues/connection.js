import IORedis from 'ioredis';
import env from '../config/env.js';
import logger from '../config/logger.js';

/**
 * BullMQ requires `maxRetriesPerRequest: null` on the connection it blocks on,
 * so producers and workers each get their own tuned client.
 */
const baseOptions = {
  enableReadyCheck: true,
  retryStrategy: (attempt) => Math.min(attempt * 200, 5000),
};

let producerConnection = null;
const workerConnections = [];

const attachLogging = (client, role) => {
  client.on('error', (error) => logger.error('redis error', { event: 'redis.error', role, error: error.message }));
  client.on('ready', () => logger.info('redis ready', { event: 'redis.ready', role }));
  client.on('reconnecting', () => logger.warn('redis reconnecting', { event: 'redis.reconnecting', role }));
  return client;
};

export const getRedis = () => {
  if (!producerConnection) {
    producerConnection = attachLogging(new IORedis(env.redis.url, { ...baseOptions, maxRetriesPerRequest: 3 }), 'producer');
  }
  return producerConnection;
};

export const createWorkerConnection = () => {
  const client = attachLogging(
    new IORedis(env.redis.url, { ...baseOptions, maxRetriesPerRequest: null }),
    'worker',
  );
  workerConnections.push(client);
  return client;
};

export const redisHealth = async () => {
  try {
    const client = getRedis();
    const startedAt = Date.now();
    const pong = await client.ping();
    return { status: pong === 'PONG' ? 'connected' : 'degraded', latencyMs: Date.now() - startedAt };
  } catch (error) {
    return { status: 'disconnected', error: error.message };
  }
};

export const closeRedis = async () => {
  const clients = [producerConnection, ...workerConnections].filter(Boolean);
  producerConnection = null;
  workerConnections.length = 0;
  await Promise.allSettled(clients.map((client) => client.quit()));
};
