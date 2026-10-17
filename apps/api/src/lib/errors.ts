import { ERROR_CODES, type ErrorCode } from '@eas/shared';

/** HTTP status for every error code. Exhaustive: adding a code without a status fails typecheck. */
export const HTTP_STATUS_BY_CODE: Readonly<Record<ErrorCode, number>> = {
  [ERROR_CODES.VALIDATION_ERROR]: 400,
  [ERROR_CODES.BAD_REQUEST]: 400,
  [ERROR_CODES.UNAUTHENTICATED]: 401,
  [ERROR_CODES.INVALID_CREDENTIALS]: 401,
  [ERROR_CODES.TOKEN_EXPIRED]: 401,
  [ERROR_CODES.PASSWORD_CHANGE_REQUIRED]: 403,
  [ERROR_CODES.FORBIDDEN]: 403,
  [ERROR_CODES.NOT_FOUND]: 404,
  [ERROR_CODES.CONFLICT]: 409,
  [ERROR_CODES.DUPLICATE_KEY]: 409,
  [ERROR_CODES.INVALID_STATE]: 409,
  [ERROR_CODES.PLAN_ALREADY_PUBLISHED]: 409,
  [ERROR_CODES.INSUFFICIENT_CAPACITY]: 422,
  [ERROR_CODES.IMPORT_FAILED]: 422,
  [ERROR_CODES.RATE_LIMITED]: 429,
  [ERROR_CODES.INTERNAL_ERROR]: 500,
  [ERROR_CODES.SERVICE_UNAVAILABLE]: 503,
};

export interface AppErrorOptions {
  details?: unknown;
  /** Overrides the status derived from the code (e.g. 413 for an oversized body). */
  status?: number;
  cause?: unknown;
}

/**
 * An error that is safe to show to the client: `message` and `details` are returned
 * as-is. Anything that is not an AppError is treated as an internal error and hidden.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.status = options.status ?? HTTP_STATUS_BY_CODE[code];
    if (options.details !== undefined) this.details = options.details;
  }
}

export const badRequest = (message: string, details?: unknown): AppError =>
  new AppError(ERROR_CODES.BAD_REQUEST, message, { details });
export const unauthenticated = (message = 'Authentication required'): AppError =>
  new AppError(ERROR_CODES.UNAUTHENTICATED, message);
export const forbidden = (message = 'You do not have permission to do this'): AppError =>
  new AppError(ERROR_CODES.FORBIDDEN, message);
export const notFound = (message = 'Resource not found'): AppError =>
  new AppError(ERROR_CODES.NOT_FOUND, message);
export const conflict = (message: string, details?: unknown): AppError =>
  new AppError(ERROR_CODES.CONFLICT, message, { details });
