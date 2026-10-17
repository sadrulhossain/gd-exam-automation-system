import { DEFAULT_ROLE_PERMISSIONS, ROLES, type Permission, type Role } from '@eas/shared';
import { RolePermissionModel } from '../models/index.js';

/** Role to permission grants. Global (not department-scoped); managed by superadmin. */
export class RolePermissionRepository {
  async permissionsFor(role: Role): Promise<readonly Permission[]> {
    const doc = await RolePermissionModel.findOne({ role }).lean().exec();
    return doc === null ? [] : doc.permissions;
  }

  /**
   * Inserts the default grants for every role that has none yet. Existing documents are
   * left alone, so grants edited by a superadmin survive restarts. Safe to run concurrently
   * (unique index on `role`). Returns the roles that were created.
   */
  async seedDefaults(): Promise<Role[]> {
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
