import { model, Schema, type Model } from 'mongoose';
import { PERMISSIONS, ROLES, type Permission, type Role } from '@eas/shared';

export interface RolePermissionDoc {
  role: Role;
  permissions: Permission[];
  createdAt: Date;
  updatedAt: Date;
}

const rolePermissionSchema = new Schema<RolePermissionDoc>(
  {
    // One document per role, enforced by the unique index (also makes seeding race-safe).
    role: { type: String, required: true, unique: true, enum: Object.values(ROLES) },
    permissions: { type: [{ type: String, enum: Object.values(PERMISSIONS) }], default: [] },
  },
  { timestamps: true },
);

export const RolePermissionModel: Model<RolePermissionDoc> = model<RolePermissionDoc>(
  'RolePermission',
  rolePermissionSchema,
);
