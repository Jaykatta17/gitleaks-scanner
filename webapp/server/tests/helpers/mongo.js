import mongoose from 'mongoose';

/**
 * Integration tests need a real MongoDB. In order we try:
 *   1. MONGO_TEST_URI (a server you point us at)
 *   2. mongodb-memory-server (downloads a mongod binary on first run)
 * If neither is reachable the caller skips its suite instead of failing, so the
 * unit suite still runs in restricted environments (air-gapped CI, no network).
 */
let memoryServer = null;

export const startTestMongo = async () => {
  const explicit = process.env.MONGO_TEST_URI;
  if (explicit) {
    try {
      await mongoose.connect(explicit, { serverSelectionTimeoutMS: 3000 });
      return { uri: explicit, kind: 'external' };
    } catch {
      return null;
    }
  }
  try {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    memoryServer = await MongoMemoryServer.create();
    const uri = memoryServer.getUri();
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
    return { uri, kind: 'memory' };
  } catch {
    memoryServer = null;
    return null;
  }
};

export const stopTestMongo = async () => {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  if (memoryServer) await memoryServer.stop();
  memoryServer = null;
};

export const clearCollections = async () => {
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((collection) => collection.deleteMany({})));
};
