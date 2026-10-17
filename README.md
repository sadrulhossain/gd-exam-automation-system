# Exam Automation System

Web application for universities with two modules:

1. **Student exam seat plans**: design and publish seat allocations per exam.
2. **Teacher exam duty plans**: allocate invigilators and publish duty rosters.

> **Status:** early development. Scaffold, Docker, shared package, API foundation, and authentication and RBAC are in place.
> See [CLAUDE.md](CLAUDE.md) for the segment plan and progress.

## Roles

| Role       | Access                                                                                                                                                      |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| superadmin | Faculties, departments, authority users, role-permission control                                                                                            |
| dept_admin | Own department only: campuses, buildings, rooms (row x column seat grids), teachers, students, courses, classes and sections, exams, seat plans, duty plans |
| teacher    | Edit own profile; view seat plans, own duty plans, department reports                                                                                       |
| student    | View own seat assignment only                                                                                                                               |
| authority  | Read-only reports across departments                                                                                                                        |

## Tech Stack

- **Frontend:** React 18, TypeScript, Vite
- **Backend:** Node.js (active LTS), Express, TypeScript (ESM)
- **Database:** MongoDB with Mongoose
- **Validation:** Zod, shared between API and web
- **Testing:** Vitest, Supertest, mongodb-memory-server, Playwright
- **Infrastructure:** Docker, GitHub Actions

## Planned Repository Layout

npm workspaces monorepo:

```
apps/api            Express API (/api/v1)
apps/web            React frontend
packages/shared     Zod schemas, types, role and permission constants
packages/allocation Pure allocation algorithms (no I/O)
```

## Key Conventions

- API base path is `/api/v1`; errors use `{ error: { code, message, details? } }`.
- All data access goes through a repository layer that scopes by `departmentId`
  for non-superadmin roles.
- Integrity rules are enforced by unique compound indexes.
- Plans are created as `draft` and published with a single document update;
  students and teachers only see `published` plans.
- Secrets come from environment variables only. Never commit secrets or real data.
- Conventional Commits.

## Getting Started

Requires Node.js 24 (see `.nvmrc`).

```bash
npm install
cp .env.example .env   # placeholders only
npm run dev            # API on :3000, web on :5173
```

| Script              | Purpose                               |
| ------------------- | ------------------------------------- |
| `npm run dev`       | Build libraries, then run API and web |
| `npm run lint`      | ESLint (flat config)                  |
| `npm run typecheck` | `tsc --noEmit` in every workspace     |
| `npm test`          | Vitest, one project per workspace     |
| `npm run build`     | Build libraries, then API and web     |
| `npm run format`    | Prettier                              |

Workspace packages (`@eas/shared`, `@eas/allocation`) expose a `source` export
condition pointing at `src/`, used by dev, tests and typecheck, so no build or
path aliases are needed. Production builds use the compiled `dist/` output.

## Shared Package (`@eas/shared`)

The domain contract used by both API and web. Its only runtime dependency is `zod`.

- **Constants:** `ROLES`, `PERMISSIONS`, `DEFAULT_ROLE_PERMISSIONS`, `PLAN_STATUSES`,
  `ERROR_CODES`.
- **Schemas and inferred types:** faculty, department, user, campus, building, room,
  teacher, student, course, class group (with sections), exam, exam session, seat plan
  and assignment, duty plan and assignment, pagination query, `ApiError`. Each CRUD
  entity has `XSchema` (as returned by the API), `CreateXSchema` and `UpdateXSchema`
  (partial). Create inputs never carry `departmentId`: the repository layer injects it.
- **Room helpers:** `roomCapacity(room)` and `isValidSeat(room, row, col)`. Rows and
  columns are 1-based; blocked seats are part of the grid but not usable.
- Ids cross the API as 24-char hex strings, dates as `YYYY-MM-DD`, times as `HH:mm`,
  timestamps as ISO 8601.

## API (`apps/api`)

```
src/config       Zod-validated environment (fails fast, lists every bad variable)
src/app.ts       createApp({ config, logger, db }): middleware order and routing
src/server.ts    start(), graceful shutdown, process entrypoint (index.ts calls main)
src/middleware   request id, logging, security, rate limit, validate, auth guards, 404, error handler
src/modules      one folder per feature; modules/index.ts mounts them under /api/v1
src/models       Mongoose schemas (User, RolePermission, RefreshToken); import only from repositories
src/repositories department-scoped data access; the only code that touches models
src/seed         dev seed logic and CLI (apps/api/scripts/seed.ts is the entry point)
src/db           Mongoose connection with retry, DbStatus for health checks
src/lib          AppError and HTTP status map, logger, duration parsing
src/docs         OpenAPI document built from Zod schemas
src/tests        Vitest + Supertest + mongodb-memory-server (globalSetup, helpers)
```

