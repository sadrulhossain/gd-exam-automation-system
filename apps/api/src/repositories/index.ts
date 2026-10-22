import { AuditLogRepository } from './auditLog.repository.js';
import { DepartmentRepository } from './department.repository.js';
import { FacultyRepository } from './faculty.repository.js';
import { RefreshTokenRepository } from './refreshToken.repository.js';
import { RolePermissionRepository } from './rolePermission.repository.js';
import { SYSTEM_SCOPE, type RepoScope } from './scope.js';
import { UserRepository } from './user.repository.js';

export { AuditLogRepository } from './auditLog.repository.js';
export type { AuditLogRecord, NewAuditEntry } from './auditLog.repository.js';
export { DepartmentRepository } from './department.repository.js';
export type { DepartmentRecord, DepartmentSearch } from './department.repository.js';
export { FacultyRepository } from './faculty.repository.js';
export type { FacultyRecord, FacultySearch } from './faculty.repository.js';
export { ScopedRepository } from './base.repository.js';
export type { FindOptions, Lean, ScopedRepositoryOptions } from './base.repository.js';
export { RefreshTokenRepository } from './refreshToken.repository.js';
export type { NewRefreshToken, RefreshTokenRecord } from './refreshToken.repository.js';
export { RolePermissionRepository } from './rolePermission.repository.js';
export { actorScope, SYSTEM_SCOPE } from './scope.js';
export type { ActorScope, RepoScope, SystemScope } from './scope.js';
export { UserRepository } from './user.repository.js';
export type {
  LockoutPolicy,
  NewUser,
  UserRecord,
  UserSearch,
  UserWithSecret,
} from './user.repository.js';

/**
 * The repositories a request handler may use, built for the signed-in user. Every new
 * scoped repository is added here, so handlers reach data only through `req.repos`.
 */
export interface Repositories {
  users: UserRepository;
  faculties: FacultyRepository;
  departments: DepartmentRepository;
  rolePermissions: RolePermissionRepository;
  auditLogs: AuditLogRepository;
}

export function createRepositories(scope: RepoScope): Repositories {
  return {
    users: new UserRepository(scope),
    faculties: new FacultyRepository(scope),
    departments: new DepartmentRepository(scope),
    rolePermissions: new RolePermissionRepository(scope),
    auditLogs: new AuditLogRepository(scope),
  };
}

/** Repositories for code that runs without an actor (auth, startup, seeding). */
export interface SystemRepositories extends Repositories {
  refreshTokens: RefreshTokenRepository;
}

export function createSystemRepositories(): SystemRepositories {
  return {
    ...createRepositories(SYSTEM_SCOPE),
    refreshTokens: new RefreshTokenRepository(),
  };
}
