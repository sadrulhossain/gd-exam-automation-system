import { z } from 'zod';

export const ROLES = {
  SUPERADMIN: 'superadmin',
  DEPT_ADMIN: 'dept_admin',
  TEACHER: 'teacher',
  STUDENT: 'student',
  AUTHORITY: 'authority',
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];
export const RoleSchema = z.enum(ROLES);

/** Roles whose data is confined to a single department (they must carry a departmentId). */
export const DEPARTMENT_SCOPED_ROLES: readonly Role[] = [
  ROLES.DEPT_ADMIN,
  ROLES.TEACHER,
  ROLES.STUDENT,
];

export const PERMISSIONS = {
  DEPARTMENT_MANAGE: 'department.manage',
  USER_MANAGE: 'user.manage',
  ROLE_MANAGE: 'role.manage',
  ROOM_MANAGE: 'room.manage',
  ACADEMIC_MANAGE: 'academic.manage',
  EXAM_MANAGE: 'exam.manage',
  SEATPLAN_GENERATE: 'seatplan.generate',
  SEATPLAN_PUBLISH: 'seatplan.publish',
  SEATPLAN_VIEW: 'seatplan.view',
  SEATPLAN_VIEW_OWN: 'seatplan.view_own',
  DUTYPLAN_GENERATE: 'dutyplan.generate',
  DUTYPLAN_PUBLISH: 'dutyplan.publish',
  DUTYPLAN_VIEW: 'dutyplan.view',
  DUTYPLAN_VIEW_OWN: 'dutyplan.view_own',
  REPORT_VIEW: 'report.view',
  PROFILE_EDIT_OWN: 'profile.edit_own',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
export const PermissionSchema = z.enum(PERMISSIONS);

const P = PERMISSIONS;

/** Starting grants per role. Superadmin can override them at runtime (role.manage). */
export const DEFAULT_ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  [ROLES.SUPERADMIN]: [P.DEPARTMENT_MANAGE, P.USER_MANAGE, P.ROLE_MANAGE, P.REPORT_VIEW],
  [ROLES.DEPT_ADMIN]: [
    P.ROOM_MANAGE,
    P.ACADEMIC_MANAGE,
    P.EXAM_MANAGE,
    P.SEATPLAN_GENERATE,
    P.SEATPLAN_PUBLISH,
    P.SEATPLAN_VIEW,
    P.DUTYPLAN_GENERATE,
    P.DUTYPLAN_PUBLISH,
    P.DUTYPLAN_VIEW,
    P.REPORT_VIEW,
    P.PROFILE_EDIT_OWN,
  ],
  [ROLES.TEACHER]: [P.SEATPLAN_VIEW, P.DUTYPLAN_VIEW_OWN, P.REPORT_VIEW, P.PROFILE_EDIT_OWN],
  [ROLES.STUDENT]: [P.SEATPLAN_VIEW_OWN],
  [ROLES.AUTHORITY]: [P.REPORT_VIEW],
};

/** Plans are generated as `draft` and published by a single document update. */
export const PLAN_STATUSES = {
  DRAFT: 'draft',
  PUBLISHED: 'published',
} as const;

export type PlanStatus = (typeof PLAN_STATUSES)[keyof typeof PLAN_STATUSES];
export const PlanStatusSchema = z.enum(PLAN_STATUSES);

/** Machine-readable codes carried in `{ error: { code } }` responses. */
export const ERROR_CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  BAD_REQUEST: 'BAD_REQUEST',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  PASSWORD_CHANGE_REQUIRED: 'PASSWORD_CHANGE_REQUIRED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  DUPLICATE_KEY: 'DUPLICATE_KEY',
  INVALID_STATE: 'INVALID_STATE',
  PLAN_ALREADY_PUBLISHED: 'PLAN_ALREADY_PUBLISHED',
  INSUFFICIENT_CAPACITY: 'INSUFFICIENT_CAPACITY',
  IMPORT_FAILED: 'IMPORT_FAILED',
  RATE_LIMITED: 'RATE_LIMITED',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
export const ErrorCodeSchema = z.enum(ERROR_CODES);
