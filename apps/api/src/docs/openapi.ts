import {
  extendZodWithOpenApi,
  OpenAPIRegistry,
  OpenApiGeneratorV31,
} from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import {
  AdminUserListQuerySchema,
  AdminUserListSchema,
  ApiErrorSchema,
  AuditLogListSchema,
  AuditLogQuerySchema,
  AuthUserSchema,
  CreateAuthorityUserSchema,
  CreateDepartmentAdminSchema,
  CreateDepartmentSchema,
  CreateFacultySchema,
  DepartmentListQuerySchema,
  DepartmentListSchema,
  DepartmentRecordSchema,
  FacultyListQuerySchema,
  FacultyListSchema,
  FacultyRecordSchema,
  IdParamSchema,
  RoleGrantSchema,
  RoleListSchema,
  RoleParamSchema,
  SetRolePermissionsSchema,
  TemporaryCredentialSchema,
  UpdateDepartmentSchema,
  UpdateFacultySchema,
} from '@eas/shared';
import { HealthResponseSchema, ReadyResponseSchema } from '../modules/health/health.schemas.js';

extendZodWithOpenApi(z);

/** Modules register their routes here; the document is generated from these registrations. */
export const registry = new OpenAPIRegistry();

const json = <T extends z.ZodType>(schema: T) => ({ 'application/json': { schema } });

registry.registerPath({
  method: 'get',
  path: '/api/v1/health',
  tags: ['Health'],
  summary: 'Service and database state',
  responses: { 200: { description: 'API is up', content: json(HealthResponseSchema) } },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/ready',
  tags: ['Health'],
  summary: 'Readiness: succeeds only when MongoDB answers',
  responses: {
    200: { description: 'Ready for traffic', content: json(ReadyResponseSchema) },
    503: { description: 'Database not ready', content: json(ApiErrorSchema) },
  },
});

// ---- Superadmin module ----
const SUPERADMIN_ERRORS = {
  400: { description: 'Validation failed', content: json(ApiErrorSchema) },
  401: { description: 'Not signed in', content: json(ApiErrorSchema) },
  403: {
    description: 'Not a superadmin, or lacking the permission',
    content: json(ApiErrorSchema),
  },
  404: { description: 'Not found', content: json(ApiErrorSchema) },
  409: {
    description: 'Duplicate unique value (DUPLICATE_KEY) or invalid state (INVALID_STATE)',
    content: json(ApiErrorSchema),
  },
};
const security = [{ bearerAuth: [] }];
registry.registerComponent('securitySchemes', 'bearerAuth', { type: 'http', scheme: 'bearer' });

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';
interface RouteDoc {
  method: Method;
  path: string;
  tag: string;
  summary: string;
  params?: z.ZodObject;
  query?: z.ZodObject;
  body?: z.ZodType;
  ok: { status: 200 | 201; schema: z.ZodType; description: string };
}

function superadminRoute(route: RouteDoc): void {
  registry.registerPath({
    method: route.method,
    path: `/api/v1${route.path}`,
    tags: [route.tag],
    summary: `${route.summary} (superadmin only)`,
    security,
    request: {
      ...(route.params === undefined ? {} : { params: route.params }),
      ...(route.query === undefined ? {} : { query: route.query }),
      ...(route.body === undefined ? {} : { body: { content: json(route.body) } }),
    },
    responses: {
      [route.ok.status]: { description: route.ok.description, content: json(route.ok.schema) },
      ...SUPERADMIN_ERRORS,
    },
  });
}

const userEnvelope = z.object({ user: AuthUserSchema });

