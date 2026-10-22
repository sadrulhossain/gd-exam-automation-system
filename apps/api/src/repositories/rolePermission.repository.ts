import { DEFAULT_ROLE_PERMISSIONS, ROLES, type Permission, type Role } from '@eas/shared';
import { RolePermissionModel } from '../models/index.js';
import { assertSuperadmin, type RepoScope } from './scope.js';

/**
 * Role to permission grants. Global (not department-scoped). Anyone may read a role's
 * grants (the permission guards do, on every request); changing them is superadmin-only.
 */
export class RolePermissionRepository {
  constructor(private readonly scope: RepoScope) {}

  async permissionsFor(role: Role): Promise<readonly Permission[]> {
    const doc = await RolePermissionModel.findOne({ role }).lean().exec();
    return doc === null ? [] : doc.permissions;
  }

  /** Every role with its grants; a role without a document has no permissions. */
  async listAll(): Promise<{ role: Role; permissions: Permission[] }[]> {
    const docs = await RolePermissionModel.find().lean().exec();
    const byRole = new Map(docs.map((doc) => [doc.role, doc.permissions]));
    return Object.values(ROLES).map((role) => ({ role, permissions: byRole.get(role) ?? [] }));
  }

  /** Replaces the role's grants in one document write; returns the grants it replaced. */
  async replacePermissions(role: Role, permissions: readonly Permission[]): Promise<Permission[]> {
    assertSuperadmin(this.scope);
    const before = await RolePermissionModel.findOneAndUpdate(
      { role },
      { $set: { permissions: [...permissions] } },
      { upsert: true, returnDocument: 'before', runValidators: true },
    )
      .lean()
      .exec();
    return before === null ? [] : before.permissions;
  }

  /**
   * Inserts the default grants for every role that has none yet. Existing documents are
   * left alone, so grants edited by a superadmin survive restarts. Safe to run concurrently
   * (unique index on `role`). Returns the roles that were created.
   */
  async seedDefaults(): Promise<Role[]> {
    assertSuperadmin(this.scope);
    const created: Role[] = [];
    for (const role of Object.values(ROLES)) {
      const result = await RolePermissionModel.updateOne(
        { role },
        { $setOnInsert: { role, permissions: [...DEFAULT_ROLE_PERMISSIONS[role]] } },
        { upsert: true },
      ).exec();
      if (result.upsertedCount > 0) created.push(role);
    }
    return created;
  }
}
