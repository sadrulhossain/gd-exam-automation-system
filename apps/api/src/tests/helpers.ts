import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import type { Express, Router } from 'express';
import { inject } from 'vitest';
import { createApp } from '../app.js';
import type { Config } from '../config/index.js';
import type { DbState, DbStatus } from '../db/index.js';
import { createLogger, type Logger } from '../lib/logger.js';
import type { AuthKit } from '../modules/auth/index.js';

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    nodeEnv: 'test',
    isProduction: false,
    port: 0,
    mongodbUri: 'mongodb://127.0.0.1:1/unused',
    jwt: {
      accessSecret: 'test-access-secret-test-access-secret',
      refreshSecret: 'test-refresh-secret-test-refresh-secret',
      accessTtl: '15m',
      refreshTtl: '7d',
    },
    corsOrigins: ['http://localhost:5173'],
    logLevel: 'silent',
    trustProxy: 0,
    rateLimit: { windowMs: 60_000, max: 10_000 },
    auth: {
      rateLimit: { windowMs: 60_000, max: 10_000 },
      lockout: { threshold: 5, baseMs: 60_000, maxMs: 3_600_000 },
    },
    ...overrides,
  };
}

export function productionConfig(overrides: Partial<Config> = {}): Config {
  return testConfig({ nodeEnv: 'production', isProduction: true, ...overrides });
}

/** A DbStatus that needs no database. */
export function fakeDb(state: DbState = 'connected'): DbStatus {
  return { state: () => state, ping: () => Promise.resolve(state === 'connected') };
}

/** A logger that records every JSON log line it receives. */
export function capturingLogger(): { logger: Logger; lines: () => Record<string, unknown>[] } {
  const raw: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      raw.push(chunk.toString());
      callback();
    },
  });
  const logger = createLogger({ logLevel: 'info' }, stream);
  return {
    logger,
    lines: () =>
      raw
        .join('')
        .split('\n')
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

export interface BuildTestAppOptions {
  config?: Config;
  logger?: Logger;
  db?: DbStatus;
  extraRouters?: readonly Router[];
  auth?: AuthKit;
}

/** Builds the real app with test defaults: silent logs, no database, generous rate limit. */
export function buildTestApp(options: BuildTestAppOptions = {}): Express {
  const config = options.config ?? testConfig();
  return createApp({
    config,
    logger: options.logger ?? createLogger(config),
    db: options.db ?? fakeDb(),
    ...(options.extraRouters === undefined ? {} : { extraRouters: options.extraRouters }),
    ...(options.auth === undefined ? {} : { auth: options.auth }),
  });
}

/** A URI for a fresh, uniquely named database on the shared in-memory mongod. */
export function uniqueDbUri(): string {
  return `${inject('mongoUri')}test_${randomUUID().replaceAll('-', '')}`;
}
