import { describe, expect, it } from 'vitest';
import * as shared from '@eas/shared';
import type { ApiError, Permission, Role, Room, SeatAssignment } from '@eas/shared';

const EXPECTED_VALUES = [
  'appName',
  'ROLES',
  'RoleSchema',
  'DEPARTMENT_SCOPED_ROLES',
  'PERMISSIONS',
  'PermissionSchema',
  'DEFAULT_ROLE_PERMISSIONS',
  'PLAN_STATUSES',
  'PlanStatusSchema',
  'ERROR_CODES',
  'ErrorCodeSchema',
  'ObjectIdSchema',
  'PaginationQuerySchema',
  'paginatedSchema',
  'ApiErrorSchema',
  'FacultySchema',
  'DepartmentSchema',
  'UserSchema',
  'CreateUserSchema',
  'UpdateUserSchema',
  'LoginSchema',
  'CampusSchema',
  'BuildingSchema',
  'RoomSchema',
  'CreateRoomSchema',
  'TeacherSchema',
  'StudentSchema',
  'CourseSchema',
  'ClassGroupSchema',
  'SectionSchema',
  'ExamSchema',
  'ExamSessionSchema',
  'SeatPlanSchema',
  'SeatAssignmentSchema',
  'DutyPlanSchema',
  'DutyAssignmentSchema',
  'roomCapacity',
  'isValidSeat',
] as const;

describe('@eas/shared contract', () => {
  it.each(EXPECTED_VALUES)('exports %s', (name) => {
    expect(shared[name]).toBeDefined();
  });

  it('exposes usable types and helpers', () => {
    const role: Role = shared.ROLES.TEACHER;
    const permission: Permission = shared.PERMISSIONS.REPORT_VIEW;
    const room: Pick<Room, 'rows' | 'columns' | 'blockedSeats'> = {
      rows: 2,
      columns: 3,
      blockedSeats: [],
    };
    const seat: Pick<SeatAssignment, 'row' | 'col'> = { row: 1, col: 1 };
    const error: ApiError = { error: { code: shared.ERROR_CODES.NOT_FOUND, message: 'x' } };

    expect(shared.DEFAULT_ROLE_PERMISSIONS[role]).toContain(permission);
    expect(shared.roomCapacity(room)).toBe(6);
    expect(shared.isValidSeat(room, seat.row, seat.col)).toBe(true);
    expect(shared.ApiErrorSchema.parse(error)).toEqual(error);
  });
});
