import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from './app.js';
import { ConfigError, loadConfig, type Config } from './config/index.js';
import { connectWithRetry, disconnectDb, mongooseDbStatus } from './db/index.js';
import { createLogger, type Logger } from './lib/logger.js';

const SHUTDOWN_TIMEOUT_MS = 10_000;

export interface RunningServer {
  server: Server;
  port: number;
  /** Stops accepting connections, drains in-flight requests, closes MongoDB. Idempotent. */
  shutdown(): Promise<void>;
}

export async function start(config: Config, logger: Logger): Promise<RunningServer> {
  await connectWithRetry(config.mongodbUri, logger);

  const app = createApp({ config, logger, db: mongooseDbStatus });
  const server = await new Promise<Server>((resolve, reject) => {
    const listening = app.listen(config.port, () => resolve(listening));
    listening.once('error', reject);
  });
  const { port } = server.address() as AddressInfo;
  logger.info({ port, env: config.nodeEnv }, 'API listening');

  let closing: Promise<void> | undefined;
  const shutdown = (): Promise<void> => {
    closing ??= (async () => {
      const forceTimer = setTimeout(() => {
        logger.warn('Shutdown timed out, closing open connections');
        server.closeAllConnections();
      }, SHUTDOWN_TIMEOUT_MS);
      forceTimer.unref();
      try {
        await new Promise<void>((resolve) => {
          server.close(() => resolve());
          server.closeIdleConnections();
        });
        await disconnectDb();
        logger.info('Shutdown complete');
      } finally {
        clearTimeout(forceTimer);
      }
    })();
    return closing;
  };

  return { server, port, shutdown };
}

export interface SignalOptions {
  signals?: readonly NodeJS.Signals[];
  exit?: (code: number) => void;
}

/** Runs `shutdown` once on SIGTERM/SIGINT, then exits. */
export function installShutdownHandlers(
  running: Pick<RunningServer, 'shutdown'>,
  logger: Logger,
  { signals = ['SIGTERM', 'SIGINT'], exit = process.exit }: SignalOptions = {},
): void {
  for (const signal of signals) {
    process.once(signal, () => {
      logger.info({ signal }, 'Shutdown signal received');
      running.shutdown().then(
        () => exit(0),
        (error: unknown) => {
          logger.error({ err: error }, 'Shutdown failed');
          exit(1);
        },
      );
    });
  }
}

/** Process entrypoint: validate env, connect, serve. Invalid env exits 1 before anything starts. */
export async function main(): Promise<void> {
  let config: Config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }

  const logger = createLogger(config);
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'Unhandled promise rejection');
    process.exit(1);
  });

  try {
    const running = await start(config, logger);
    installShutdownHandlers(running, logger);
  } catch (error) {
    logger.fatal({ err: error }, 'Failed to start API');
    process.exit(1);
  }
}