for (const [segment, tag, record, list, query, create, update] of [
  [
    'faculties',
    'Faculties',
    FacultyRecordSchema,
    FacultyListSchema,
    FacultyListQuerySchema,
    CreateFacultySchema,
    UpdateFacultySchema,
  ],
  [
    'departments',
    'Departments',
    DepartmentRecordSchema,
    DepartmentListSchema,
    DepartmentListQuerySchema,
    CreateDepartmentSchema,
    UpdateDepartmentSchema,
  ],
] as const) {
  const ok = (schema: z.ZodType, description: string, status: 200 | 201 = 200) => ({
    status,
    schema,
    description,
  });
  superadminRoute({
    method: 'get',
    path: `/${segment}`,
    tag,
    summary: `List ${segment} (paginated, searchable)`,
    query,
    ok: ok(list, 'A page of results'),
  });
  superadminRoute({
    method: 'post',
    path: `/${segment}`,
    tag,
    summary: `Create one of ${segment}`,
    body: create,
    ok: ok(record, 'Created', 201),
  });
  superadminRoute({
    method: 'get',
    path: `/${segment}/{id}`,
    tag,
    summary: 'Get one',
    params: IdParamSchema,
    ok: ok(record, 'The record'),
  });
  superadminRoute({
    method: 'patch',
    path: `/${segment}/{id}`,
    tag,
    summary: 'Update',
    params: IdParamSchema,
    body: update,
    ok: ok(record, 'The updated record'),
  });
  superadminRoute({
    method: 'delete',
    path: `/${segment}/{id}`,
    tag,
    summary: 'Archive (soft delete)',
    params: IdParamSchema,
    ok: ok(record, 'The archived record'),
  });
  superadminRoute({
    method: 'post',
    path: `/${segment}/{id}/restore`,
    tag,
    summary: 'Restore an archived record',
    params: IdParamSchema,
    ok: ok(record, 'The restored record'),
  });
}

superadminRoute({
  method: 'get',
  path: '/users',
  tag: 'Users',
  summary: 'List users',
  query: AdminUserListQuerySchema,
  ok: { status: 200, schema: AdminUserListSchema, description: 'A page of users' },
});
superadminRoute({
  method: 'get',
  path: '/users/{id}',
  tag: 'Users',
  summary: 'Get a user',
  params: IdParamSchema,
  ok: { status: 200, schema: userEnvelope, description: 'The user' },
});
superadminRoute({
  method: 'post',
  path: '/users/department-admins',
  tag: 'Users',
  summary: 'Create a department admin with a temporary password',
  body: CreateDepartmentAdminSchema,
  ok: {
    status: 201,
    schema: TemporaryCredentialSchema,
    description: 'Created; the temporary password is shown once',
  },
});
superadminRoute({
  method: 'post',
  path: '/users/authority-users',
  tag: 'Users',
  summary: 'Create an authority user with a temporary password',
  body: CreateAuthorityUserSchema,
  ok: {
    status: 201,
    schema: TemporaryCredentialSchema,
    description: 'Created; the temporary password is shown once',
  },
});
superadminRoute({
  method: 'post',
  path: '/users/{id}/deactivate',
  tag: 'Users',
  summary: 'Deactivate a user (not the last active superadmin)',
  params: IdParamSchema,
  ok: { status: 200, schema: userEnvelope, description: 'The deactivated user' },
});
superadminRoute({
  method: 'post',
  path: '/users/{id}/reactivate',
  tag: 'Users',
  summary: 'Reactivate a user',
  params: IdParamSchema,
  ok: { status: 200, schema: userEnvelope, description: 'The reactivated user' },
});
superadminRoute({
  method: 'post',
  path: '/users/{id}/reset-password',
  tag: 'Users',
  summary: 'Reset to a new temporary password',
  params: IdParamSchema,
  ok: {
    status: 200,
    schema: TemporaryCredentialSchema,
    description: 'The temporary password is shown once',
  },
});
superadminRoute({
  method: 'get',
  path: '/roles',
  tag: 'Roles',
  summary: 'Roles with their permissions',
  ok: { status: 200, schema: RoleListSchema, description: 'Roles and every assignable permission' },
});
superadminRoute({
  method: 'put',
  path: '/roles/{role}/permissions',
  tag: 'Roles',
  summary: 'Replace a role’s permissions (takes effect on the next request)',
  params: RoleParamSchema,
  body: SetRolePermissionsSchema,
  ok: { status: 200, schema: RoleGrantSchema, description: 'The new grants' },
});
superadminRoute({
  method: 'get',
  path: '/audit-logs',
  tag: 'Audit log',
  summary: 'Read the audit log, newest first',
  query: AuditLogQuerySchema,
  ok: { status: 200, schema: AuditLogListSchema, description: 'A page of audit entries' },
});

export function buildOpenApiDocument() {
  return new OpenApiGeneratorV31(registry.definitions).generateDocument({
    openapi: '3.1.0',
    info: { title: 'Exam Automation System API', version: '0.0.0' },
    servers: [{ url: '/' }],
  });
}
