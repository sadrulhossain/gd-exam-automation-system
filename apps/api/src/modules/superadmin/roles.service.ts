import {
  AUDIT_ACTIONS,
  AUDIT_TARGET_TYPES,
  ERROR_CODES,
  PERMISSIONS,
  ROLES,
  SUPERADMIN_REQUIRED_PERMISSIONS,
  type Permission,
  type Role,
  type RoleGrant,
  type RoleList,
} from '@eas/shared';
import { AppError } from '../../lib/errors.js';
import { audit, type AdminContext } from './context.js';

const ALL_PERMISSIONS: readonly Permission[] = Object.values(PERMISSIONS);

/** Reads from the database on every call: there is no cache to go stale. */
export async function listRoles(ctx: AdminContext): Promise<RoleList> {
  return {
    roles: await ctx.repos.rolePermissions.listAll(),
    availablePermissions: [...ALL_PERMISSIONS],
  };
}

/**
 * Replaces a role's permissions. The permission guards read the grants from the database on
 * every request, so the change applies to the very next request of every user in that role.
 * The superadmin role must keep the permissions needed to manage users, departments and
 * roles, otherwise nobody could repair the grants through the API again.
 */
export async function setRolePermissions(
  ctx: AdminContext,
  role: Role,
  requested: readonly Permission[],
): Promise<RoleGrant> {
  const wanted = new Set(requested);
  if (role === ROLES.SUPERADMIN) {
    const missing = SUPERADMIN_REQUIRED_PERMISSIONS.filter((permission) => !wanted.has(permission));
    if (missing.length > 0) {
      throw new AppError(
        ERROR_CODES.INVALID_STATE,
        'The superadmin role must keep the permissions it needs to administer the system',
        { details: { missing } },
      );
    }
  }
  // Canonical order keeps responses and audit entries stable regardless of request order.
  const permissions = ALL_PERMISSIONS.filter((permission) => wanted.has(permission));
  const before = new Set(await ctx.repos.rolePermissions.replacePermissions(role, permissions));
  await audit(ctx, {
    action: AUDIT_ACTIONS.ROLE_PERMISSIONS_UPDATE,
    targetType: AUDIT_TARGET_TYPES.ROLE,
    targetId: role,
    metadata: {
      added: permissions.filter((permission) => !before.has(permission)),
      removed: ALL_PERMISSIONS.filter(
        (permission) => before.has(permission) && !wanted.has(permission),
      ),
    },
  });
  return { role, permissions };
}
