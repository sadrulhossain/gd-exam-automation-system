import { Router } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AUDIT_ACTIONS,
  ERROR_CODES,
  PERMISSIONS,
  ROLES,
  SUPERADMIN_REQUIRED_PERMISSIONS,
  type Role,
} from '@eas/shared';
import type { AuthKit } from '../modules/auth/index.js';
import { AuditLogModel } from '../models/index.js';
import {
  bearer,
  buildAuthApp,
  createUser,
  DEPT_A,
  login,
  PASSWORD,
  startAuthDb,
  stopAuthDb,
} from './authHelpers.js';

const API = '/api/v1';
const MISSING_ID = 'c3c3c3c3c3c3c3c3c3c3c3c3';

let kit: AuthKit;
let app: ReturnType<typeof buildAuthApp>;

interface Actor {
  id: string;
  token: string;
}
const actors = {} as Record<'superadmin' | 'adminA' | 'teacher' | 'student' | 'authority', Actor>;

const as = (actor: Actor): [string, string] => bearer(actor.token);
const sa = () => as(actors.superadmin);

async function makeActor(email: string, role: Role, departmentId: string | null): Promise<Actor> {
  const user = await createUser(kit, { email, role, departmentId });
  return { id: user.id, token: (await login(app, email)).accessToken };
}

const post = (path: string, body: object = {}, who = sa()) =>
  request(app)
    .post(`${API}${path}`)
    .set(...who)
    .send(body);
const get = (path: string, who = sa()) =>
  request(app)
    .get(`${API}${path}`)
    .set(...who);
const patch = (path: string, body: object, who = sa()) =>
  request(app)
    .patch(`${API}${path}`)
    .set(...who)
    .send(body);
const del = (path: string, who = sa()) =>
  request(app)
    .delete(`${API}${path}`)
    .set(...who);
const put = (path: string, body: object, who = sa()) =>
  request(app)
    .put(`${API}${path}`)
    .set(...who)
    .send(body);

let nextCode = 0;
const code = (prefix: string) => `${prefix}${++nextCode}`;

async function newFaculty(name = 'Faculty of Science'): Promise<{ id: string; code: string }> {
  const res = await post('/faculties', { name, code: code('fac') });
  expect(res.status).toBe(201);
  return { id: res.body.id as string, code: res.body.code as string };
}

async function newDepartment(
  facultyId: string,
  name = 'Computer Science',
): Promise<{ id: string; code: string }> {
  const res = await post('/departments', { facultyId, name, code: code('dep') });
  expect(res.status).toBe(201);
  return { id: res.body.id as string, code: res.body.code as string };
}

const auditCount = () => AuditLogModel.countDocuments();

beforeAll(async () => {
  kit = await startAuthDb();
  const probe = Router();
  // A route guarded by a permission an admin can grant or revoke at runtime.
  probe.get(
    '/probe/report',
    kit.middleware.authenticate(),
    kit.middleware.requirePermission(PERMISSIONS.REPORT_VIEW),
    (_req, res) => {
      res.json({ ok: true });
    },
  );
  app = buildAuthApp(kit, undefined, [probe]);

  actors.superadmin = await makeActor('root@example.test', ROLES.SUPERADMIN, null);
  actors.adminA = await makeActor('admin-a@example.test', ROLES.DEPT_ADMIN, DEPT_A);
  actors.teacher = await makeActor('teacher@example.test', ROLES.TEACHER, DEPT_A);
  actors.student = await makeActor('student@example.test', ROLES.STUDENT, DEPT_A);
  actors.authority = await makeActor('authority@example.test', ROLES.AUTHORITY, null);
});
afterAll(stopAuthDb);

