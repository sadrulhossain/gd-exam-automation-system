import type { ErrorRequestHandler } from 'express';
import { ERROR_CODES, type ApiError, type ErrorCode } from '@eas/shared';
import type { Config } from '../config/index.js';
import { AppError } from '../lib/errors.js';

const MONGO_DUPLICATE_KEY = 11000;

interface HttpLikeError {
  status: number;
  message: string;
  expose: boolean;
}

/** Errors raised by Express/body-parser (malformed JSON, oversized body, ...). */
function isHttpClientError(error: unknown): error is HttpLikeError {
  if (typeof error !== 'object' || error === null) return false;
  const e = error as Partial<HttpLikeError>;
  return typeof e.status === 'number' && e.status >= 400 && e.status < 500 && e.expose === true;
}

function isDuplicateKeyError(error: unknown): error is { code: number; keyPattern?: object } {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === MONGO_DUPLICATE_KEY
  );
}

const CODE_BY_CLIENT_STATUS: Readonly<Record<number, ErrorCode>> = {
  401: ERROR_CODES.UNAUTHENTICATED,
  403: ERROR_CODES.FORBIDDEN,
  404: ERROR_CODES.NOT_FOUND,
};

function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (isDuplicateKeyError(error)) {
    // Report which fields collided, never the values.
    const fields = error.keyPattern === undefined ? [] : Object.keys(error.keyPattern);
    return new AppError(ERROR_CODES.DUPLICATE_KEY, 'A record with the same unique value exists', {
      details: { fields },
    });
  }
  if (isHttpClientError(error)) {
    return new AppError(
      CODE_BY_CLIENT_STATUS[error.status] ?? ERROR_CODES.BAD_REQUEST,
      error.message,
      { status: error.status },
    );
  }
  return new AppError(ERROR_CODES.INTERNAL_ERROR, 'Internal server error', { cause: error });
}

/**
 * Central error handler. Every failure leaves as `{ error: { code, message, details? } }`.
 * Unknown errors are reported as a generic 500; their message and stack go to the log,
 * and are added to the response only in development, never in production or test.
 */
export function errorHandler(config: Pick<Config, 'nodeEnv'>): ErrorRequestHandler {
  return (error: unknown, req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    const appError = toAppError(error);
    const unexpected = appError.code === ERROR_CODES.INTERNAL_ERROR;

    if (appError.status >= 500) {
      req.log.error({ err: unexpected ? error : appError }, 'Request failed');
    }

    let details = appError.details;
    if (unexpected && config.nodeEnv === 'development' && error instanceof Error) {
      details = { message: error.message, stack: error.stack };
    }

    const body: ApiError = {
      error: {
        code: appError.code,
        message: appError.message,
        ...(details === undefined ? {} : { details }),
      },
    };
    res.status(appError.status).json(body);
  };
}
