# Authentication, authorization and data access

Implemented in segment 5. Code: `apps/api/src/modules/auth`, `src/middleware/auth.ts`,
`src/repositories`, `src/models`.

## Endpoints

All under `/api/v1/auth`. Errors use `{ error: { code, message, details? } }`.

| Endpoint                | Auth    | Result                                                             |
| ----------------------- | ------- | ------------------------------------------------------------------ |
| `POST /login`           | none    | `AuthSession`: access token, user; refresh token by cookie or body |
| `POST /refresh`         | refresh | New access token and a rotated refresh token                       |
| `POST /logout`          | refresh | 204; revokes the refresh-token family. Idempotent                  |
| `POST /change-password` | bearer  | New session; every other session is ended                          |
| `GET /me`               | bearer  | `{ user }`                                                         |

`login`, `refresh` and `change-password` share a per-IP rate limit
(`AUTH_RATE_LIMIT_MAX` per `AUTH_RATE_LIMIT_WINDOW_MS`, default 20 per 15 minutes).

## Tokens

- **Access token:** JWT (HS256, `JWT_ACCESS_SECRET`), 15 minutes by default, sent as
  `Authorization: Bearer <token>`. It carries only the user id and `tokenVersion`. On every
  request the user is re-read from the database, so the role and department always come
  from the database, and deactivating a user or changing a password takes effect at once
  (the token's `tokenVersion` no longer matches).
- **Refresh token:** opaque 256-bit random value, 7 days by default. Only an HMAC-SHA256 of
  it (keyed with `JWT_REFRESH_SECRET`) is stored.
- **Rotation and reuse detection:** every refresh spends the presented token and issues a
  new one in the same family. Presenting a token that was already spent (stolen, or replayed
  by a racing client) revokes the whole family, so the attacker and the legitimate holder
  both have to sign in again. Exchange is an atomic compare-and-set, so two concurrent
  refreshes with one token cannot both succeed.
- Logout revokes the family but cannot recall an access token that is already issued; it
  stays valid until it expires (at most 15 minutes) unless the password is changed.

### Cookie or body for the refresh token

|                                                       | httpOnly cookie (default)                                                                        | Response body (`refreshTokenInBody: true`)            |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| Readable by page scripts                              | No, so an XSS bug cannot steal it                                                                | Yes, the client must store it (memory or storage)     |
| CSRF                                                  | Cookie is `SameSite=Strict` and scoped to `/api/v1/auth`, so cross-site requests do not carry it | Not applicable: nothing is sent automatically         |
| Works when the web app and API are on different sites | No: `Strict` cookies are not sent cross-site                                                     | Yes                                                   |
| Recommended for                                       | Same-site deployments (the Docker setup serves both behind one origin)                           | Cross-site deployments, mobile or non-browser clients |

The server sends the token by exactly one route. `Secure` is set in production. Clients that
send `refreshToken` in the body of `/refresh` or `/logout` get the next token back in the
body.

## Login protection

- Same error and similar timing for unknown email and wrong password (a dummy argon2
  verification runs for unknown emails).
- Per-IP rate limit (above) plus per-account lockout: after `AUTH_LOCKOUT_THRESHOLD`
  consecutive failures (default 5) the account is locked for `AUTH_LOCKOUT_BASE_MS`
  (default 1 minute), doubling with every further failure up to `AUTH_LOCKOUT_MAX_MS`
  (default 1 hour). While locked, even the right password is refused with 429
  `RATE_LIMITED` and `details.retryAfterSeconds`. A successful login resets the counter.
  Trade-off: a lock confirms that the email exists, but only after several failures from
  an IP the rate limiter is already bounding.
- Passwords are hashed with argon2id (19 MiB, 2 iterations, 1 lane; the test suite uses a
  cheap setting). Disabled accounts are rejected after the password check (403).
- `mustChangePassword` users can only call `/auth/me` and `/auth/change-password`; every
  other guarded route answers 403 `PASSWORD_CHANGE_REQUIRED` until they change it.

## Roles and permissions

`DEFAULT_ROLE_PERMISSIONS` (in `@eas/shared`) is copied into the `RolePermission`
collection, one document per role, at API start and by the seed script. Existing documents
are never overwritten, so grants edited by a superadmin survive restarts. Permission guards
read the collection on each request, so edits apply immediately.

```ts
const { authenticate, requirePermission, requireAnyPermission } = deps.auth.middleware;

router.get('/rooms', authenticate(), requirePermission(PERMISSIONS.ROOM_MANAGE), handler);
router.get('/plan', authenticate(), requireAnyPermission(P.SEATPLAN_VIEW, P.SEATPLAN_VIEW_OWN), h);
router.get('/admin-only', authenticate(), requireRole(ROLES.SUPERADMIN), handler);
```

`requirePermission` needs ALL listed permissions; `requireAnyPermission` needs one.
Missing or invalid credentials give 401 (`UNAUTHENTICATED`, `TOKEN_EXPIRED`); a signed-in
user without the role or permission gets 403 `FORBIDDEN`.

## Repository layer

Handlers never use Mongoose models. `authenticate()` builds `req.repos` for the caller and
handlers use `requireRepos(req).users`, and so on. Every repository extends
`ScopedRepository`, which ANDs a scope clause onto each query (a caller-supplied filter can
never widen it):

| Role                | Reads                          | Writes                                                                |
| ------------------- | ------------------------------ | --------------------------------------------------------------------- |
| superadmin, system  | everything                     | everything                                                            |
| authority           | everything                     | rejected (403)                                                        |
| dept_admin, teacher | own department                 | own department; department forced on create, moving a record rejected |
| student             | own department and own records | rejected (403)                                                        |

Records outside the scope look like they do not exist (404, never 403), so ids of other
departments cannot be probed. `SYSTEM_SCOPE` is for code with no signed-in user (login,
token rotation, seeding, startup) and must never be built from request input.

New collections: add a model in `src/models`, a repository extending `ScopedRepository`
with its `departmentField` (and `studentOwnerField` if students can read it), and register
it in `createRepositories`.

**Enforcement:** ESLint (`no-restricted-imports`) fails the build when `mongoose` or a model
is imported outside `models/`, `repositories/`, `db/` and tests; `tests/lintBoundary.test.ts`
guards the rule.

## Seeding (development)

```bash
make seed                      # in the dev stack
npm run seed -w @eas/api       # on the host, reads ../../.env
```

Creates `superadmin@example.test`, `admin@example.test`, `teacher@example.test` and
`student@example.test` (password `DevPassw0rd!` unless `SEED_PASSWORD` is set), plus the
default role grants. Existing users are never modified. The department users point at the
placeholder department id `6a0000000000000000000001`; the Department collection arrives in
segment 6, which creates the document under that id.

With `NODE_ENV=production` it refuses to run unless `ALLOW_PROD_SEED=true`, and then it
requires `SEED_PASSWORD` (12+ characters) and `SEED_SUPERADMIN_EMAIL`, creates only the
superadmin, and flags the account `mustChangePassword`.
