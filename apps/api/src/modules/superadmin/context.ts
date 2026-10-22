import type { Request } from 'express';
import type { AuditAction, AuditTargetType, FacultyRecord, DepartmentRecord } from '@eas/shared';
import { requireAuth, requireRepos, type AuthContext } from '../../middleware/auth.js';
import type {
  DepartmentRecord as DepartmentDocRecord,
  FacultyRecord as FacultyDocRecord,
  Repositories,
} from '../../repositories/index.js';

/** Who is acting, and the repositories scoped to them. */
export interface AdminContext {
  actor: AuthContext;
  repos: Repositories;
}

export function adminContext(req: Request): AdminContext {
  return { actor: requireAuth(req), repos: requireRepos(req) };
}

export interface AuditEvent {
  action: AuditAction;
  targetType: AuditTargetType;
  targetId: string;
  /** What changed. Must never contain passwords or other secrets. */
  metadata?: Record<string, unknown>;
}

/**
 * Appends to the audit log. Every mutation in this module calls it after the change has
 * been applied. MongoDB offers no multi-document atomicity on a standalone server, so if
 * this write fails the request fails (500) even though the change was made; the log
 * therefore never claims something that did not happen, but a crash can lose an entry.
 */
export async function audit(ctx: AdminContext, event: AuditEvent): Promise<void> {
  await ctx.repos.auditLogs.record({
    actorId: ctx.actor.userId,
    actorRole: ctx.actor.role,
    ...event,
  });
}

/** `{ field: { from, to } }` for the listed fields whose value differs. */
export function diffFields<T extends object>(
  before: T,
  after: T,
  fields: readonly (keyof T & string)[],
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const field of fields) {
    const from: unknown = before[field];
    const to: unknown = after[field];
    if (String(from) !== String(to)) changes[field] = { from, to };
  }
  return changes;
}

export function toFacultyRecord(doc: FacultyDocRecord): FacultyRecord {
  return {
    id: doc._id.toString(),
    name: doc.name,
    code: doc.code,
    isArchived: doc.isArchived,
    archivedAt: doc.archivedAt === null ? null : doc.archivedAt.toISOString(),
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

export function toDepartmentRecord(doc: DepartmentDocRecord): DepartmentRecord {
  return {
    id: doc._id.toString(),
    facultyId: doc.facultyId.toString(),
    name: doc.name,
    code: doc.code,
    isArchived: doc.isArchived,
    archivedAt: doc.archivedAt === null ? null : doc.archivedAt.toISOString(),
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}
