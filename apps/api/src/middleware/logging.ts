import type { RequestHandler } from 'express';
import { pinoHttp } from 'pino-http';
import type { Logger } from '../lib/logger.js';

/** Request logging. Requires `requestId` to run first so logs carry the same id as the response. */
export function requestLogger(logger: Logger): RequestHandler {
  return pinoHttp({
    logger,
    genReqId: (req) => req.id,
    // Headers carry credentials and cookies; log only what is needed to trace a request.
    serializers: {
      req: (req: { id: unknown; method: string; url: string; remoteAddress?: string }) => ({
        id: req.id,
        method: req.method,
        url: req.url,
        remoteAddress: req.remoteAddress,
      }),
      res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
    },
    customLogLevel: (_req, res, error) => {
      if (error !== undefined || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
    // Probes fire every few seconds; keep them out of the log unless they fail.
    autoLogging: { ignore: (req) => req.url === '/health' },
  });
}