describe('access control', () => {
  const ENDPOINTS: readonly (readonly [string, string, object?])[] = [
    ['get', '/faculties'],
    ['post', '/faculties', { name: 'X', code: 'X' }],
    ['get', `/faculties/${MISSING_ID}`],
    ['patch', `/faculties/${MISSING_ID}`, { name: 'Y' }],
    ['delete', `/faculties/${MISSING_ID}`],
    ['post', `/faculties/${MISSING_ID}/restore`],
    ['get', '/departments'],
    ['post', '/departments', { facultyId: MISSING_ID, name: 'X', code: 'X' }],
    ['get', `/departments/${MISSING_ID}`],
    ['patch', `/departments/${MISSING_ID}`, { name: 'Y' }],
    ['delete', `/departments/${MISSING_ID}`],
    ['post', `/departments/${MISSING_ID}/restore`],
    ['get', '/users'],
    ['get', `/users/${MISSING_ID}`],
    [
      'post',
      '/users/department-admins',
      { email: 'x@example.test', name: 'X', departmentId: MISSING_ID },
    ],
    ['post', '/users/authority-users', { email: 'x@example.test', name: 'X' }],
    ['post', `/users/${MISSING_ID}/deactivate`],
    ['post', `/users/${MISSING_ID}/reactivate`],
    ['post', `/users/${MISSING_ID}/reset-password`],
    ['get', '/roles'],
    ['put', '/roles/teacher/permissions', { permissions: [] }],
    ['get', '/audit-logs'],
  ];

  const send = (method: string, path: string, body: object | undefined, who?: [string, string]) => {
    const req = request(app)[method as 'get'](`${API}${path}`);
    if (who !== undefined) void req.set(...who);
    return body === undefined ? req : req.send(body);
  };

  const cases = ENDPOINTS.map(([method, path, body]) => ({ method, path, body }));
  it.each(cases)('$method $path rejects anonymous callers', async ({ method, path, body }) => {
    const res = await send(method, path, body);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe(ERROR_CODES.UNAUTHENTICATED);
  });

  it.each(['adminA', 'teacher', 'student', 'authority'] as const)(
    'forbids %s on every endpoint and records nothing',
    async (who) => {
      const before = await auditCount();
      for (const [method, path, body] of ENDPOINTS) {
        const res = await send(method, path, body, as(actors[who]));
        expect(res.status, `${method} ${path}`).toBe(403);
        expect(res.body.error.code).toBe(ERROR_CODES.FORBIDDEN);
      }
      expect(await auditCount()).toBe(before);
    },
  );

  it('keeps routes superadmin-only even if another role is granted the permissions', async () => {
    const granted = [
      PERMISSIONS.DEPARTMENT_MANAGE,
      PERMISSIONS.USER_MANAGE,
      PERMISSIONS.ROLE_MANAGE,
    ];
    await kit.repos.rolePermissions.replacePermissions(ROLES.DEPT_ADMIN, granted);
    try {
      expect((await get('/roles', as(actors.adminA))).status).toBe(403);
      expect((await get('/faculties', as(actors.adminA))).status).toBe(403);
      expect((await get('/audit-logs', as(actors.adminA))).status).toBe(403);
    } finally {
      await kit.repos.rolePermissions.replacePermissions(ROLES.DEPT_ADMIN, [
        PERMISSIONS.ROOM_MANAGE,
        PERMISSIONS.REPORT_VIEW,
      ]);
    }
  });

  it('requires the specific permission, not just the role', async () => {
    await kit.repos.rolePermissions.replacePermissions(ROLES.SUPERADMIN, [
      PERMISSIONS.USER_MANAGE,
      PERMISSIONS.ROLE_MANAGE,
    ]);
    try {
      expect((await get('/faculties')).status).toBe(403);
      expect((await get('/users')).status).toBe(200);
    } finally {
      await kit.repos.rolePermissions.replacePermissions(ROLES.SUPERADMIN, [
        ...SUPERADMIN_REQUIRED_PERMISSIONS,
        PERMISSIONS.REPORT_VIEW,
      ]);
    }
  });
});

