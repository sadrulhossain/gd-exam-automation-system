import type { AuditLogEntry, AuditLogQuery, Paginated } from '@eas/shared';
import { pageMeta } from '../../lib/query.js';
import type { AuditLogRecord } from '../../repositories/index.js';
import type { AdminContext } from './context.js';

function toAuditLogEntry(doc: AuditLogRecord): AuditLogEntry {
  return {
    id: doc._id.toString(),
    actorId: doc.actorId.toString(),
    actorRole: doc.actorRole,
    action: doc.action,
    targetType: doc.targetType,
    targetId: doc.targetId,
    metadata: doc.metadata,
    createdAt: doc.createdAt.toISOString(),
  };
}

export async function listAuditLogs(
  ctx: AdminContext,
  query: AuditLogQuery,
): Promise<Paginated<AuditLogEntry>> {
  const { items, total } = await ctx.repos.auditLogs.search(query);
  return { items: items.map(toAuditLogEntry), meta: pageMeta(total, query) };
}
