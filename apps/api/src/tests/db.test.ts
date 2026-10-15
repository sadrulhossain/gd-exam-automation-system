import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { connectWithRetry, disconnectDb, mongooseDbStatus } from '../db/index.js';
import { installShutdownHandlers, start } from '../server.js';
import { capturingLogger, testConfig, buildTestApp, uniqueDbUri } from './helpers.js';

afterAll(async () => {
  await disconnectDb();
});

describe('database connection', () => {
  it('starts disconnected', () => {
    expect(mongooseDbStatus.state()).toBe('disconnected');
  });

  it('gives up with the last error after the configured attempts, logging each retry', async () => {
    const { logger, lines } = capturingLogger();
    await expect(
      connectWithRetry('mongodb://127.0.0.1:1/none', logger, {
        attempts: 3,
        initialDelayMs: 10,
        maxDelayMs: 20,
        serverSelectionTimeoutMs: 200,
      }),
    ).rejects.toThrow();

    const messages = lines().map((line) => line['msg']);
    expect(messages.filter((m) => m === 'MongoDB connection failed, retrying')).toHaveLength(2);
    expect(messages).toContain('MongoDB connection failed, giving up');
    expect(mongooseDbStatus.state()).toBe('disconnected');
    expect(await mongooseDbStatus.ping()).toBe(false);
  });

  it('connects, reports connected and answers ping; health and ready follow', async () => {
    const { logger } = capturingLogger();
    await connectWithRetry(uniqueDbUri(), logger);

    expect(mongooseDbStatus.state()).toBe('connected');
    expect(await mongooseDbStatus.ping()).toBe(true);

    const app = buildTestApp({ db: mongooseDbStatus });
    expect((await request(app).get('/api/v1/health')).body).toMatchObject({
      status: 'ok',
      db: { state: 'connected' },
    });
    expect((await request(app).get('/api/v1/ready')).status).toBe(200);

    await disconnectDb();

    expect(mongooseDbStatus.state()).toBe('disconnected');
    expect((await request(app).get('/api/v1/health')).body).toMatchObject({
      status: 'degraded',
      db: { state: 'disconnected' },
    });
    expect((await request(app).get('/api/v1/ready')).status).toBe(503);
  });
});

describe('server lifecycle', () => {
  it('serves traffic after start and closes everything on shutdown', async () => {
    const { logger } = capturingLogger();
    const running = await start(testConfig({ mongodbUri: uniqueDbUri() }), logger);

    const ready = await fetch(`http://127.0.0.1:${running.port}/api/v1/ready`);
    expect(ready.status).toBe(200);
    expect(mongooseDbStatus.state()).toBe('connected');

    await running.shutdown();
    expect(running.server.listening).toBe(false);
    expect(mongooseDbStatus.state()).toBe('disconnected');
    await expect(fetch(`http://127.0.0.1:${running.port}/health`)).rejects.toThrow();

    // A second call is a harmless no-op.
    await expect(running.shutdown()).resolves.toBeUndefined();
  });

  it('shuts down once on SIGTERM and exits 0', async () => {
    const { logger } = capturingLogger();
    let shutdowns = 0;
    const exitCodes: number[] = [];
    const exited = new Promise<void>((resolve) => {
      installShutdownHandlers(
        {
          shutdown: () => {
            shutdowns += 1;
            return Promise.resolve();
          },
        },
        logger,
        {
          signals: ['SIGTERM'],
          exit: (code) => {
            exitCodes.push(code);
            resolve();
          },
        },
      );
    });

    process.emit('SIGTERM');
    await exited;
    expect(shutdowns).toBe(1);
    expect(exitCodes).toEqual([0]);
  });

  it('exits 1 when shutdown fails', async () => {
    const { logger } = capturingLogger();
    const exited = new Promise<number>((resolve) => {
      installShutdownHandlers(
        { shutdown: () => Promise.reject(new Error('close failed')) },
        logger,
        { signals: ['SIGTERM'], exit: resolve },
      );
    });
    process.emit('SIGTERM');
    expect(await exited).toBe(1);
  });
});
