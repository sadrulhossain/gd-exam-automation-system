import { Router } from 'express';
import type { Config } from '../config/index.js';
import type { DbStatus } from '../db/index.js';
import { createAuthRouter, type AuthKit } from './auth/index.js';
import { createHealthRouter } from './health/health.routes.js';

export interface ModuleDeps {
  db: DbStatus;
  config: Pick<Config, 'isProduction' | 'auth'>;
  auth: AuthKit;
}

/**
 * Mounts every feature module under one router (`/api/v1`). Later segments add their
 * routers here, e.g. `router.use(createRoomRouter(deps))`; guard them with `deps.auth.middleware`.
 */
export function createApiRouter(deps: ModuleDeps): Router {
  const router = Router();
  router.use(createHealthRouter(deps.db));
  router.use(
    createAuthRouter({
      config: deps.config,
      service: deps.auth.service,
      auth: deps.auth.middleware,
    }),
  );
  return router;
}
