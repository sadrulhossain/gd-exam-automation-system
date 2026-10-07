import express, { type Express } from 'express';
import { appName } from '@eas/shared';

export function createApp(): Express {
  const app = express();

  const health: express.RequestHandler = (_req, res) => {
    res.json({ status: 'ok', service: appName() });
  };

  // `/health` is for infrastructure probes; `/api/v1/health` is reachable through the web proxy.
  app.get(['/health', '/api/v1/health'], health);

  return app;
}
