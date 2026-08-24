import mongoose from 'mongoose';
import env from '../config/env.js';
import logger from '../config/logger.js';

mongoose.set('strictQuery', true);
mongoose.set('sanitizeFilter', true); // blocks `{ $gt: '' }` style operator injection from query params

let connectPromise = null;

export const connectMongo = async (uri = env.mongo.uri) => {
  if (mongoose.connection.readyState === 1) return mongoose.connection;
  if (!connectPromise) {
    connectPromise = mongoose
      .connect(uri, {
        maxPoolSize: env.mongo.maxPoolSize,
        serverSelectionTimeoutMS: 10_000,
        autoIndex: !env.isProd,
      })
      .then((m) => {
        logger.info('mongo connected', { event: 'mongo.connected', host: m.connection.host, db: m.connection.name });
        return m.connection;
      })
      .catch((error) => {
        connectPromise = null;
        throw error;
      });
  }
  return connectPromise;
};

mongoose.connection.on('disconnected', () => {
  connectPromise = null;
  logger.warn('mongo disconnected', { event: 'mongo.disconnected' });
});
mongoose.connection.on('error', (error) => logger.error('mongo error', { event: 'mongo.error', error: error.message }));

export const disconnectMongo = async () => {
  connectPromise = null;
  await mongoose.disconnect();
};

export const mongoHealth = () => {
  const states = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  return { status: states[mongoose.connection.readyState] || 'unknown', db: mongoose.connection.name || null };
};

export default mongoose;
