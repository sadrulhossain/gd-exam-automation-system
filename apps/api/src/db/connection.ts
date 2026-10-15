import mongoose from 'mongoose';
import type { Logger } from '../lib/logger.js';

export type DbState = 'connected' | 'connecting' | 'disconnecting' | 'disconnected';

/** What the rest of the app needs from the database: state, and a live check. */
export interface DbStatus {
  state(): DbState;
  ping(): Promise<boolean>;
}

const STATE_BY_READY_STATE: Readonly<Record<number, DbState>> = {
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting',
};

export const mongooseDbStatus: DbStatus = {
  state: () => STATE_BY_READY_STATE[mongoose.connection.readyState] ?? 'disconnected',
  async ping() {
    if (mongoose.connection.readyState !== 1 || mongoose.connection.db === undefined) return false;
    try {
      await mongoose.connection.db.admin().ping();
      return true;
    } catch {
      return false;
    }
  },
};

export interface ConnectOptions {
  /** Total attempts, including the first. */
  attempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  serverSelectionTimeoutMs?: number;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Connects to MongoDB, retrying with exponential backoff. Rejects after the last attempt. */
export async function connectWithRetry(
  uri: string,
  logger: Logger,
  options: ConnectOptions = {},
): Promise<void> {
  const {
    attempts = 10,
    initialDelayMs = 500,
    maxDelayMs = 10_000,
    serverSelectionTimeoutMs = 5_000,
  } = options;

  for (let attempt = 1; ; attempt += 1) {
    try {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: serverSelectionTimeoutMs });
      logger.info('MongoDB connected');
      return;
    } catch (error) {
      if (attempt >= attempts) {
        logger.error({ err: error, attempt }, 'MongoDB connection failed, giving up');
        throw error;
      }
      const delay = Math.min(initialDelayMs * 2 ** (attempt - 1), maxDelayMs);
      logger.warn({ err: error, attempt, retryInMs: delay }, 'MongoDB connection failed, retrying');
      await sleep(delay);
    }
  }
}

export async function disconnectDb(): Promise<void> {
  await mongoose.disconnect();
}
