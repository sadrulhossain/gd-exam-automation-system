import { Router } from 'express';
import { appName, ERROR_CODES } from '@eas/shared';
import type { DbStatus } from '../../db/index.js';
import { AppError } from '../../lib/errors.js';
import type { HealthResponse, ReadyResponse } from './health.schemas.js';

export function createHealthRouter(db: DbStatus): Router {
  const router = Router();

  // Informational: always 200 so dashboards can read the DB state while it is down.
  router.get('/health', (_req, res) => {
    const state = db.state();
    const body: HealthResponse = {
      status: state === 'connected' ? 'ok' : 'degraded',
      service: appName(),
      db: { state },
    };
    res.json(body);
  });

  // Readiness: 503 until MongoDB answers a ping, so load balancers hold traffic back.
  router.get('/ready', async (_req, res) => {
    if (!(await db.ping())) {
      throw new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'Database is not ready');
    }
    const body: ReadyResponse = { status: 'ready' };
    res.json(body);
  });

  return router;
}
