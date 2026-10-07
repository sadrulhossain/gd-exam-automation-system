import express, { type Express } from 'express';
import { appName } from '@eas/shared';

export function createApp(): Express {
  const app = express();

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: appName() });
  });

  return app;
}
