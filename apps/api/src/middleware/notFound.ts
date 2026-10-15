import type { RequestHandler } from 'express';
import { notFound } from '../lib/errors.js';

export const notFoundHandler: RequestHandler = (req) => {
  throw notFound(`Route ${req.method} ${req.path} not found`);
};
