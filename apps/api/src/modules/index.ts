import { Router } from 'express';
import type { DbStatus } from '../db/index.js';
import { createHealthRouter } from './health/health.routes.js';

export interface ModuleDeps {
  db: DbStatus;
}

/**
 * Mounts every feature module under one router (`/api/v1`). Later segments add their
 * routers here, e.g. `router.use('/auth', createAuthRouter(deps))`.
 */
export function createApiRouter(deps: ModuleDeps): Router {
  const router = Router();
  router.use(createHealthRouter(deps.db));
  return router;
}
