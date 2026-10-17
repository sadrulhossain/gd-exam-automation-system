import cookieParser from 'cookie-parser';
import express, { type Express, type Router } from 'express';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import { appName } from '@eas/shared';
import type { Config } from './config/index.js';
import type { DbStatus } from './db/index.js';
import { buildOpenApiDocument } from './docs/openapi.js';
import type { Logger } from './lib/logger.js';
import {
  corsPolicy,
  createRateLimiter,
  errorHandler,
  notFoundHandler,
  requestId,
  requestLogger,
  securityHeaders,
} from './middleware/index.js';
import { createAuthKit, type AuthKit } from './modules/auth/index.js';
import { createApiRouter } from './modules/index.js';

export const API_BASE_PATH = '/api/v1';
export const JSON_BODY_LIMIT = '100kb';

export interface AppDeps {
  config: Config;
  logger: Logger;
  db: DbStatus;
  /** Extra routers mounted under the API base path (used by tests to add probe routes). */
  extraRouters?: readonly Router[];
  /** Override the auth wiring (tests). Defaults to the kit built from `config`. */
  auth?: AuthKit;
}

export function createApp({ config, logger, db, extraRouters = [], auth }: AppDeps): Express {
  const app = express();
  app.set('trust proxy', config.trustProxy);

  app.use(requestId);
  app.use(requestLogger(logger));

  // Liveness for infrastructure probes: no DB, no CORS, no rate limit.
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: appName() });
  });

  // Interactive docs are development tooling; they are never mounted in production.
  if (!config.isProduction) {
    const document = buildOpenApiDocument();
    app.get(`${API_BASE_PATH}/docs.json`, (_req, res) => {
      res.json(document);
    });
    // Swagger UI ships inline scripts, so it gets its own helmet without a CSP.
    app.use(
      `${API_BASE_PATH}/docs`,
      helmet({ contentSecurityPolicy: false }),
      swaggerUi.serve,
      swaggerUi.setup(document),
    );
  }

  app.use(securityHeaders);
  app.use(corsPolicy(config));
  app.use(API_BASE_PATH, createRateLimiter(config.rateLimit));
  app.use(express.json({ limit: JSON_BODY_LIMIT }));
  app.use(cookieParser());

  app.use(
    API_BASE_PATH,
    createApiRouter({ db, config, auth: auth ?? createAuthKit({ config, logger }) }),
  );
  for (const router of extraRouters) app.use(API_BASE_PATH, router);

  app.use(notFoundHandler);
  app.use(errorHandler(config));
  return app;
}
