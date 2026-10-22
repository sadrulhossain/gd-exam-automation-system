import type { ArchivedFilter, PaginationMeta } from '@eas/shared';
import { badRequest } from './errors.js';

export interface PageRequest {
  page: number;
  limit: number;
}

export const skipFor = ({ page, limit }: PageRequest): number => (page - 1) * limit;

export function pageMeta(total: number, { page, limit }: PageRequest): PaginationMeta {
  return { page, limit, total, totalPages: Math.ceil(total / limit) };
}

export function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Case-insensitive "contains" match of `search` against any of `fields`; null when no search. */
export function searchClause(
  search: string | undefined,
  fields: readonly string[],
): Record<string, unknown> | null {
  if (search === undefined) return null;
  const pattern = new RegExp(escapeRegex(search), 'i');
  return { $or: fields.map((field) => ({ [field]: pattern })) };
}

export function archivedClause(archived: ArchivedFilter): Record<string, unknown> | null {
  if (archived === 'include') return null;
  return { isArchived: archived === 'only' };
}

/** ANDs the non-null clauses together. */
export function allOf(...clauses: (Record<string, unknown> | null)[]): Record<string, unknown> {
  const present = clauses.filter((clause) => clause !== null);
  return present.length === 0 ? {} : { $and: present };
}

/**
 * Parses `sort=name` (ascending) or `sort=-name` (descending) against an allow-list.
 * `_id` is appended so pages stay stable when the sort field has ties.
 */
export function parseSort(
  sort: string | undefined,
  allowed: readonly string[],
  fallback: Record<string, 1 | -1>,
): Record<string, 1 | -1> {
  if (sort === undefined) return { ...fallback, _id: 1 };
  const descending = sort.startsWith('-');
  const field = descending ? sort.slice(1) : sort;
  if (!allowed.includes(field)) {
    throw badRequest(`Cannot sort by "${field}"`, { allowed });
  }
  return { [field]: descending ? -1 : 1, _id: 1 };
}
