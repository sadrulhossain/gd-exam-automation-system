import { randomInt } from 'node:crypto';
import {
  AUDIT_ACTIONS,
  AUDIT_TARGET_TYPES,
  ERROR_CODES,
  ROLES,
  type AdminUserListQuery,
  type AuthUser,
  type CreateAuthorityUser,
  type CreateDepartmentAdmin,
  type Paginated,
  type TemporaryCredential,
} from '@eas/shared';
import { AppError, badRequest, notFound } from '../../lib/errors.js';
import { pageMeta, parseSort, skipFor } from '../../lib/query.js';
import type { SystemRepositories, UserRecord } from '../../repositories/index.js';
import { toAuthUser } from '../auth/auth.service.js';
import type { PasswordHasher } from '../auth/password.js';
import { audit, type AdminContext } from './context.js';

const SORT_FIELDS = ['name', 'email', 'role', 'createdAt'] as const;

// No look-alike characters (0/O, 1/l/I) because the password is read off a screen or a slip.
const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
const TEMPORARY_PASSWORD_LENGTH = 16;

export function generateTemporaryPassword(): string {
  return Array.from({ length: TEMPORARY_PASSWORD_LENGTH }, () =>
    PASSWORD_ALPHABET.charAt(randomInt(PASSWORD_ALPHABET.length)),
  ).join('');
}

const notFoundUser = () => notFound('User not found');
const invalidState = (message: string) => new AppError(ERROR_CODES.INVALID_STATE, message);

export interface UserAdminDeps {
  hasher: PasswordHasher;
  /**
   * Credential writes (password hash, token revocation) are system-scope operations. The
   * routes only reach this service after the superadmin role and permission checks.
   */
  system: SystemRepositories;
}

/** Account administration for the superadmin: create, deactivate, reactivate, reset. */
export class UserAdminService {
  constructor(private readonly deps: UserAdminDeps) {}

  async list(ctx: AdminContext, query: AdminUserListQuery): Promise<Paginated<AuthUser>> {
    const { items, total } = await ctx.repos.users.search({
      search: query.search,
      role: query.role,
      departmentId: query.departmentId,
      isActive: query.isActive,
      sort: parseSort(query.sort, SORT_FIELDS, { name: 1 }),
      skip: skipFor(query),
      limit: query.limit,
    });
    return { items: items.map(toAuthUser), meta: pageMeta(total, query) };
  }

  async get(ctx: AdminContext, id: string): Promise<AuthUser> {
    return toAuthUser(await this.require(ctx, id));
  }

  async createDepartmentAdmin(
    ctx: AdminContext,
    input: CreateDepartmentAdmin,
  ): Promise<TemporaryCredential> {
    const department = await ctx.repos.departments.findById(input.departmentId);
    if (department === null) throw notFound('Department not found');
    if (department.isArchived) throw invalidState('The department is archived');
    return this.createAccount(ctx, {
      email: input.email,
      name: input.name,
      role: ROLES.DEPT_ADMIN,
      departmentId: input.departmentId,
    });
  }

  createAuthorityUser(ctx: AdminContext, input: CreateAuthorityUser): Promise<TemporaryCredential> {
    return this.createAccount(ctx, {
      email: input.email,
      name: input.name,
      role: ROLES.AUTHORITY,
      departmentId: null,
    });
  }

  /**
   * Deactivation ends access at once (the token version is bumped) and revokes refresh
   * tokens. The last active superadmin cannot be deactivated: checked up front, and checked
   * again after the write so two superadmins deactivating each other at the same moment
   * cannot leave none (the second check reverts and refuses).
   */
  async deactivate(ctx: AdminContext, id: string): Promise<AuthUser> {
    const target = await this.require(ctx, id);
    if (!target.isActive) throw invalidState('User is already inactive');
    const guarded = target.role === ROLES.SUPERADMIN;
    if (guarded && (await ctx.repos.users.countActiveSuperadmins()) <= 1) {
      throw invalidState('The last active superadmin cannot be deactivated');
    }

    const updated = await ctx.repos.users.setActive(id, false);
    if (updated === null) throw invalidState('User is already inactive');
    if (guarded && (await ctx.repos.users.countActiveSuperadmins()) === 0) {
      await ctx.repos.users.setActive(id, true);
      throw invalidState('The last active superadmin cannot be deactivated');
    }
    await this.deps.system.refreshTokens.revokeAllForUser(id, new Date());
    await audit(ctx, {
      action: AUDIT_ACTIONS.USER_DEACTIVATE,
      targetType: AUDIT_TARGET_TYPES.USER,
      targetId: id,
      metadata: { email: updated.email, role: updated.role },
    });
    return toAuthUser(updated);
  }

  async reactivate(ctx: AdminContext, id: string): Promise<AuthUser> {
    const target = await this.require(ctx, id);
    if (target.isActive) throw invalidState('User is already active');
    const updated = await ctx.repos.users.setActive(id, true);
    if (updated === null) throw invalidState('User is already active');
    await audit(ctx, {
      action: AUDIT_ACTIONS.USER_REACTIVATE,
      targetType: AUDIT_TARGET_TYPES.USER,
      targetId: id,
      metadata: { email: updated.email, role: updated.role },
    });
    return toAuthUser(updated);
  }

  /**
   * Sets a new temporary password, forces a change at next sign-in and ends every session.
   * A superadmin cannot reset their own password here: that path would skip proving they
   * know the current one, so it goes through change-password.
   */
  async resetPassword(ctx: AdminContext, id: string): Promise<TemporaryCredential> {
    if (id === ctx.actor.userId) {
      throw badRequest('Use change-password to change your own password');
    }
    const target = await this.require(ctx, id);
    const temporaryPassword = generateTemporaryPassword();
    const { system, hasher } = this.deps;
    const version = await system.users.setPassword(id, await hasher.hash(temporaryPassword), {
      mustChangePassword: true,
    });
    if (version === null) throw notFoundUser();
    await system.refreshTokens.revokeAllForUser(id, new Date());
    await audit(ctx, {
      action: AUDIT_ACTIONS.USER_RESET_PASSWORD,
      targetType: AUDIT_TARGET_TYPES.USER,
      targetId: id,
      metadata: { email: target.email, role: target.role },
    });
    const user = await this.require(ctx, id);
    return { user: toAuthUser(user), temporaryPassword };
  }

  private async require(ctx: AdminContext, id: string): Promise<UserRecord> {
    const user = await ctx.repos.users.findById(id);
    if (user === null) throw notFoundUser();
    return user;
  }

  private async createAccount(
    ctx: AdminContext,
    account: { email: string; name: string; role: UserRecord['role']; departmentId: string | null },
  ): Promise<TemporaryCredential> {
    const temporaryPassword = generateTemporaryPassword();
    // A duplicate email is rejected by the unique index (409 DUPLICATE_KEY).
    const created = await ctx.repos.users.createWithHash({
      ...account,
      passwordHash: await this.deps.hasher.hash(temporaryPassword),
      isActive: true,
      mustChangePassword: true,
    });
    await audit(ctx, {
      action: AUDIT_ACTIONS.USER_CREATE,
      targetType: AUDIT_TARGET_TYPES.USER,
      targetId: created._id.toString(),
      metadata: {
        email: created.email,
        role: created.role,
        departmentId: account.departmentId,
      },
    });
    return { user: toAuthUser(created), temporaryPassword };
  }
}
