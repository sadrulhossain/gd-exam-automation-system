import cors from 'cors';
import type { RequestHandler } from 'express';
import helmet from 'helmet';
import type { Config } from '../config/index.js';
import { REQUEST_ID_HEADER } from './requestId.js';

export const securityHeaders: RequestHandler = helmet();

/** Explicit origin allow-list. Requests without an Origin header (curl, probes) pass through. */
export function corsPolicy(config: Pick<Config, 'corsOrigins'>): RequestHandler {
  return cors({
    origin: [...config.corsOrigins],
    credentials: true,
    exposedHeaders: [REQUEST_ID_HEADER],
    maxAge: 600,
  });
}
