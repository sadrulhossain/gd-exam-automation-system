import type { RequestHandler } from 'express';
import type { z } from 'zod';
import { ERROR_CODES } from '@eas/shared';
import { AppError } from '../lib/errors.js';

export interface ValidationSchemas {
  body?: z.ZodType;
  query?: z.ZodType;
  params?: z.ZodType;
}

type Part = keyof ValidationSchemas;
const PARTS: readonly Part[] = ['body', 'query', 'params'];

type ValidatedParts = Partial<Record<Part, unknown>>;

declare module 'express-serve-static-core' {
  interface Request {
    /** Parsed and typed input, set by `validate`. Read it with `validated(req, schemas)`. */
    validated?: ValidatedParts;
  }
}

/**
 * Validates body, query and params against Zod schemas (typically from `@eas/shared`).
 * Parsed output (defaults applied, values coerced) lands on `req.validated`; Express 5
 * makes `req.query` read-only, so it is never overwritten. Fails with VALIDATION_ERROR.
 */
export function validate(schemas: ValidationSchemas): RequestHandler {
  return (req, _res, next) => {
    const parsed: ValidatedParts = {};
    const details: { location: Part; path: string; message: string }[] = [];

    for (const part of PARTS) {
      const schema = schemas[part];
      if (schema === undefined) continue;
      const result = schema.safeParse(req[part]);
      if (result.success) {
        parsed[part] = result.data;
      } else {
        for (const issue of result.error.issues) {
          details.push({ location: part, path: issue.path.join('.'), message: issue.message });
        }
      }
    }

    if (details.length > 0) {
      next(new AppError(ERROR_CODES.VALIDATION_ERROR, 'Request validation failed', { details }));
      return;
    }
    req.validated = parsed;
    next();
  };
}

type ValidatedOutput<S extends ValidationSchemas> = {
  [K in keyof S]: S[K] extends z.ZodType ? z.infer<S[K]> : never;
};

/** Typed view of what `validate(schemas)` produced: `validated<typeof schemas>(req)`. */
export function validated<S extends ValidationSchemas>(req: {
  validated?: ValidatedParts;
}): ValidatedOutput<S> {
  // The single assertion in this module: `validate` guarantees these shapes.
  return (req.validated ?? {}) as ValidatedOutput<S>;
}
