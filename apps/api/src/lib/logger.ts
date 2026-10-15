import { pino, type DestinationStream, type Logger } from 'pino';
import type { Config } from '../config/index.js';

export type { Logger };

/** `destination` defaults to stdout; tests pass a stream to capture log lines. */
export function createLogger(
  config: Pick<Config, 'logLevel'>,
  destination?: DestinationStream,
): Logger {
  return pino(
    {
      level: config.logLevel,
      base: { service: 'eas-api' },
      redact: {
        paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
        censor: '[redacted]',
      },
    },
    destination,
  );
}