**Environment** (see `.env.example`; invalid values stop startup with exit code 1):
`NODE_ENV`, `PORT`, `MONGODB_URI`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` (32+ chars,
different from each other), `CORS_ORIGIN` (comma-separated exact origins, required in
production), `LOG_LEVEL`, plus optional `JWT_*_TTL` (like `15m`, `7d`), `TRUST_PROXY`,
`RATE_LIMIT_*`, `AUTH_RATE_LIMIT_*` and `AUTH_LOCKOUT_*`.
Production also rejects secrets that still start with `change-me`.

**Endpoints**

| Path                 | Purpose                                                                    |
| -------------------- | -------------------------------------------------------------------------- |
| `GET /health`        | Liveness for container probes. No database, no rate limit.                 |
| `GET /api/v1/health` | Service and DB state (`ok` or `degraded`); always 200.                     |
| `GET /api/v1/ready`  | 200 only when MongoDB answers a ping, otherwise 503 `SERVICE_UNAVAILABLE`. |
| `GET /api/v1/docs`   | Swagger UI, plus `/api/v1/docs.json`. Not mounted in production.           |
| `/api/v1/auth/*`     | `login`, `refresh`, `logout`, `change-password`, `me`. See below.          |

**Authentication and authorization:** see [docs/authentication.md](docs/authentication.md)
for tokens, the refresh cookie versus body trade-off, lockout, permissions and the
repository layer. Seed development users with `make seed` (or
`npm run seed -w @eas/api`); it refuses `NODE_ENV=production` unless `ALLOW_PROD_SEED=true`.

**Errors** always use `{ error: { code, message, details? } }` with codes from
`@eas/shared`. Throw `AppError` (or `notFound()`, `forbidden()`, ...) in handlers; unknown
errors become a generic 500. Stack traces and messages of unexpected errors are logged,
never returned, except in `NODE_ENV=development`.

**Adding a route:** put it in `src/modules/<name>/`, validate input with
`validate({ body, query, params })` using schemas from `@eas/shared`, read the result with
`validated<typeof schemas>(req)`, guard it with `deps.auth.middleware` (`authenticate()`,
`requireRole`, `requirePermission`), reach data only through `requireRepos(req)`, and mount
the router in `src/modules/index.ts`. ESLint rejects importing `mongoose` or a model
outside `models/`, `repositories/`, `db/` and tests.

**Shutdown:** on SIGTERM/SIGINT the server stops accepting connections, drains requests,
closes MongoDB, then exits 0 (open connections are cut after 10 s).

## Docker

### Development stack

Runs MongoDB (single-node replica set `rs0`), the API (hot reload) and the web app
(Vite HMR). Source is bind-mounted, so edits apply without rebuilding.

```bash
cp .env.example .env
make up        # or: docker compose up -d --build --wait --renew-anon-volumes
```

- Web: http://localhost:5173 (shows the API status; `/api` is proxied to the API)
- API: http://localhost:3000/health, `/api/v1/health` and `/api/v1/ready`
- MongoDB from the host: `mongodb://localhost:27017/exam_automation?directConnection=true`
- Host ports are set in `.env` (`WEB_PORT`, `API_PORT`, `MONGO_PORT`) if the defaults are taken.
- DB browser (optional): `docker compose --profile tools up -d mongo-express`

| Target         | Purpose                                                    |
| -------------- | ---------------------------------------------------------- |
| `make up`      | Build and start the dev stack, wait until healthy          |
| `make down`    | Stop the stack (keeps data)                                |
| `make logs`    | Follow logs (`make logs s=api` for one service)            |
| `make build`   | Build the production images                                |
| `make test`    | Run all tests in the api container                         |
| `make lint`    | Run ESLint in the api container                            |
| `make seed`    | Run the API `seed` script if one exists (none yet)         |
| `make backup`  | Dump MongoDB to `backups/mongo-<timestamp>.archive.gz`     |
| `make restore` | `make restore FILE=backups/<name>.archive.gz` (drops data) |
| `make clean`   | Remove containers, **volumes** and locally built images    |

`make` is not bundled with Windows; use WSL or Git Bash with make installed, or run the
`docker compose` commands from the Makefile directly.

If dependencies change, run `make up` again: it renews the anonymous `node_modules`
volumes so containers pick up the rebuilt image.

### Production stack (single VPS)

`docker-compose.prod.yml` runs Caddy (automatic HTTPS) in front of the web (nginx)
and API images, with MongoDB (replica set with auth). Secrets come only from
`.env.production`, which is never committed.

```bash
cp .env.example .env.production   # set DOMAIN, ACME_EMAIL, Mongo credentials, MONGO_REPLICA_KEY, MONGODB_URI
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build --wait
```

Images: the API runtime image installs production dependencies only and runs as the
non-root `node` user with a `/health` HEALTHCHECK; the web image is static files on
`nginx:alpine` (`docker/nginx.conf`: SPA fallback, gzip, cache headers).
