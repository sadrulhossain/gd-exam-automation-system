import { describe, expect, it } from 'vitest';
import {
  ApiErrorSchema,
  CreateClassGroupSchema,
  CreateExamSchema,
  CreateExamSessionSchema,
  CreateStudentSchema,
  CreateUserSchema,
  DEFAULT_ROLE_PERMISSIONS,
  DepartmentSchema,
  DutyAssignmentSchema,
  DutyPlanSchema,
  ERROR_CODES,
  PERMISSIONS,
  PaginationQuerySchema,
  ROLES,
  SeatAssignmentSchema,
  SeatPlanSchema,
  UpdateUserSchema,
  UserSchema,
  paginatedSchema,
  type Permission,
} from './index.js';

const id = (c: string): string => c.repeat(24);
const now = '2026-10-15T08:00:00.000Z';
const base = { id: id('a'), createdAt: now, updatedAt: now };

describe('constants', () => {
  it('grants only known permissions and covers every role', () => {
    const known = new Set<Permission>(Object.values(PERMISSIONS));
    for (const role of Object.values(ROLES)) {
      const granted = DEFAULT_ROLE_PERMISSIONS[role];
      expect(granted.length).toBeGreaterThan(0);
      for (const p of granted) expect(known.has(p)).toBe(true);
      expect(new Set(granted).size).toBe(granted.length);
    }
  });

  it('keeps the access model: students are seat-only, authority is read-only', () => {
    expect(DEFAULT_ROLE_PERMISSIONS.student).toEqual([PERMISSIONS.SEATPLAN_VIEW_OWN]);
    expect(DEFAULT_ROLE_PERMISSIONS.authority).toEqual([PERMISSIONS.REPORT_VIEW]);
    expect(DEFAULT_ROLE_PERMISSIONS.teacher).not.toContain(PERMISSIONS.DUTYPLAN_VIEW);
    expect(DEFAULT_ROLE_PERMISSIONS.teacher).toContain(PERMISSIONS.DUTYPLAN_VIEW_OWN);
    expect(DEFAULT_ROLE_PERMISSIONS.dept_admin).toContain(PERMISSIONS.SEATPLAN_PUBLISH);
    expect(DEFAULT_ROLE_PERMISSIONS.superadmin).toContain(PERMISSIONS.DEPARTMENT_MANAGE);
  });

  it('uses permission strings of the form resource.action', () => {
    for (const p of Object.values(PERMISSIONS)) expect(p).toMatch(/^[a-z]+\.[a-z_]+$/);
  });
});

describe('User schemas', () => {
  const valid = {
    email: 'Admin@Uni.EDU',
    name: 'Dept Admin',
    role: 'dept_admin',
    departmentId: id('b'),
    password: 'correct horse',
  };

  it('accepts a valid user and lowercases the email', () => {
    const user = CreateUserSchema.parse(valid);
    expect(user.email).toBe('admin@uni.edu');
    expect(user.isActive).toBe(true);
  });

  it('requires a department for department-scoped roles', () => {
    for (const role of ['dept_admin', 'teacher', 'student']) {
      const r = CreateUserSchema.safeParse({ ...valid, role, departmentId: null });
      expect(r.success).toBe(false);
    }
  });

  it('forbids a department for superadmin and authority', () => {
    for (const role of ['superadmin', 'authority']) {
      expect(CreateUserSchema.safeParse({ ...valid, role }).success).toBe(false);
      expect(CreateUserSchema.safeParse({ ...valid, role, departmentId: null }).success).toBe(true);
    }
  });

  it('rejects a bad email, short password and unknown role', () => {
    expect(CreateUserSchema.safeParse({ ...valid, email: 'not-an-email' }).success).toBe(false);
    expect(CreateUserSchema.safeParse({ ...valid, password: 'short' }).success).toBe(false);
    expect(CreateUserSchema.safeParse({ ...valid, role: 'root' }).success).toBe(false);
  });

  it('does not let a response User carry a password', () => {
    const user = UserSchema.parse({ ...base, ...valid });
    expect('password' in user).toBe(false);
  });

  it('allows partial updates', () => {
    expect(UpdateUserSchema.safeParse({ name: 'New Name' }).success).toBe(true);
    expect(UpdateUserSchema.safeParse({ name: '' }).success).toBe(false);
  });
});

describe('Department', () => {
  it('trims and validates names', () => {
    const d = DepartmentSchema.parse({
      ...base,
      facultyId: id('c'),
      name: '  Computer Science ',
      code: 'CSE',
    });
    expect(d.name).toBe('Computer Science');
    expect(
      DepartmentSchema.safeParse({ ...base, facultyId: id('c'), name: '  ', code: 'X' }).success,
    ).toBe(false);
  });
});

describe('ClassGroup', () => {
  it('requires at least one section', () => {
    expect(CreateClassGroupSchema.safeParse({ name: 'Y1', sections: [] }).success).toBe(false);
    expect(
      CreateClassGroupSchema.safeParse({ name: 'Y1', sections: [{ name: 'A' }] }).success,
    ).toBe(true);
  });

  it('rejects duplicate section names, case-insensitively', () => {
    const r = CreateClassGroupSchema.safeParse({
      name: 'Y1',
      sections: [{ name: 'A' }, { name: 'a' }],
    });
    expect(r.success).toBe(false);
  });
});

describe('Student', () => {
  it('requires a class group and section', () => {
    const ok = {
      studentId: '2026-001',
      name: 'Ada',
      classGroupId: id('d'),
      section: 'A',
    };
    expect(CreateStudentSchema.safeParse(ok).success).toBe(true);
    expect(CreateStudentSchema.safeParse({ ...ok, section: undefined }).success).toBe(false);
  });
});

