# Superadmin module

Implemented in segment 6. Code: `apps/api/src/modules/superadmin`, repositories
`faculty`, `department`, `auditLog`, `rolePermission`, `user` in `src/repositories`,
schemas in `packages/shared/src/superadmin.ts`. Interactive reference: `/api/v1/docs`.

Every route below is under `/api/v1`, needs a bearer token, and is **superadmin only**: the
role is checked first, then the permission named in the table. Other roles get `403
FORBIDDEN`, anonymous callers `401`, even if a superadmin grants them the permission (the
role check does not read the grants). Routes are not nested under a prefix; later segments
add their own resources beside them.

| Resource    | Endpoints                                                                          | Permission          |
| ----------- | ---------------------------------------------------------------------------------- | ------------------- |
| Faculties   | `GET/POST /faculties`, `GET/PATCH/DELETE /faculties/:id`, `POST …/:id/restore`     | `department.manage` |
| Departments | `GET/POST /departments`, `GET/PATCH/DELETE /departments/:id`, `POST …/:id/restore` | `department.manage` |
| Users       | `GET /users`, `GET /users/:id`                                                     | `user.manage`       |
|             | `POST /users/department-admins`, `POST /users/authority-users`                     | `user.manage`       |
|             | `POST /users/:id/deactivate`, `…/reactivate`, `…/reset-password`                   | `user.manage`       |
| Roles       | `GET /roles`, `PUT /roles/:role/permissions`                                       | `role.manage`       |
| Audit log   | `GET /audit-logs`                                                                  | `role.manage`       |

The audit log reuses `role.manage` because the permission set is a shared contract and no
audit permission exists yet.

## Faculties and departments

- Lists take `page`, `limit` (max 100), `search` (case-insensitive substring of name or code,
  matched literally), `sort` (`name`, `code`, `createdAt`; prefix `-` for descending) and
  `archived` (`exclude` default, `include`, `only`). Departments also take `facultyId`.
  Responses are `{ items, meta: { page, limit, total, totalPages } }`.
- `DELETE` is a soft delete: it sets `isArchived` and `archivedAt` and returns the record.
  `POST …/restore` undoes it. Archived records stay readable by id and are hidden from
  default lists.
- Codes are stored upper-case. Faculty `code` is unique across the system, and department
  `code` is unique within its faculty, both enforced by unique indexes and including archived
  records, so a restore can never collide. A clash returns `409 DUPLICATE_KEY`.
- State rules, returned as `409 INVALID_STATE`: archived records cannot be edited (restore
  first); a faculty with active departments cannot be archived; a department cannot be
  created in, moved to, or restored under an archived faculty.
- Archiving a department does not cascade to its users. Their accounts stay active; deactivate
  them explicitly if needed.

## Accounts

- `POST /users/department-admins` (`email`, `name`, `departmentId`; the department must exist
  and not be archived) and `POST /users/authority-users` (`email`, `name`) create the account
  with a server-generated 16-character temporary password and `mustChangePassword = true`.
  The password is in the response **once** (`Cache-Control: no-store`); only its argon2 hash is
  stored, and it is never written to the audit log or the application log.
- Until the first password change the user can sign in but every endpoint except
  `/auth/me` and `/auth/change-password` answers `403 PASSWORD_CHANGE_REQUIRED`.
- `deactivate` bumps the user's `tokenVersion` and revokes refresh tokens, so access ends on
  the next request. `reactivate` also clears any login lockout.
- `reset-password` issues a new temporary password, sets `mustChangePassword`, and ends every
  session of that user. A superadmin cannot reset their own password this way (use
  `/auth/change-password`, which requires the current one).
- Guard rail: the last active superadmin cannot be deactivated (`409 INVALID_STATE`). The
  count is checked before the write and again after it; if two superadmins deactivate each
  other at the same moment, the loser is reverted, so at least one always remains.

## Role permissions

- `GET /roles` returns each role with its grants and the list of assignable permissions.
- `PUT /roles/:role/permissions` takes the complete new list (`{ "permissions": [...] }`),
  which replaces the old one in a single document write. Duplicates collapse and the stored
  order is the canonical order of `PERMISSIONS`.
- No stale cache: the permission guards read the role's document from MongoDB on every request
  (cached only for the duration of that request), so a change applies to the very next request
  of every user in the role. Tokens do not carry permissions.
- Guard rail: `superadmin` must keep `SUPERADMIN_REQUIRED_PERMISSIONS`
  (`department.manage`, `user.manage`, `role.manage`); removing any returns `409
INVALID_STATE` with `details.missing`. Without them nobody could repair the grants through
  the API.

## Audit log

Collection `auditlogs`: `actorId`, `actorRole`, `action`, `targetType`, `targetId` (an object
id, or the role name), `metadata`, `createdAt`. One entry is written for every successful
mutation in this module (13 actions, listed in `AUDIT_ACTIONS`); failed or forbidden requests
and reads write nothing. `metadata` carries the change (`changes: { field: { from, to } }` for
updates, `added`/`removed` for permissions, email and role for accounts), never secrets.

`GET /audit-logs` is newest first and takes `page`, `limit`, `actorId`, `action`, `targetType`,
`targetId`, `from` (inclusive) and `to` (exclusive), as ISO timestamps.

The repository is append-only (no update or delete) and only a superadmin can read or write
it. The entry is written after the change succeeds, and MongoDB on a standalone server gives no
multi-document atomicity. If the audit write fails the request returns 500 although the change
was applied; a crash between the two can therefore lose an entry but never record one for
something that did not happen.

## Data access

Faculties and the audit log are global collections: `FacultyRepository` lets superadmin and
authority read and only superadmin write, and refuses every other role. `DepartmentRepository`
is scoped by `_id` like the rest (a department-scoped role sees only its own department) with
writes restricted to superadmin, and it cannot hard-delete. `RolePermissionRepository` now takes
a scope; changing grants requires superadmin. Credential writes (password hash, refresh-token
revocation) use the system repositories from `AuthKit`, reached only after the role and
permission checks.

Development seeding now also creates a development faculty and the department with id
`DEV_DEPARTMENT_ID` (non-production only), which the seeded users already pointed at.
