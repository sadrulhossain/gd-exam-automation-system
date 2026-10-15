import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@eas/shared';
import {
  AppError,
  HTTP_STATUS_BY_CODE,
  badRequest,
  conflict,
  forbidden,
  notFound,
  unauthenticated,
} from '../lib/errors.js';

describe('AppError', () => {
  it('maps every shared error code to a 4xx or 5xx status', () => {
    for (const code of Object.values(ERROR_CODES)) {
      const status = HTTP_STATUS_BY_CODE[code];
      expect(status, code).toBeGreaterThanOrEqual(400);
      expect(status, code).toBeLessThan(600);
    }
  });

  it('derives status from the code', () => {
    expect(new AppError(ERROR_CODES.NOT_FOUND, 'x').status).toBe(404);
    expect(new AppError(ERROR_CODES.FORBIDDEN, 'x').status).toBe(403);
    expect(new AppError(ERROR_CODES.DUPLICATE_KEY, 'x').status).toBe(409);
    expect(new AppError(ERROR_CODES.RATE_LIMITED, 'x').status).toBe(429);
    expect(new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 'x').status).toBe(503);
  });

  it('allows an explicit status override', () => {
    expect(new AppError(ERROR_CODES.BAD_REQUEST, 'big', { status: 413 }).status).toBe(413);
  });

  it('carries details only when given, and keeps the cause', () => {
    const cause = new Error('root');
    const withDetails = new AppError(ERROR_CODES.VALIDATION_ERROR, 'x', {
      details: [1],
      cause,
    });
    expect(withDetails.details).toEqual([1]);
    expect(withDetails.cause).toBe(cause);
    expect(new AppError(ERROR_CODES.NOT_FOUND, 'x').details).toBeUndefined();
  });

  it('is an Error with a useful name', () => {
    const error = notFound();
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('AppError');
  });

  it('provides shorthand factories', () => {
    expect(badRequest('x').code).toBe(ERROR_CODES.BAD_REQUEST);
    expect(unauthenticated().code).toBe(ERROR_CODES.UNAUTHENTICATED);
    expect(forbidden().status).toBe(403);
    expect(notFound().status).toBe(404);
    expect(conflict('x', { a: 1 }).details).toEqual({ a: 1 });
  });
});
