import { z } from 'zod';
import { ErrorCodeSchema } from './constants.js';

/** MongoDB ObjectId as a 24-char hex string (how ids cross the API boundary). */
export const ObjectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
export type ObjectId = z.infer<typeof ObjectIdSchema>;

export const IsoDateTimeSchema = z.iso.datetime();
/** Calendar date, `YYYY-MM-DD`. */
export const IsoDateSchema = z.iso.date();
/** 24-hour wall-clock time, `HH:mm`. */
export const TimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:mm');

export const NameSchema = z.string().trim().min(1).max(120);
export const CodeSchema = z.string().trim().min(1).max(30);

/** Fields every persisted entity carries. */
export const entityBase = {
  id: ObjectIdSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
};

export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 20;

export const PaginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  search: z.string().trim().min(1).max(100).optional(),
  sort: z.string().trim().min(1).max(50).optional(),
});
export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;

export const PaginationMetaSchema = z.object({
  page: z.number().int().min(1),
  limit: z.number().int().min(1),
  total: z.number().int().min(0),
  totalPages: z.number().int().min(0),
});
export type PaginationMeta = z.infer<typeof PaginationMetaSchema>;

export function paginatedSchema<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item), meta: PaginationMetaSchema });
}
export type Paginated<T> = { items: T[]; meta: PaginationMeta };

/** The one error shape used by every API response. */
export const ApiErrorSchema = z.object({
  error: z.object({
    code: ErrorCodeSchema,
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
