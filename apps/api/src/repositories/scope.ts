import { DEPARTMENT_SCOPED_ROLES, ROLES, type Role } from '@eas/shared';

/** The signed-in user, as the repository layer needs to know them. */
export interface ActorScope {
  readonly kind: 'actor';
  readonly role: Role;
  readonly userId: string;
  readonly departmentId: string | null;
}

/**
 * Trusted internal access with no actor: login, token rotation, seeding, startup tasks.
 * It bypasses every scope rule, so it must never be built from request input.
 */
export interface SystemScope {
  readonly kind: 'system';
}

export type RepoScope = ActorScope | SystemScope;

export const SYSTEM_SCOPE: SystemScope = Object.freeze({ kind: 'system' });

export function actorScope(actor: {
  role: Role;
  userId: string;
  departmentId: string | null;
}): ActorScope {
  if (DEPARTMENT_SCOPED_ROLES.includes(actor.role) && actor.departmentId === null) {
    // A department-scoped user without a department would otherwise match every row.
    throw new Error(`Role ${actor.role} requires a departmentId`);
  }
  return Object.freeze({ kind: 'actor', ...actor });
}

export const isReadOnlyScope = (scope: RepoScope): boolean =>
  scope.kind === 'actor' && (scope.role === ROLES.AUTHORITY || scope.role === ROLES.STUDENT);
