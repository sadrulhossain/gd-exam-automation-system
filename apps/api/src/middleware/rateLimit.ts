import type { RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { ERROR_CODES } from '@eas/shared';
import { AppError } from '../lib/errors.js';

export interface RateLimitOptions {
  windowMs: number;
  max: number;
}

/**
 * Per-IP limiter that reports through the shared error shape. Use a low `max` for
 * auth routes later: `app.use('/api/v1/auth', createRateLimiter({ windowMs, max: 10 }))`.
 */
export function createRateLimiter({ windowMs, max }: RateLimitOptions): RequestHandler {
  return rateLimit({
    windowMs,
    limit: max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, _res, next) => {
      next(new AppError(ERROR_CODES.RATE_LIMITED, 'Too many requests, please try again later'));
    },
  });
}
