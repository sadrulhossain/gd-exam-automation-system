import { model, Schema, type Model, type Types } from 'mongoose';
import {
  AUDIT_ACTIONS,
  AUDIT_TARGET_TYPES,
  ROLES,
  type AuditAction,
  type AuditTargetType,
  type Role,
} from '@eas/shared';

export interface AuditLogDoc {
  actorId: Types.ObjectId;
  actorRole: Role;
  action: AuditAction;
  targetType: AuditTargetType;
  targetId: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

// Append-only: there is no updatedAt, and the repository exposes no update or delete.
const auditLogSchema = new Schema<AuditLogDoc>(
  {
    actorId: { type: Schema.Types.ObjectId, required: true },
    actorRole: { type: String, required: true, enum: Object.values(ROLES) },
    action: { type: String, required: true, enum: Object.values(AUDIT_ACTIONS) },
    targetType: { type: String, required: true, enum: Object.values(AUDIT_TARGET_TYPES) },
    targetId: { type: String, required: true },
    metadata: { type: Schema.Types.Mixed, required: true, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false }, minimize: false },
);

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ actorId: 1, createdAt: -1 });
auditLogSchema.index({ targetType: 1, targetId: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });

export const AuditLogModel: Model<AuditLogDoc> = model<AuditLogDoc>('AuditLog', auditLogSchema);
