import { Router, type RequestHandler } from 'express';
import {
  AdminUserListQuerySchema,
  AuditLogQuerySchema,
  CreateAuthorityUserSchema,
  CreateDepartmentAdminSchema,
  CreateDepartmentSchema,
  CreateFacultySchema,
  DepartmentListQuerySchema,
  FacultyListQuerySchema,
  IdParamSchema,
  PERMISSIONS,
  ROLES,
  RoleParamSchema,
  SetRolePermissionsSchema,
  UpdateDepartmentSchema,
  UpdateFacultySchema,
  type Permission,
} from '@eas/shared';
import { requireRole, type AuthMiddleware } from '../../middleware/auth.js';
import { validate, validated } from '../../middleware/validate.js';
import { listAuditLogs } from './audit.service.js';
import { adminContext } from './context.js';
import {
  archiveDepartment,
  createDepartment,
  getDepartment,
  listDepartments,
  restoreDepartment,
  updateDepartment,
} from './departments.service.js';
import {
  archiveFaculty,
  createFaculty,
  getFaculty,
  listFaculties,
  restoreFaculty,
  updateFaculty,
} from './faculties.service.js';
import { listRoles, setRolePermissions } from './roles.service.js';
import type { UserAdminService } from './users.service.js';

export interface SuperadminRouterDeps {
  auth: AuthMiddleware;
  users: UserAdminService;
}