describe('Exam and ExamSession', () => {
  const exam = {
    name: 'Final 2026',
    examType: 'final',
    startDate: '2026-12-01',
    endDate: '2026-12-15',
  };

  it('accepts a valid exam, including a single-day window', () => {
    expect(CreateExamSchema.safeParse(exam).success).toBe(true);
    expect(CreateExamSchema.safeParse({ ...exam, endDate: '2026-12-01' }).success).toBe(true);
  });

  it('rejects an end date before the start, and malformed dates', () => {
    expect(CreateExamSchema.safeParse({ ...exam, endDate: '2026-11-30' }).success).toBe(false);
    expect(CreateExamSchema.safeParse({ ...exam, startDate: '2026-13-01' }).success).toBe(false);
    expect(CreateExamSchema.safeParse({ ...exam, startDate: '01/12/2026' }).success).toBe(false);
  });

  const session = {
    examId: id('1'),
    courseId: id('2'),
    classGroupId: id('3'),
    date: '2026-12-02',
    startTime: '09:00',
    endTime: '12:00',
    roomIds: [id('4')],
  };

  it('accepts a valid session and defaults studentIds', () => {
    const s = CreateExamSessionSchema.parse(session);
    expect(s.studentIds).toEqual([]);
  });

  it('rejects end <= start, bad times, no rooms and duplicate rooms', () => {
    expect(CreateExamSessionSchema.safeParse({ ...session, endTime: '09:00' }).success).toBe(false);
    expect(CreateExamSessionSchema.safeParse({ ...session, startTime: '9:00' }).success).toBe(
      false,
    );
    expect(CreateExamSessionSchema.safeParse({ ...session, startTime: '24:00' }).success).toBe(
      false,
    );
    expect(CreateExamSessionSchema.safeParse({ ...session, roomIds: [] }).success).toBe(false);
    expect(
      CreateExamSessionSchema.safeParse({ ...session, roomIds: [id('4'), id('4')] }).success,
    ).toBe(false);
  });
});

describe('Plans', () => {
  const plan = {
    ...base,
    departmentId: id('b'),
    examId: id('1'),
    generatedAt: now,
  };

  it('accepts a draft without publishedAt and a published plan with it', () => {
    for (const schema of [SeatPlanSchema, DutyPlanSchema]) {
      const draft = schema.parse({ ...plan, status: 'draft' });
      expect(draft.publishedAt).toBeNull();
      expect(schema.safeParse({ ...plan, status: 'published', publishedAt: now }).success).toBe(
        true,
      );
    }
  });

  it('rejects inconsistent status and publishedAt', () => {
    for (const schema of [SeatPlanSchema, DutyPlanSchema]) {
      expect(schema.safeParse({ ...plan, status: 'published' }).success).toBe(false);
      expect(schema.safeParse({ ...plan, status: 'draft', publishedAt: now }).success).toBe(false);
      expect(schema.safeParse({ ...plan, status: 'archived' }).success).toBe(false);
    }
  });

  it('validates assignments', () => {
    const seat = {
      id: id('5'),
      seatPlanId: id('6'),
      examSessionId: id('7'),
      studentId: id('8'),
      roomId: id('9'),
      row: 1,
      col: 2,
    };
    expect(SeatAssignmentSchema.safeParse(seat).success).toBe(true);
    expect(SeatAssignmentSchema.safeParse({ ...seat, row: 0 }).success).toBe(false);

    const duty = {
      id: id('5'),
      dutyPlanId: id('6'),
      examSessionId: id('7'),
      roomId: id('9'),
      teacherId: id('8'),
    };
    expect(DutyAssignmentSchema.parse(duty).dutyRole).toBe('invigilator');
    expect(DutyAssignmentSchema.safeParse({ ...duty, dutyRole: 'boss' }).success).toBe(false);
  });
});

describe('PaginationQuery', () => {
  it('applies defaults and coerces query-string numbers', () => {
    expect(PaginationQuerySchema.parse({})).toEqual({ page: 1, limit: 20 });
    expect(PaginationQuerySchema.parse({ page: '3', limit: '50' })).toMatchObject({
      page: 3,
      limit: 50,
    });
  });

  it('rejects out-of-range values', () => {
    expect(PaginationQuerySchema.safeParse({ page: '0' }).success).toBe(false);
    expect(PaginationQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
    expect(PaginationQuerySchema.safeParse({ limit: '1.5' }).success).toBe(false);
    expect(PaginationQuerySchema.safeParse({ page: 'abc' }).success).toBe(false);
  });

  it('wraps a page of items', () => {
    const schema = paginatedSchema(DepartmentSchema);
    expect(
      schema.safeParse({ items: [], meta: { page: 1, limit: 20, total: 0, totalPages: 0 } })
        .success,
    ).toBe(true);
  });
});

describe('ApiError', () => {
  it('accepts the one error shape, with optional details', () => {
    expect(
      ApiErrorSchema.safeParse({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Nope' } }).success,
    ).toBe(true);
    expect(
      ApiErrorSchema.safeParse({
        error: { code: ERROR_CODES.VALIDATION_ERROR, message: 'Bad', details: [{ path: 'x' }] },
      }).success,
    ).toBe(true);
  });

  it('rejects unknown codes and a missing message', () => {
    expect(ApiErrorSchema.safeParse({ error: { code: 'WAT', message: 'x' } }).success).toBe(false);
    expect(ApiErrorSchema.safeParse({ error: { code: ERROR_CODES.FORBIDDEN } }).success).toBe(
      false,
    );
    expect(ApiErrorSchema.safeParse({ code: ERROR_CODES.FORBIDDEN, message: 'x' }).success).toBe(
      false,
    );
  });
});
