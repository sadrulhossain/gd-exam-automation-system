import { z } from 'zod';
import { AuthUserSchema } from './auth.js';
import {
  DEFAULT_PAGE_SIZE,
  IsoDateTimeSchema,
  MAX_PAGE_SIZE,
  NameSchema,
  ObjectIdSchema,
  PaginationQuerySchema,
  paginatedSchema,
} from './common.js';
import { PermissionSchema, RoleSchema } from './constants.js';
import { DepartmentSchema, EmailSchema, FacultySchema } from './organization.js';

// ---- Faculties and departments -------------------------------------------------------
// Create and update bodies reuse CreateFacultySchema, UpdateFacultySchema,
// CreateDepartmentSchema and UpdateDepartmentSchema from ./organization.

/** Archived records are hidden by default; `include` shows both, `only` shows archived. */
export const ArchivedFilterSchema = z.enum(['exclude', 'include', 'only']).default('exclude');
export type ArchivedFilter = z.infer<typeof ArchivedFilterSchema>;

const archiveFields = { isArchived: z.boolean(), archivedAt: IsoDateTimeSchema.nullable() };

/** A faculty as the superadmin API returns it: the base schema plus soft-delete state. */
export const FacultyRecordSchema = FacultySchema.extend(archiveFields);
export type FacultyRecord = z.infer<typeof FacultyRecordSchema>;
export const DepartmentRecordSchema = DepartmentSchema.extend(archiveFields);
export type DepartmentRecord = z.infer<typeof DepartmentRecordSchema>;

export const FacultyListQuerySchema = PaginationQuerySchema.extend({
  archived: ArchivedFilterSchema,
});
export type FacultyListQuery = z.infer<typeof FacultyListQuerySchema>;

export const DepartmentListQuerySchema = FacultyListQuerySchema.extend({
  facultyId: ObjectIdSchema.optional(),
});
export type DepartmentListQuery = z.infer<typeof DepartmentListQuerySchema>;

export const FacultyListSchema = paginatedSchema(FacultyRecordSchema);
export const DepartmentListSchema = paginatedSchema(DepartmentRecordSchema);

export const IdParamSchema = z.object({ id: ObjectIdSchema });

// ---- Users ---------------------------------------------------------------------------

/** Department admin accounts belong to exactly one department. */
export const CreateDepartmentAdminSchema = z.object({
  email: EmailSchema,
  name: NameSchema,
  departmentId: ObjectIdSchema,
});
export type CreateDepartmentAdmin = z.infer<typeof CreateDepartmentAdminSchema>;

/** Authority accounts are read-only and belong to no department. */
export const CreateAuthorityUserSchema = z.object({ email: EmailSchema, name: NameSchema });
export type CreateAuthorityUser = z.infer<typeof CreateAuthorityUserSchema>;

export const AdminUserListQuerySchema = PaginationQuerySchema.extend({
  role: RoleSchema.optional(),
  departmentId: ObjectIdSchema.optional(),
  isActive: z.stringbool().optional(),
});
export type AdminUserListQuery = z.infer<typeof AdminUserListQuerySchema>;
export const AdminUserListSchema = paginatedSchema(AuthUserSchema);

/**
 * Returned once by account creation and password reset. The server keeps only a hash, so
 * the password cannot be shown again; the user must change it at first sign-in.
 */
export const TemporaryCredentialSchema = z.object({
  user: AuthUserSchema,
  temporaryPassword: z.string(),
});
export type TemporaryCredential = z.infer<typeof TemporaryCredentialSchema>;

// ---- Role permissions ----------------------------------------------------------------

export const RoleGrantSchema = z.object({
  role: RoleSchema,
  permissions: z.array(PermissionSchema),
});
export type RoleGrant = z.infer<typeof RoleGrantSchema>;

export const RoleListSchema = z.object({
  roles: z.array(RoleGrantSchema),
  availablePermissions: z.array(PermissionSchema),
});
export type RoleList = z.infer<typeof RoleListSchema>;

/** The complete new grant list for the role (replaces, does not merge). Duplicates collapse. */
export const SetRolePermissionsSchema = z.object({
  permissions: z
    .array(PermissionSchema)
    .max(64)
    .transform((list) => [...new Set(list)]),
});
export type SetRolePermissions = z.infer<typeof SetRolePermissionsSchema>;

export const RoleParamSchema = z.object({ role: RoleSchema });

// ---- Audit log -----------------------------------------------------------------------

export const AUDIT_ACTIONS = {
  FACULTY_CREATE: 'faculty.create',
  FACULTY_UPDATE: 'faculty.update',
  FACULTY_ARCHIVE: 'faculty.archive',
  FACULTY_RESTORE: 'faculty.restore',
  DEPARTMENT_CREATE: 'department.create',
  DEPARTMENT_UPDATE: 'department.update',
  DEPARTMENT_ARCHIVE: 'department.archive',
  DEPARTMENT_RESTORE: 'department.restore',
  USER_CREATE: 'user.create',
  USER_DEACTIVATE: 'user.deactivate',
  USER_REACTIVATE: 'user.reactivate',
  USER_RESET_PASSWORD: 'user.reset_password',
  ROLE_PERMISSIONS_UPDATE: 'role.permissions_update',
} as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];
export const AuditActionSchema = z.enum(AUDIT_ACTIONS);

export const AUDIT_TARGET_TYPES = {
  FACULTY: 'faculty',
  DEPARTMENT: 'department',
  USER: 'user',
  ROLE: 'role',
} as const;
export type AuditTargetType = (typeof AUDIT_TARGET_TYPES)[keyof typeof AUDIT_TARGET_TYPES];
export const AuditTargetTypeSchema = z.enum(AUDIT_TARGET_TYPES);

export const AuditLogEntrySchema = z.object({
  id: ObjectIdSchema,
  actorId: ObjectIdSchema,
  actorRole: RoleSchema,
  action: AuditActionSchema,
  targetType: AuditTargetTypeSchema,
  /** An object id, or the role name when the target is a role. */
  targetId: z.string(),
  /** What changed. Never contains passwords or other secrets. */
  metadata: z.record(z.string(), z.unknown()),
  createdAt: IsoDateTimeSchema,
});
export type AuditLogEntry = z.infer<typeof AuditLogEntrySchema>;

/** Newest first. `from` is inclusive, `to` is exclusive. */
export const AuditLogQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  actorId: ObjectIdSchema.optional(),
  action: AuditActionSchema.optional(),
  targetType: AuditTargetTypeSchema.optional(),
  targetId: z.string().trim().min(1).max(64).optional(),
  from: IsoDateTimeSchema.optional(),
  to: IsoDateTimeSchema.optional(),
});
export type AuditLogQuery = z.infer<typeof AuditLogQuerySchema>;
export const AuditLogListSchema = paginatedSchema(AuditLogEntrySchema);