describe('faculties', () => {
  it('creates a faculty, normalising the code', async () => {
    const res = await post('/faculties', { name: '  Engineering ', code: ' eng ' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      name: 'Engineering',
      code: 'ENG',
      isArchived: false,
      archivedAt: null,
    });
    expect(res.body.id).toMatch(/^[a-f\d]{24}$/);
  });

  it('rejects a duplicate code regardless of case (unique index)', async () => {
    const first = await newFaculty();
    const res = await post('/faculties', { name: 'Other', code: first.code.toLowerCase() });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({
      code: ERROR_CODES.DUPLICATE_KEY,
      details: { fields: ['code'] },
    });
  });

  it('rejects an archived faculty code too, so a restore can never collide', async () => {
    const first = await newFaculty();
    expect((await del(`/faculties/${first.id}`)).status).toBe(200);
    expect((await post('/faculties', { name: 'Again', code: first.code })).status).toBe(409);
  });

  it.each([
    ['missing name', { code: 'A' }],
    ['empty code', { name: 'A', code: '  ' }],
    ['overlong name', { name: 'x'.repeat(121), code: 'A' }],
  ])('validates input: %s', async (_name, body) => {
    const res = await post('/faculties', body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(ERROR_CODES.VALIDATION_ERROR);
  });

  it('gets one faculty, 404 when unknown, 400 for a malformed id', async () => {
    const { id } = await newFaculty();
    expect((await get(`/faculties/${id}`)).body.id).toBe(id);
    const missing = await get(`/faculties/${MISSING_ID}`);
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe(ERROR_CODES.NOT_FOUND);
    expect((await get('/faculties/not-an-id')).status).toBe(400);
  });

  it('updates name and code', async () => {
    const { id } = await newFaculty();
    const res = await patch(`/faculties/${id}`, { name: 'Renamed', code: 'ren-1' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: 'Renamed', code: 'REN-1' });
  });

  it('rejects an empty update and a code that collides', async () => {
    const a = await newFaculty();
    const b = await newFaculty();
    expect((await patch(`/faculties/${a.id}`, {})).status).toBe(400);
    const clash = await patch(`/faculties/${b.id}`, { code: a.code });
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe(ERROR_CODES.DUPLICATE_KEY);
    expect((await patch(`/faculties/${MISSING_ID}`, { name: 'Z' })).status).toBe(404);
  });

  it('archives (soft delete), hides from the default list, and restores', async () => {
    const { id } = await newFaculty('Archivable Faculty');
    const archived = await del(`/faculties/${id}`);
    expect(archived.status).toBe(200);
    expect(archived.body.isArchived).toBe(true);
    expect(archived.body.archivedAt).toEqual(expect.any(String));

    // The record still exists (soft delete) and can be fetched directly.
    expect((await get(`/faculties/${id}`)).body.isArchived).toBe(true);
    const hidden = await get('/faculties?search=Archivable');
    expect(hidden.body.items).toHaveLength(0);

    expect((await del(`/faculties/${id}`)).status).toBe(409);
    expect((await patch(`/faculties/${id}`, { name: 'Nope' })).status).toBe(409);

    const restored = await post(`/faculties/${id}/restore`);
    expect(restored.status).toBe(200);
    expect(restored.body).toMatchObject({ isArchived: false, archivedAt: null });
    expect((await post(`/faculties/${id}/restore`)).status).toBe(409);
    expect((await get('/faculties?search=Archivable')).body.items).toHaveLength(1);
  });

  it('does not archive a faculty that still has active departments', async () => {
    const faculty = await newFaculty();
    const dept = await newDepartment(faculty.id);
    const blocked = await del(`/faculties/${faculty.id}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toMatchObject({
      code: ERROR_CODES.INVALID_STATE,
      details: { activeDepartments: 1 },
    });
    await del(`/departments/${dept.id}`);
    expect((await del(`/faculties/${faculty.id}`)).status).toBe(200);
  });

  describe('listing', () => {
    const tag = code('LIST');
    beforeAll(async () => {
      for (const name of ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo']) {
        const res = await post('/faculties', { name: `${tag} ${name}`, code: `${tag}-${name}` });
        if (name === 'Echo') await del(`/faculties/${res.body.id as string}`);
      }
    });

    it('paginates with metadata', async () => {
      const first = await get(`/faculties?search=${tag}&limit=2&page=1`);
      expect(first.status).toBe(200);
      expect(first.body.meta).toEqual({ page: 1, limit: 2, total: 4, totalPages: 2 });
      expect(first.body.items.map((f: { name: string }) => f.name)).toEqual([
        `${tag} Alpha`,
        `${tag} Bravo`,
      ]);
      const second = await get(`/faculties?search=${tag}&limit=2&page=2`);
      expect(second.body.items.map((f: { name: string }) => f.name)).toEqual([
        `${tag} Charlie`,
        `${tag} Delta`,
      ]);
      expect((await get(`/faculties?search=${tag}&limit=2&page=3`)).body.items).toEqual([]);
    });

    it('searches name and code case-insensitively', async () => {
      expect((await get(`/faculties?search=${tag.toLowerCase()} bravo`)).body.items).toHaveLength(
        1,
      );
      expect((await get(`/faculties?search=${tag.toLowerCase()}-delta`)).body.items).toHaveLength(
        1,
      );
    });

    it('treats the search text literally, not as a pattern', async () => {
      const res = await get('/faculties?search=.*');
      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(0);
    });

    it('sorts ascending and descending, and rejects unknown sort fields', async () => {
      const desc = await get(`/faculties?search=${tag}&sort=-name`);
      expect(desc.body.items[0].name).toBe(`${tag} Delta`);
      expect((await get(`/faculties?search=${tag}&sort=passwordHash`)).status).toBe(400);
    });

    it('filters archived records with include and only', async () => {
      expect((await get(`/faculties?search=${tag}&archived=include`)).body.meta.total).toBe(5);
      const only = await get(`/faculties?search=${tag}&archived=only`);
      expect(only.body.items.map((f: { name: string }) => f.name)).toEqual([`${tag} Echo`]);
      expect((await get('/faculties?archived=bogus')).status).toBe(400);
    });

    it('rejects bad paging values', async () => {
      expect((await get('/faculties?page=0')).status).toBe(400);
      expect((await get('/faculties?limit=101')).status).toBe(400);
    });
  });
});

describe('departments', () => {
  it('creates a department under a faculty', async () => {
    const faculty = await newFaculty();
    const res = await post('/departments', { facultyId: faculty.id, name: 'Physics', code: 'phy' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      facultyId: faculty.id,
      name: 'Physics',
      code: 'PHY',
      isArchived: false,
    });
  });

  it('keeps codes unique within a faculty but reusable across faculties', async () => {
    const f1 = await newFaculty();
    const f2 = await newFaculty();
    const body = { name: 'Mathematics', code: 'math' };
    expect((await post('/departments', { ...body, facultyId: f1.id })).status).toBe(201);
    const clash = await post('/departments', { ...body, code: 'MATH', facultyId: f1.id });
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe(ERROR_CODES.DUPLICATE_KEY);
    expect((await post('/departments', { ...body, facultyId: f2.id })).status).toBe(201);
  });

  it('requires an existing, active faculty', async () => {
    const missing = await post('/departments', { facultyId: MISSING_ID, name: 'X', code: 'X' });
    expect(missing.status).toBe(404);
    const faculty = await newFaculty();
    await del(`/faculties/${faculty.id}`);
    const archived = await post('/departments', { facultyId: faculty.id, name: 'X', code: 'X' });
    expect(archived.status).toBe(409);
    expect(archived.body.error.code).toBe(ERROR_CODES.INVALID_STATE);
    expect((await post('/departments', { name: 'X', code: 'X' })).status).toBe(400);
  });

  it('gets, updates and moves a department between faculties', async () => {
    const f1 = await newFaculty();
    const f2 = await newFaculty();
    const dept = await newDepartment(f1.id);
    expect((await get(`/departments/${dept.id}`)).body.facultyId).toBe(f1.id);
    expect((await get(`/departments/${MISSING_ID}`)).status).toBe(404);

    const renamed = await patch(`/departments/${dept.id}`, { name: 'New Name' });
    expect(renamed.body.name).toBe('New Name');
    const moved = await patch(`/departments/${dept.id}`, { facultyId: f2.id });
    expect(moved.body.facultyId).toBe(f2.id);
    expect((await patch(`/departments/${dept.id}`, { facultyId: MISSING_ID })).status).toBe(404);
    expect((await patch(`/departments/${dept.id}`, {})).status).toBe(400);
  });

  it('refuses a move that collides with a code in the target faculty', async () => {
    const f1 = await newFaculty();
    const f2 = await newFaculty();
    await post('/departments', { facultyId: f2.id, name: 'Chem', code: 'SAME' });
    const dept = await post('/departments', { facultyId: f1.id, name: 'Chem 2', code: 'SAME' });
    const res = await patch(`/departments/${dept.body.id as string}`, { facultyId: f2.id });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe(ERROR_CODES.DUPLICATE_KEY);
  });

  it('archives, restores, and blocks restore under an archived faculty', async () => {
    const faculty = await newFaculty();
    const dept = await newDepartment(faculty.id, 'Archivable Dept');
    const archived = await del(`/departments/${dept.id}`);
    expect(archived.body).toMatchObject({ isArchived: true });
    expect((await del(`/departments/${dept.id}`)).status).toBe(409);
    expect((await patch(`/departments/${dept.id}`, { name: 'Nope' })).status).toBe(409);
    expect((await get('/departments?search=Archivable')).body.items).toHaveLength(0);

    await del(`/faculties/${faculty.id}`);
    expect((await post(`/departments/${dept.id}/restore`)).status).toBe(409);
    await post(`/faculties/${faculty.id}/restore`);
    const restored = await post(`/departments/${dept.id}/restore`);
    expect(restored.body).toMatchObject({ isArchived: false, archivedAt: null });
    expect((await post(`/departments/${dept.id}/restore`)).status).toBe(409);
  });

  it('lists with search, faculty filter, sort, pagination and archived filter', async () => {
    const faculty = await newFaculty();
    const other = await newFaculty();
    for (const name of ['Zoology', 'Botany', 'Genetics']) {
      await post('/departments', { facultyId: faculty.id, name, code: name.slice(0, 3) });
    }
    const gone = await post('/departments', {
      facultyId: faculty.id,
      name: 'Retired',
      code: 'RET',
    });
    await del(`/departments/${gone.body.id as string}`);
    await post('/departments', { facultyId: other.id, name: 'Elsewhere', code: 'ELS' });

    const list = await get(`/departments?facultyId=${faculty.id}`);
    expect(list.body.items.map((d: { name: string }) => d.name)).toEqual([
      'Botany',
      'Genetics',
      'Zoology',
    ]);
    expect(list.body.meta.total).toBe(3);
    const paged = await get(`/departments?facultyId=${faculty.id}&limit=2&page=2&sort=-name`);
    expect(paged.body.items.map((d: { name: string }) => d.name)).toEqual(['Botany']);
    expect((await get(`/departments?facultyId=${faculty.id}&search=gen`)).body.items).toHaveLength(
      1,
    );
    expect(
      (await get(`/departments?facultyId=${faculty.id}&archived=only`)).body.items[0].name,
    ).toBe('Retired');
    expect((await get('/departments?facultyId=bad')).status).toBe(400);
  });
});

describe('user administration', () => {
  async function newDeptAdmin(email: string) {
    const faculty = await newFaculty();
    const dept = await newDepartment(faculty.id);
    const res = await post('/users/department-admins', {
      email,
      name: 'Dept Admin',
      departmentId: dept.id,
    });
    expect(res.status).toBe(201);
    return {
      id: res.body.user.id as string,
      password: res.body.temporaryPassword as string,
      departmentId: dept.id,
    };
  }

  it('creates a department admin with a one-time temporary password', async () => {
    const faculty = await newFaculty();
    const dept = await newDepartment(faculty.id);
    const res = await post('/users/department-admins', {
      email: 'New.Admin@Example.Test',
      name: 'New Admin',
      departmentId: dept.id,
    });
    expect(res.status).toBe(201);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.user).toMatchObject({
      email: 'new.admin@example.test',
      role: ROLES.DEPT_ADMIN,
      departmentId: dept.id,
      isActive: true,
      mustChangePassword: true,
    });
    expect(res.body.temporaryPassword).toMatch(/^[A-Za-z0-9]{16}$/);
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|argon2/);
  });

  it('gives each account a different temporary password', async () => {
    const a = await newDeptAdmin('gen-a@example.test');
    const b = await newDeptAdmin('gen-b@example.test');
    expect(a.password).not.toBe(b.password);
  });

  it('lets the new admin sign in but forces a password change before anything else', async () => {
    const admin = await newDeptAdmin('first-login@example.test');
    const session = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: 'first-login@example.test', password: admin.password });
    expect(session.status).toBe(200);
    expect(session.body.user.mustChangePassword).toBe(true);
    const token = session.body.accessToken as string;

    const blocked = await get('/users', bearer(token));
    expect(blocked.status).toBe(403);

    const changed = await request(app)
      .post(`${API}/auth/change-password`)
      .set(...bearer(token))
      .send({ currentPassword: admin.password, newPassword: 'a-brand-new-password' });
    expect(changed.status).toBe(200);
    expect(changed.body.user.mustChangePassword).toBe(false);
  });

  it('creates an authority user without a department', async () => {
    const res = await post('/users/authority-users', {
      email: 'auth-new@example.test',
      name: 'Registrar',
    });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({
      role: ROLES.AUTHORITY,
      departmentId: null,
      mustChangePassword: true,
    });
    expect(res.body.temporaryPassword).toHaveLength(16);
  });

  it('rejects duplicate emails, bad input, and missing or archived departments', async () => {
    const admin = await newDeptAdmin('dupe@example.test');
    const dupe = await post('/users/department-admins', {
      email: 'DUPE@example.test',
      name: 'Again',
      departmentId: admin.departmentId,
    });
    expect(dupe.status).toBe(409);
    expect(dupe.body.error.code).toBe(ERROR_CODES.DUPLICATE_KEY);
    expect(
      (await post('/users/authority-users', { email: 'dupe@example.test', name: 'X' })).status,
    ).toBe(409);

    expect(
      (
        await post('/users/department-admins', {
          email: 'not-an-email',
          name: 'X',
          departmentId: admin.departmentId,
        })
      ).status,
    ).toBe(400);
    expect((await post('/users/authority-users', { email: 'ok@example.test' })).status).toBe(400);

    const unknown = await post('/users/department-admins', {
      email: 'ghost@example.test',
      name: 'X',
      departmentId: MISSING_ID,
    });
    expect(unknown.status).toBe(404);

    await del(`/departments/${admin.departmentId}`);
    const archived = await post('/users/department-admins', {
      email: 'late@example.test',
      name: 'X',
      departmentId: admin.departmentId,
    });
    expect(archived.status).toBe(409);
    expect(archived.body.error.code).toBe(ERROR_CODES.INVALID_STATE);
  });

  it('lists users with filters and pagination, and gets one', async () => {
    const admin = await newDeptAdmin('listed-admin@example.test');
    const all = await get('/users?limit=100');
    expect(all.status).toBe(200);
    expect(all.body.meta.total).toBeGreaterThan(4);
    expect(JSON.stringify(all.body)).not.toMatch(/passwordHash|argon2/);

    const byDept = await get(`/users?departmentId=${admin.departmentId}`);
    expect(byDept.body.items.map((u: { email: string }) => u.email)).toEqual([
      'listed-admin@example.test',
    ]);
    expect((await get('/users?role=authority&search=authority@')).body.items).toHaveLength(1);
    expect((await get('/users?isActive=false&role=dept_admin')).body.items).toEqual(
      expect.any(Array),
    );
    expect((await get('/users?limit=2&page=2&sort=email')).body.items).toHaveLength(2);
    expect((await get('/users?role=wizard')).status).toBe(400);

    const one = await get(`/users/${admin.id}`);
    expect(one.body.user).toMatchObject({ id: admin.id, role: ROLES.DEPT_ADMIN });
    expect((await get(`/users/${MISSING_ID}`)).status).toBe(404);
  });

  it('deactivates a user: tokens and sign-in stop working at once, then reactivates', async () => {
    const target = await createUser(kit, { email: 'victim@example.test', role: ROLES.TEACHER });
    const tokens = await login(app, 'victim@example.test');

    const res = await post(`/users/${target.id}/deactivate`);
    expect(res.status).toBe(200);
    expect(res.body.user.isActive).toBe(false);

    const me = await get('/probe/report', bearer(tokens.accessToken));
    expect(me.status).toBe(401);
    const refresh = await request(app)
      .post(`${API}/auth/refresh`)
      .send({ refreshToken: tokens.refreshToken });
    expect(refresh.status).toBe(401);
    const relogin = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: target.email, password: PASSWORD });
    expect(relogin.status).toBe(403);

    expect((await post(`/users/${target.id}/deactivate`)).status).toBe(409);

    const back = await post(`/users/${target.id}/reactivate`);
    expect(back.status).toBe(200);
    expect(back.body.user.isActive).toBe(true);
    expect((await login(app, target.email)).accessToken).toEqual(expect.any(String));
    expect((await post(`/users/${target.id}/reactivate`)).status).toBe(409);
    expect((await post(`/users/${MISSING_ID}/deactivate`)).status).toBe(404);
    expect((await post(`/users/${MISSING_ID}/reactivate`)).status).toBe(404);
  });

  it('reactivation clears a login lockout', async () => {
    const target = await createUser(kit, { email: 'locked@example.test', role: ROLES.TEACHER });
    for (let i = 0; i < 5; i += 1) {
      await request(app).post(`${API}/auth/login`).send({ email: target.email, password: 'wrong' });
    }
    expect(
      (
        await request(app)
          .post(`${API}/auth/login`)
          .send({ email: target.email, password: PASSWORD })
      ).status,
    ).toBe(429);
    await post(`/users/${target.id}/deactivate`);
    await post(`/users/${target.id}/reactivate`);
    expect((await login(app, target.email)).accessToken).toEqual(expect.any(String));
  });

  it('resets a password: new temporary password works, old one and old sessions do not', async () => {
    const target = await createUser(kit, { email: 'reset@example.test', role: ROLES.TEACHER });
    const old = await login(app, target.email);

    const res = await post(`/users/${target.id}/reset-password`);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.user.mustChangePassword).toBe(true);
    const temporary = res.body.temporaryPassword as string;
    expect(temporary).toHaveLength(16);

    expect((await get('/probe/report', bearer(old.accessToken))).status).toBe(401);
    expect(
      (await request(app).post(`${API}/auth/refresh`).send({ refreshToken: old.refreshToken }))
        .status,
    ).toBe(401);
    expect(
      (
        await request(app)
          .post(`${API}/auth/login`)
          .send({ email: target.email, password: PASSWORD })
      ).status,
    ).toBe(401);
    const fresh = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: target.email, password: temporary });
    expect(fresh.status).toBe(200);
    expect(fresh.body.user.mustChangePassword).toBe(true);
    expect((await post(`/users/${MISSING_ID}/reset-password`)).status).toBe(404);
  });

  it('does not let a superadmin reset their own password through this endpoint', async () => {
    const res = await post(`/users/${actors.superadmin.id}/reset-password`);
    expect(res.status).toBe(400);
    expect((await get('/users', sa())).status).toBe(200);
  });

  describe('last active superadmin', () => {
    it('cannot be deactivated, not even by themselves', async () => {
      const res = await post(`/users/${actors.superadmin.id}/deactivate`);
      expect(res.status).toBe(409);
      expect(res.body.error).toMatchObject({
        code: ERROR_CODES.INVALID_STATE,
        message: expect.stringMatching(/last active superadmin/i) as string,
      });
      expect((await get('/users')).status).toBe(200);
    });

    it('can be deactivated once another superadmin is active, but then the other is the last', async () => {
      const second = await createUser(kit, { email: 'root2@example.test', role: ROLES.SUPERADMIN });
      const secondToken = (await login(app, second.email)).accessToken;

      expect((await post(`/users/${second.id}/deactivate`)).status).toBe(200);
      expect((await get('/users', bearer(secondToken))).status).toBe(401);
      expect((await post(`/users/${actors.superadmin.id}/deactivate`)).status).toBe(409);

      await post(`/users/${second.id}/reactivate`);
      const refreshed = (await login(app, second.email)).accessToken;
      // Now the original can step down because root2 stays active.
      expect(
        (await post(`/users/${actors.superadmin.id}/deactivate`, {}, bearer(refreshed))).status,
      ).toBe(200);
      // And root2 is protected.
      expect((await post(`/users/${second.id}/deactivate`, {}, bearer(refreshed))).status).toBe(
        409,
      );
      await post(`/users/${actors.superadmin.id}/reactivate`, {}, bearer(refreshed));
      actors.superadmin.token = (await login(app, 'root@example.test')).accessToken;
    });

    it('survives two superadmins deactivating each other at the same moment', async () => {
      const a = actors.superadmin;
      const b = await createUser(kit, { email: 'root3@example.test', role: ROLES.SUPERADMIN });
      const bToken = (await login(app, b.email)).accessToken;
      // Park the superadmin created by the previous test so exactly two remain active.
      const parked = await kit.repos.users.findForLogin('root2@example.test');
      await kit.repos.users.setActive(parked?._id ?? MISSING_ID, false);
      expect(await kit.repos.users.countActiveSuperadmins()).toBe(2);

      const results = await Promise.all([
        post(`/users/${b.id}/deactivate`, {}, as(a)),
        post(`/users/${a.id}/deactivate`, {}, bearer(bToken)),
      ]);
      const statuses = results.map((r) => r.status);
      // At most one deactivation may stand, so at least one superadmin is always left.
      expect(statuses.filter((s) => s === 200).length).toBeLessThanOrEqual(1);
      expect(await kit.repos.users.countActiveSuperadmins()).toBeGreaterThanOrEqual(1);

      await kit.repos.users.setActive(b.id, true);
      await kit.repos.users.setActive(a.id, true);
      actors.superadmin.token = (await login(app, 'root@example.test')).accessToken;
    });
  });
});

describe('role permissions', () => {
  it('lists every role with its grants and the available permissions', async () => {
    const res = await get('/roles');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.roles.map((r: { role: string }) => r.role).sort()).toEqual(
      Object.values(ROLES).sort(),
    );
    const teacher = res.body.roles.find((r: { role: string }) => r.role === ROLES.TEACHER);
    expect(teacher.permissions).toContain(PERMISSIONS.REPORT_VIEW);
    expect(res.body.availablePermissions).toEqual(Object.values(PERMISSIONS));
  });

  it('applies a change on the very next request, in both directions', async () => {
    const report = () => get('/probe/report', as(actors.teacher));
    expect((await report()).status).toBe(200);

    const removed = await put('/roles/teacher/permissions', {
      permissions: [PERMISSIONS.SEATPLAN_VIEW, PERMISSIONS.PROFILE_EDIT_OWN],
    });
    expect(removed.status).toBe(200);
    expect(removed.body).toEqual({
      role: ROLES.TEACHER,
      permissions: [PERMISSIONS.SEATPLAN_VIEW, PERMISSIONS.PROFILE_EDIT_OWN],
    });
    const denied = await report();
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe(ERROR_CODES.FORBIDDEN);

    const restored = await put('/roles/teacher/permissions', {
      permissions: [PERMISSIONS.REPORT_VIEW, PERMISSIONS.SEATPLAN_VIEW],
    });
    expect(restored.status).toBe(200);
    expect((await report()).status).toBe(200);
    const listed = await get('/roles');
    expect(
      listed.body.roles.find((r: { role: string }) => r.role === ROLES.TEACHER).permissions,
    ).toEqual([PERMISSIONS.SEATPLAN_VIEW, PERMISSIONS.REPORT_VIEW]);
  });

  it('replaces rather than merges, and collapses duplicates', async () => {
    const res = await put('/roles/student/permissions', {
      permissions: [PERMISSIONS.SEATPLAN_VIEW_OWN, PERMISSIONS.SEATPLAN_VIEW_OWN],
    });
    expect(res.body.permissions).toEqual([PERMISSIONS.SEATPLAN_VIEW_OWN]);
    const empty = await put('/roles/authority/permissions', { permissions: [] });
    expect(empty.body.permissions).toEqual([]);
    await put('/roles/authority/permissions', { permissions: [PERMISSIONS.REPORT_VIEW] });
  });

  it.each([
    ['an unknown permission', '/roles/teacher/permissions', { permissions: ['root.everything'] }],
    ['an unknown role', '/roles/janitor/permissions', { permissions: [] }],
    ['a missing list', '/roles/teacher/permissions', {}],
  ])('rejects %s', async (_name, path, body) => {
    const res = await put(path, body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(ERROR_CODES.VALIDATION_ERROR);
  });

  describe('superadmin guard rail', () => {
    it.each(SUPERADMIN_REQUIRED_PERMISSIONS)('refuses to remove %s', async (required) => {
      const permissions = Object.values(PERMISSIONS).filter((p) => p !== required);
      const res = await put('/roles/superadmin/permissions', { permissions });
      expect(res.status).toBe(409);
      expect(res.body.error).toMatchObject({
        code: ERROR_CODES.INVALID_STATE,
        details: { missing: [required] },
      });
      const stored = await kit.repos.rolePermissions.permissionsFor(ROLES.SUPERADMIN);
      expect(stored).toContain(required);
    });

    it('refuses to empty the role, but allows changes that keep the required set', async () => {
      expect((await put('/roles/superadmin/permissions', { permissions: [] })).status).toBe(409);
      const ok = await put('/roles/superadmin/permissions', {
        permissions: [...SUPERADMIN_REQUIRED_PERMISSIONS],
      });
      expect(ok.status).toBe(200);
      expect((await get('/roles')).status).toBe(200);
      await put('/roles/superadmin/permissions', {
        permissions: [...SUPERADMIN_REQUIRED_PERMISSIONS, PERMISSIONS.REPORT_VIEW],
      });
    });
  });
});

describe('audit log', () => {
  /** Runs `act`, then returns the audit entries it created. */
  async function entriesFrom(act: () => Promise<unknown>) {
    const before = await auditCount();
    await act();
    const entries = await AuditLogModel.find().sort({ _id: 1 }).skip(before).lean();
    return entries;
  }

  it('records an entry for every mutation in the module', async () => {
    await AuditLogModel.deleteMany({});
    const faculty = await newFaculty('Audit Faculty');
    const department = await newDepartment(faculty.id, 'Audit Department');
    await patch(`/faculties/${faculty.id}`, { name: 'Audit Faculty 2' });
    await patch(`/departments/${department.id}`, { name: 'Audit Department 2' });
    await del(`/departments/${department.id}`);
    await post(`/departments/${department.id}/restore`);
    await del(`/departments/${department.id}`);
    await del(`/faculties/${faculty.id}`);
    await post(`/faculties/${faculty.id}/restore`);
    const liveDepartment = await newDepartment(faculty.id, 'Audit Live');
    const adminRes = await post('/users/department-admins', {
      email: 'audited-admin@example.test',
      name: 'Audited',
      departmentId: liveDepartment.id,
    });
    await post('/users/authority-users', { email: 'audited-auth@example.test', name: 'Aud' });
    const userId = adminRes.body.user.id as string;
    await post(`/users/${userId}/deactivate`);
    await post(`/users/${userId}/reactivate`);
    await post(`/users/${userId}/reset-password`);
    await put('/roles/student/permissions', { permissions: [PERMISSIONS.SEATPLAN_VIEW_OWN] });

    const seen = new Set((await AuditLogModel.find().lean()).map((entry) => entry.action));
    expect([...seen].sort()).toEqual(Object.values(AUDIT_ACTIONS).sort());
  });

  it('captures actor, action, target and timestamp', async () => {
    const [entry] = await entriesFrom(async () => {
      await post('/faculties', { name: 'Traced', code: code('trc') });
    });
    const created = await get('/faculties?search=Traced');
    expect(entry).toMatchObject({
      actorId: expect.anything() as unknown,
      actorRole: ROLES.SUPERADMIN,
      action: AUDIT_ACTIONS.FACULTY_CREATE,
      targetType: 'faculty',
      targetId: created.body.items[0].id as string,
    });
    expect(String(entry?.actorId)).toBe(actors.superadmin.id);
    expect(Math.abs(Date.now() - (entry?.createdAt.getTime() ?? 0))).toBeLessThan(60_000);
  });

  it('describes what changed on an update', async () => {
    const { id } = await newFaculty('Before Name');
    const [entry] = await entriesFrom(async () => {
      await patch(`/faculties/${id}`, { name: 'After Name' });
    });
    expect(entry?.metadata).toEqual({
      changes: { name: { from: 'Before Name', to: 'After Name' } },
    });
  });

  it('records permission changes as added and removed', async () => {
    await put('/roles/student/permissions', { permissions: [PERMISSIONS.SEATPLAN_VIEW_OWN] });
    const [entry] = await entriesFrom(async () => {
      await put('/roles/student/permissions', { permissions: [PERMISSIONS.SEATPLAN_VIEW] });
    });
    expect(entry).toMatchObject({
      action: AUDIT_ACTIONS.ROLE_PERMISSIONS_UPDATE,
      targetType: 'role',
      targetId: ROLES.STUDENT,
      metadata: { added: [PERMISSIONS.SEATPLAN_VIEW], removed: [PERMISSIONS.SEATPLAN_VIEW_OWN] },
    });
    await put('/roles/student/permissions', { permissions: [PERMISSIONS.SEATPLAN_VIEW_OWN] });
  });

  it('never stores passwords or hashes', async () => {
    const created = await post('/users/authority-users', {
      email: 'no-secrets@example.test',
      name: 'No Secrets',
    });
    const reset = await post(`/users/${created.body.user.id as string}/reset-password`);
    const dump = JSON.stringify(await AuditLogModel.find().lean());
    expect(dump).not.toContain(created.body.temporaryPassword as string);
    expect(dump).not.toContain(reset.body.temporaryPassword as string);
    expect(dump).not.toMatch(/argon2|passwordHash/);
  });

  it('records nothing for requests that fail', async () => {
    // Earlier tests left extra superadmins around; the guard rail needs the actor to be the last.
    for (const email of ['root2@example.test', 'root3@example.test']) {
      const extra = await kit.repos.users.findForLogin(email);
      if (extra?.isActive === true) await kit.repos.users.setActive(extra._id, false);
    }
    expect(await kit.repos.users.countActiveSuperadmins()).toBe(1);
    const faculty = await newFaculty();
    const entries = await entriesFrom(async () => {
      await post('/faculties', { name: 'Bad' });
      await post('/faculties', { name: 'Dup', code: faculty.code });
      await patch(`/faculties/${MISSING_ID}`, { name: 'x' });
      await del(`/faculties/${MISSING_ID}`);
      await post('/users/authority-users', { email: 'nope' });
      await put('/roles/superadmin/permissions', { permissions: [] });
      await post(`/users/${actors.superadmin.id}/deactivate`);
      await post(`/users/${actors.superadmin.id}/reset-password`);
      await post('/faculties', { name: 'Forbidden', code: 'F' }, as(actors.adminA));
    });
    expect(entries).toEqual([]);
  });

  it('is not changed by reads', async () => {
    const entries = await entriesFrom(async () => {
      await get('/faculties');
      await get('/departments');
      await get('/users');
      await get('/roles');
      await get('/audit-logs');
    });
    expect(entries).toEqual([]);
  });

  describe('read endpoint', () => {
    it('lists newest first with pagination', async () => {
      const res = await get('/audit-logs?limit=5');
      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(5);
      const times = res.body.items.map((e: { createdAt: string }) => Date.parse(e.createdAt));
      expect([...times].sort((x, y) => y - x)).toEqual(times);
      expect(res.body.meta).toMatchObject({ page: 1, limit: 5 });
      expect(res.body.meta.total).toBe(await auditCount());
      const second = await get('/audit-logs?limit=5&page=2');
      expect(second.body.items[0].id).not.toBe(res.body.items[0].id);
      expect(res.body.items[0]).toEqual({
        id: expect.any(String) as unknown,
        actorId: actors.superadmin.id,
        actorRole: ROLES.SUPERADMIN,
        action: expect.any(String) as unknown,
        targetType: expect.any(String) as unknown,
        targetId: expect.any(String) as unknown,
        metadata: expect.any(Object) as unknown,
        createdAt: expect.any(String) as unknown,
      });
    });

    it('filters by action, target, actor and time range', async () => {
      const byAction = await get(`/audit-logs?action=${AUDIT_ACTIONS.FACULTY_CREATE}&limit=100`);
      expect(byAction.body.items.length).toBeGreaterThan(0);
      for (const item of byAction.body.items as { action: string }[]) {
        expect(item.action).toBe(AUDIT_ACTIONS.FACULTY_CREATE);
      }

      const byTarget = await get(`/audit-logs?targetType=role&targetId=${ROLES.STUDENT}`);
      expect(byTarget.body.items.length).toBeGreaterThan(0);

      const byActor = await get(`/audit-logs?actorId=${actors.superadmin.id}&limit=1`);
      expect(byActor.body.meta.total).toBe(await auditCount());
      expect((await get(`/audit-logs?actorId=${MISSING_ID}`)).body.items).toEqual([]);

      const future = new Date(Date.now() + 3_600_000).toISOString();
      expect((await get(`/audit-logs?from=${encodeURIComponent(future)}`)).body.items).toEqual([]);
      expect((await get(`/audit-logs?to=${encodeURIComponent(future)}`)).body.meta.total).toBe(
        await auditCount(),
      );
    });

    it('rejects invalid filters', async () => {
      expect((await get('/audit-logs?action=format.disk')).status).toBe(400);
      expect((await get('/audit-logs?from=yesterday')).status).toBe(400);
      expect((await get('/audit-logs?limit=1000')).status).toBe(400);
    });
  });
});
