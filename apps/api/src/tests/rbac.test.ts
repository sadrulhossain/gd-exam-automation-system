import { Router } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES, PERMISSIONS, ROLES, type Role } from '@eas/shared';
import { requireRepos, requireRole } from '../middleware/auth.js';
import type { AuthKit } from '../modules/auth/index.js';
import { RolePermissionModel, UserModel } from '../models/index.js';
import { actorScope, createRepositories } from '../repositories/index.js';
import {
  bearer,
  buildAuthApp,
  createUser,
  DEPT_A,
  DEPT_B,
  login,
  startAuthDb,
  stopAuthDb,
} from './authHelpers.js';

const API = '/api/v1/probe';
let kit: AuthKit;
let app: ReturnType<typeof buildAuthApp>;

interface Actor {
  id: string;
  token: string;
  role: Role;
}
const actors = {} as Record<
  | 'superadmin'
  | 'adminA'
  | 'adminB'
  | 'teacherA'
  | 'teacherB'
  | 'studentA'
  | 'studentA2'
  | 'authority',
  Actor
>;

function probeRouter(): Router {
  const router = Router();
  const { requirePermission, requireAnyPermission } = kit.middleware;
  const auth = kit.middleware.authenticate();

  router.get('/authenticated', auth, (req, res) => {
    res.json({ role: req.auth?.role });
  });
  router.get('/superadmin', auth, requireRole(ROLES.SUPERADMIN), (_req, res) => {
    res.json({ ok: true });
  });
  router.get('/dept-admin', auth, requireRole(ROLES.DEPT_ADMIN), (_req, res) => {
    res.json({ ok: true });
  });
  router.get('/staff', auth, requireRole(ROLES.DEPT_ADMIN, ROLES.TEACHER), (_req, res) => {
    res.json({ ok: true });
  });
  router.get('/perm/room', auth, requirePermission(PERMISSIONS.ROOM_MANAGE), (_req, res) => {
    res.json({ ok: true });
  });
  router.get('/perm/report', auth, requirePermission(PERMISSIONS.REPORT_VIEW), (_req, res) => {
    res.json({ ok: true });
  });
  router.get(
    '/perm/any-seat',
    auth,
    requireAnyPermission(PERMISSIONS.SEATPLAN_VIEW, PERMISSIONS.SEATPLAN_VIEW_OWN),
    (_req, res) => {
      res.json({ ok: true });
    },
  );
  router.get(
    '/perm/all-seat',
    auth,
    requirePermission(PERMISSIONS.SEATPLAN_VIEW, PERMISSIONS.SEATPLAN_VIEW_OWN),
    (_req, res) => {
      res.json({ ok: true });
    },
  );

  // Data routes: handlers only ever see req.repos, which is already scoped to the caller.
  router.get('/users', auth, async (req, res) => {
    const filter =
      typeof req.query['departmentId'] === 'string'
        ? { departmentId: req.query['departmentId'] }
        : {};
    const users = await requireRepos(req).users.find(filter);
    res.json({ emails: users.map((u) => u.email).sort() });
  });
  router.get('/users/:id', auth, async (req, res) => {
    const user = await requireRepos(req).users.findById(String(req.params['id']));
    if (user === null) {
      res.status(404).json({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Not found' } });
      return;
    }
    res.json({ email: user.email, departmentId: user.departmentId?.toString() ?? null });
  });
  router.patch('/users/:id', auth, async (req, res) => {
    const body = req.body as { name?: string; departmentId?: string };
    const update =
      body.departmentId === undefined ? { name: body.name } : { departmentId: body.departmentId };
    const user = await requireRepos(req).users.updateById(String(req.params['id']), update);
    if (user === null) {
      res.status(404).json({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Not found' } });
      return;
    }
    res.json({ name: user.name });
  });
  router.post('/users', auth, async (req, res) => {
    const body = req.body as { email: string; departmentId?: string };
    const created = await requireRepos(req).users.createWithHash({
      email: body.email,
      name: 'Created',
      role: ROLES.TEACHER,
      departmentId: body.departmentId ?? null,
      passwordHash: 'x',
    });
    res.status(201).json({ departmentId: created.departmentId?.toString() ?? null });
  });
  return router;
}

async function actor(email: string, role: Role, departmentId: string | null): Promise<Actor> {
  const user = await createUser(kit, { email, role, departmentId });
  const tokens = await login(app, email);
  return { id: user.id, token: tokens.accessToken, role };
}

beforeAll(async () => {
  kit = await startAuthDb();
  app = buildAuthApp(kit, undefined, [Router().use('/probe', probeRouter())]);
  actors.superadmin = await actor('sa@example.test', ROLES.SUPERADMIN, null);
  actors.authority = await actor('auth@example.test', ROLES.AUTHORITY, null);
  actors.adminA = await actor('admin-a@example.test', ROLES.DEPT_ADMIN, DEPT_A);
  actors.teacherA = await actor('teacher-a@example.test', ROLES.TEACHER, DEPT_A);
  actors.studentA = await actor('student-a@example.test', ROLES.STUDENT, DEPT_A);
  actors.studentA2 = await actor('student-a2@example.test', ROLES.STUDENT, DEPT_A);
  actors.adminB = await actor('admin-b@example.test', ROLES.DEPT_ADMIN, DEPT_B);
  actors.teacherB = await actor('teacher-b@example.test', ROLES.TEACHER, DEPT_B);
});
afterAll(stopAuthDb);

const ALL_ROLES = [
  ROLES.SUPERADMIN,
  ROLES.DEPT_ADMIN,
  ROLES.TEACHER,
  ROLES.STUDENT,
  ROLES.AUTHORITY,
] as const;

const tokenFor = (role: Role): string => {
  const map: Record<Role, Actor> = {
    superadmin: actors.superadmin,
    dept_admin: actors.adminA,
    teacher: actors.teacherA,
    student: actors.studentA,
    authority: actors.authority,
  };
  return map[role].token;
};

/** Which roles may call each route; every other role must get 403, anonymous 401. */
const ROUTE_ACCESS: readonly (readonly [string, readonly Role[]])[] = [
  ['/authenticated', ALL_ROLES],
  ['/superadmin', [ROLES.SUPERADMIN]],
  ['/dept-admin', [ROLES.DEPT_ADMIN]],
  ['/staff', [ROLES.DEPT_ADMIN, ROLES.TEACHER]],
  ['/perm/room', [ROLES.DEPT_ADMIN]],
  ['/perm/report', [ROLES.SUPERADMIN, ROLES.DEPT_ADMIN, ROLES.TEACHER, ROLES.AUTHORITY]],
  ['/perm/any-seat', [ROLES.DEPT_ADMIN, ROLES.TEACHER, ROLES.STUDENT]],
  ['/perm/all-seat', []],
];

describe('role and permission guards', () => {
  for (const [path, allowed] of ROUTE_ACCESS) {
    describe(`GET ${path}`, () => {
      it('rejects anonymous callers with 401', async () => {
        const res = await request(app).get(`${API}${path}`);
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe(ERROR_CODES.UNAUTHENTICATED);
      });

      it.each(ALL_ROLES)('as %s', async (role) => {
        const res = await request(app)
          .get(`${API}${path}`)
          .set(...bearer(tokenFor(role)));
        if (allowed.includes(role)) {
          expect(res.status).toBe(200);
        } else {
          expect(res.status).toBe(403);
          expect(res.body.error.code).toBe(ERROR_CODES.FORBIDDEN);
        }
      });
    });
  }

  it('reads grants from the RolePermission collection, so superadmin edits apply at once', async () => {
    const before = await request(app)
      .get(`${API}/perm/room`)
      .set(...bearer(actors.teacherA.token));
    expect(before.status).toBe(403);

    await RolePermissionModel.updateOne(
      { role: ROLES.TEACHER },
      { $addToSet: { permissions: PERMISSIONS.ROOM_MANAGE } },
    );
    const during = await request(app)
      .get(`${API}/perm/room`)
      .set(...bearer(actors.teacherA.token));
    expect(during.status).toBe(200);

    await RolePermissionModel.updateOne(
      { role: ROLES.TEACHER },
      { $pull: { permissions: PERMISSIONS.ROOM_MANAGE } },
    );
    const after = await request(app)
      .get(`${API}/perm/room`)
      .set(...bearer(actors.teacherA.token));
    expect(after.status).toBe(403);
  });

  it('does not overwrite edited grants when defaults are seeded again', async () => {
    await RolePermissionModel.updateOne({ role: ROLES.STUDENT }, { permissions: [] });
    const created = await kit.repos.rolePermissions.seedDefaults();
    expect(created).toEqual([]);
    expect(await kit.repos.rolePermissions.permissionsFor(ROLES.STUDENT)).toEqual([]);
    await RolePermissionModel.updateOne(
      { role: ROLES.STUDENT },
      { permissions: [PERMISSIONS.SEATPLAN_VIEW_OWN] },
    );
  });
});

describe('department scoping through the repository layer', () => {
  const emailsFor = async (a: Actor, query = ''): Promise<string[]> => {
    const res = await request(app)
      .get(`${API}/users${query}`)
      .set(...bearer(a.token));
    expect(res.status).toBe(200);
    return res.body.emails as string[];
  };

  it('lists only the own department for dept_admin and teacher', async () => {
    const inA = [
      'admin-a@example.test',
      'student-a2@example.test',
      'student-a@example.test',
      'teacher-a@example.test',
    ].sort();
    expect(await emailsFor(actors.adminA)).toEqual(inA);
    expect(await emailsFor(actors.teacherA)).toEqual(inA);
    expect(await emailsFor(actors.adminB)).toEqual([
      'admin-b@example.test',
      'teacher-b@example.test',
    ]);
  });

  it('shows superadmin and authority every department', async () => {
    expect(await emailsFor(actors.superadmin)).toHaveLength(8);
    expect(await emailsFor(actors.authority)).toHaveLength(8);
  });

  it('shows a student only their own record', async () => {
    expect(await emailsFor(actors.studentA)).toEqual(['student-a@example.test']);
    const other = await request(app)
      .get(`${API}/users/${actors.studentA2.id}`)
      .set(...bearer(actors.studentA.token));
    expect(other.status).toBe(404);
    const own = await request(app)
      .get(`${API}/users/${actors.studentA.id}`)
      .set(...bearer(actors.studentA.token));
    expect(own.status).toBe(200);
  });

  it('cannot be widened by a caller-supplied filter', async () => {
    expect(await emailsFor(actors.adminA, `?departmentId=${DEPT_B}`)).toEqual([]);
    expect(await emailsFor(actors.adminA, `?departmentId=${DEPT_A}`)).toHaveLength(4);
  });

  it('rejects cross-department reads by id: another department looks empty', async () => {
    const res = await request(app)
      .get(`${API}/users/${actors.teacherB.id}`)
      .set(...bearer(actors.adminA.token));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe(ERROR_CODES.NOT_FOUND);

    for (const a of [actors.superadmin, actors.authority, actors.adminB]) {
      const ok = await request(app)
        .get(`${API}/users/${actors.teacherB.id}`)
        .set(...bearer(a.token));
      expect(ok.status).toBe(200);
    }
  });

  it('rejects cross-department updates and leaves the record untouched', async () => {
    const res = await request(app)
      .patch(`${API}/users/${actors.teacherB.id}`)
      .set(...bearer(actors.adminA.token))
      .send({ name: 'Hijacked' });
    expect(res.status).toBe(404);
    expect((await UserModel.findById(actors.teacherB.id).lean())?.name).not.toBe('Hijacked');

    const own = await request(app)
      .patch(`${API}/users/${actors.teacherA.id}`)
      .set(...bearer(actors.adminA.token))
      .send({ name: 'Renamed' });
    expect(own.status).toBe(200);
  });

  it('rejects moving a record into another department', async () => {
    const res = await request(app)
      .patch(`${API}/users/${actors.teacherA.id}`)
      .set(...bearer(actors.adminA.token))
      .send({ departmentId: DEPT_B });
    expect(res.status).toBe(403);
    expect((await UserModel.findById(actors.teacherA.id).lean())?.departmentId?.toString()).toBe(
      DEPT_A,
    );
  });

  it('forces the caller department on create and rejects another one', async () => {
    const implicit = await request(app)
      .post(`${API}/users`)
      .set(...bearer(actors.adminA.token))
      .send({ email: 'created-implicit@example.test' });
    expect(implicit.status).toBe(201);
    expect(implicit.body.departmentId).toBe(DEPT_A);

    const foreign = await request(app)
      .post(`${API}/users`)
      .set(...bearer(actors.adminA.token))
      .send({ email: 'created-foreign@example.test', departmentId: DEPT_B });
    expect(foreign.status).toBe(403);
    expect(await UserModel.countDocuments({ email: 'created-foreign@example.test' })).toBe(0);

    const superadmin = await request(app)
      .post(`${API}/users`)
      .set(...bearer(actors.superadmin.token))
      .send({ email: 'created-by-sa@example.test', departmentId: DEPT_B });
    expect(superadmin.status).toBe(201);
    expect(superadmin.body.departmentId).toBe(DEPT_B);
  });

  it('keeps authority and students read-only', async () => {
    for (const a of [actors.authority, actors.studentA]) {
      const update = await request(app)
        .patch(`${API}/users/${a.id}`)
        .set(...bearer(a.token))
        .send({ name: 'Nope' });
      expect(update.status).toBe(403);
      const create = await request(app)
        .post(`${API}/users`)
        .set(...bearer(a.token))
        .send({ email: `ro-${a.role}@example.test` });
      expect(create.status).toBe(403);
    }
  });
});

describe('repository construction', () => {
  it('refuses a department-scoped role without a department', () => {
    expect(() => actorScope({ role: ROLES.TEACHER, userId: 'x', departmentId: null })).toThrow();
    expect(() =>
      actorScope({ role: ROLES.AUTHORITY, userId: 'x', departmentId: null }),
    ).not.toThrow();
  });

  it('keeps credential operations off scoped repositories', async () => {
    const scoped = createRepositories(
      actorScope({ role: ROLES.DEPT_ADMIN, userId: actors.adminA.id, departmentId: DEPT_A }),
    );
    await expect(scoped.users.findForLogin('admin-a@example.test')).rejects.toThrow(/system scope/);
  });
});
