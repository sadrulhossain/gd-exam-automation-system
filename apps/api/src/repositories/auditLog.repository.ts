import { Types } from 'mongoose';
import type { AuditAction, AuditLogQuery, AuditTargetType, Role } from '@eas/shared';
import { allOf, skipFor } from '../lib/query.js';
import { AuditLogModel, type AuditLogDoc } from '../models/index.js';
import type { Lean } from './base.repository.js';
import { assertSuperadmin, type RepoScope } from './scope.js';

export type AuditLogRecord = Lean<AuditLogDoc>;

export interface NewAuditEntry {
  actorId: string;
  actorRole: Role;
  action: AuditAction;
  targetType: AuditTargetType;
  targetId: string;
  metadata?: Record<string, unknown>;
}

/**
 * Append-only audit trail. It deliberately offers no update or delete, and only the
 * superadmin (or trusted system code) can write or read it.
 */
export class AuditLogRepository {
  constructor(private readonly scope: RepoScope) {}

  async record(entry: NewAuditEntry): Promise<AuditLogRecord> {
    assertSuperadmin(this.scope);
    const document = new AuditLogModel({
      ...entry,
      actorId: new Types.ObjectId(entry.actorId),
      metadata: entry.metadata ?? {},
    });
    await document.save();
    return document.toObject() as AuditLogRecord;
  }

  async search(query: AuditLogQuery): Promise<{ items: AuditLogRecord[]; total: number }> {
    assertSuperadmin(this.scope);
    const range: Record<string, Date> = {};
    if (query.from !== undefined) range['$gte'] = new Date(query.from);
    if (query.to !== undefined) range['$lt'] = new Date(query.to);
    const filter = allOf(
      query.actorId === undefined ? null : { actorId: new Types.ObjectId(query.actorId) },
      query.action === undefined ? null : { action: query.action },
      query.targetType === undefined ? null : { targetType: query.targetType },
      query.targetId === undefined ? null : { targetId: query.targetId },
      Object.keys(range).length === 0 ? null : { createdAt: range },
    );
    const [items, total] = await Promise.all([
      AuditLogModel.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip(skipFor(query))
        .limit(query.limit)
        .lean()
        .exec(),
      AuditLogModel.countDocuments(filter).exec(),
    ]);
    return { items: items as AuditLogRecord[], total };
  }
}
