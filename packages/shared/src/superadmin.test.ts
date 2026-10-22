import { describe, expect, it } from 'vitest';
import {
  AdminUserListQuerySchema,
  AuditLogQuerySchema,
  CreateAuthorityUserSchema,
  CreateDepartmentAdminSchema,
  DEFAULT_ROLE_PERMISSIONS,
  DepartmentListQuerySchema,
  FacultyListQuerySchema,
  PERMISSIONS,
  ROLES,
  SUPERADMIN_REQUIRED_PERMISSIONS,
  SetRolePermissionsSchema,
} from './index.js';

const ID = 'a1a1a1a1a1a1a1a1a1a1a1a1';

describe('superadmin schemas', () => {
  it('lists default to page 1, 20 items and hide archived records', () => {
    expect(FacultyListQuerySchema.parse({})).toMatchObject({
      page: 1,
      limit: 20,
      archived: 'exclude',
    });
    expect(DepartmentListQuerySchema.parse({ facultyId: ID, archived: 'only' })).toMatchObject({
      facultyId: ID,
      archived: 'only',
    });
    expect(FacultyListQuerySchema.safeParse({ archived: 'maybe' }).success).toBe(false);
  });

  it('parses user list filters from query strings', () => {
    expect(AdminUserListQuerySchema.parse({ isActive: 'false', role: 'teacher' })).toMatchObject({
      isActive: false,
      role: ROLES.TEACHER,
    });
    expect(AdminUserListQuerySchema.safeParse({ isActive: 'sometimes' }).success).toBe(false);
  });

  it('normalises account emails and requires a department only for department admins', () => {
    expect(
      CreateDepartmentAdminSchema.parse({ email: 'A@B.Test', name: 'A', departmentId: ID }).email,
    ).toBe('a@b.test');
    expect(CreateDepartmentAdminSchema.safeParse({ email: 'a@b.test', name: 'A' }).success).toBe(
      false,
    );
    expect(CreateAuthorityUserSchema.safeParse({ email: 'a@b.test', name: 'A' }).success).toBe(
      true,
    );
  });

  it('collapses duplicate permissions and rejects unknown ones', () => {
    const parsed = SetRolePermissionsSchema.parse({
      permissions: [PERMISSIONS.REPORT_VIEW, PERMISSIONS.REPORT_VIEW],
    });
    expect(parsed.permissions).toEqual([PERMISSIONS.REPORT_VIEW]);
    expect(SetRolePermissionsSchema.safeParse({ permissions: ['sudo'] }).success).toBe(false);
  });

  it('checks audit filters', () => {
    expect(AuditLogQuerySchema.safeParse({ action: 'user.deactivate' }).success).toBe(true);
    expect(AuditLogQuerySchema.safeParse({ action: 'user.explode' }).success).toBe(false);
    expect(AuditLogQuerySchema.safeParse({ from: 'yesterday' }).success).toBe(false);
  });

  it('the default superadmin grants include everything it must keep', () => {
    for (const permission of SUPERADMIN_REQUIRED_PERMISSIONS) {
      expect(DEFAULT_ROLE_PERMISSIONS[ROLES.SUPERADMIN]).toContain(permission);
    }
  });
});