/** Superadmin-only routes: the role is checked first, then the specific permission. */
export function createSuperadminRouter({ auth, users }: SuperadminRouterDeps): Router {
  const router = Router();
  const guard = (permission: Permission): RequestHandler[] => [
    auth.authenticate(),
    requireRole(ROLES.SUPERADMIN),
    auth.requirePermission(permission),
  ];
  const departmentsGuard = guard(PERMISSIONS.DEPARTMENT_MANAGE);
  const usersGuard = guard(PERMISSIONS.USER_MANAGE);
  const rolesGuard = guard(PERMISSIONS.ROLE_MANAGE);

  // ---- Faculties ----
  const facultyList = { query: FacultyListQuerySchema };
  router.get('/faculties', ...departmentsGuard, validate(facultyList), async (req, res) => {
    const { query } = validated<typeof facultyList>(req);
    res.json(await listFaculties(adminContext(req), query));
  });

  const facultyCreate = { body: CreateFacultySchema };
  router.post('/faculties', ...departmentsGuard, validate(facultyCreate), async (req, res) => {
    const { body } = validated<typeof facultyCreate>(req);
    res.status(201).json(await createFaculty(adminContext(req), body));
  });

  const byId = { params: IdParamSchema };
  router.get('/faculties/:id', ...departmentsGuard, validate(byId), async (req, res) => {
    const { params } = validated<typeof byId>(req);
    res.json(await getFaculty(adminContext(req), params.id));
  });

  const facultyUpdate = { params: IdParamSchema, body: UpdateFacultySchema };
  router.patch('/faculties/:id', ...departmentsGuard, validate(facultyUpdate), async (req, res) => {
    const { params, body } = validated<typeof facultyUpdate>(req);
    res.json(await updateFaculty(adminContext(req), params.id, body));
  });

  router.delete('/faculties/:id', ...departmentsGuard, validate(byId), async (req, res) => {
    const { params } = validated<typeof byId>(req);
    res.json(await archiveFaculty(adminContext(req), params.id));
  });

  router.post('/faculties/:id/restore', ...departmentsGuard, validate(byId), async (req, res) => {
    const { params } = validated<typeof byId>(req);
    res.json(await restoreFaculty(adminContext(req), params.id));
  });

  // ---- Departments ----
  const departmentList = { query: DepartmentListQuerySchema };
  router.get('/departments', ...departmentsGuard, validate(departmentList), async (req, res) => {
    const { query } = validated<typeof departmentList>(req);
    res.json(await listDepartments(adminContext(req), query));
  });

  const departmentCreate = { body: CreateDepartmentSchema };
  router.post('/departments', ...departmentsGuard, validate(departmentCreate), async (req, res) => {
    const { body } = validated<typeof departmentCreate>(req);
    res.status(201).json(await createDepartment(adminContext(req), body));
  });

  router.get('/departments/:id', ...departmentsGuard, validate(byId), async (req, res) => {
    const { params } = validated<typeof byId>(req);
    res.json(await getDepartment(adminContext(req), params.id));
  });

  const departmentUpdate = { params: IdParamSchema, body: UpdateDepartmentSchema };
  router.patch(
    '/departments/:id',
    ...departmentsGuard,
    validate(departmentUpdate),
    async (req, res) => {
      const { params, body } = validated<typeof departmentUpdate>(req);
      res.json(await updateDepartment(adminContext(req), params.id, body));
    },
  );

  router.delete('/departments/:id', ...departmentsGuard, validate(byId), async (req, res) => {
    const { params } = validated<typeof byId>(req);
    res.json(await archiveDepartment(adminContext(req), params.id));
  });

  router.post('/departments/:id/restore', ...departmentsGuard, validate(byId), async (req, res) => {
    const { params } = validated<typeof byId>(req);
    res.json(await restoreDepartment(adminContext(req), params.id));
  });

  // ---- Users ----
  const userList = { query: AdminUserListQuerySchema };
  router.get('/users', ...usersGuard, validate(userList), async (req, res) => {
    const { query } = validated<typeof userList>(req);
    res.json(await users.list(adminContext(req), query));
  });

  router.get('/users/:id', ...usersGuard, validate(byId), async (req, res) => {
    const { params } = validated<typeof byId>(req);
    res.json({ user: await users.get(adminContext(req), params.id) });
  });

  // The temporary password is shown once, so these responses must never be cached.
  const departmentAdminCreate = { body: CreateDepartmentAdminSchema };
  router.post(
    '/users/department-admins',
    ...usersGuard,
    validate(departmentAdminCreate),
    async (req, res) => {
      const { body } = validated<typeof departmentAdminCreate>(req);
      const created = await users.createDepartmentAdmin(adminContext(req), body);
      res.status(201).set('Cache-Control', 'no-store').json(created);
    },
  );

  const authorityCreate = { body: CreateAuthorityUserSchema };
  router.post(
    '/users/authority-users',
    ...usersGuard,
    validate(authorityCreate),
    async (req, res) => {
      const { body } = validated<typeof authorityCreate>(req);
      const created = await users.createAuthorityUser(adminContext(req), body);
      res.status(201).set('Cache-Control', 'no-store').json(created);
    },
  );

  router.post('/users/:id/deactivate', ...usersGuard, validate(byId), async (req, res) => {
    const { params } = validated<typeof byId>(req);
    res.json({ user: await users.deactivate(adminContext(req), params.id) });
  });

  router.post('/users/:id/reactivate', ...usersGuard, validate(byId), async (req, res) => {
    const { params } = validated<typeof byId>(req);
    res.json({ user: await users.reactivate(adminContext(req), params.id) });
  });

  router.post('/users/:id/reset-password', ...usersGuard, validate(byId), async (req, res) => {
    const { params } = validated<typeof byId>(req);
    const reset = await users.resetPassword(adminContext(req), params.id);
    res.set('Cache-Control', 'no-store').json(reset);
  });

  // ---- Roles and permissions ----
  router.get('/roles', ...rolesGuard, async (req, res) => {
    res.set('Cache-Control', 'no-store').json(await listRoles(adminContext(req)));
  });

  const roleUpdate = { params: RoleParamSchema, body: SetRolePermissionsSchema };
  router.put('/roles/:role/permissions', ...rolesGuard, validate(roleUpdate), async (req, res) => {
    const { params, body } = validated<typeof roleUpdate>(req);
    res.json(await setRolePermissions(adminContext(req), params.role, body.permissions));
  });

  // ---- Audit log ----
  const auditList = { query: AuditLogQuerySchema };
  router.get('/audit-logs', ...rolesGuard, validate(auditList), async (req, res) => {
    const { query } = validated<typeof auditList>(req);
    res.json(await listAuditLogs(adminContext(req), query));
  });

  return router;
}
