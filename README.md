# Exam Automation System

Web application for universities with two modules:

1. **Student exam seat plans**: design and publish seat allocations per exam.
2. **Teacher exam duty plans**: allocate invigilators and publish duty rosters.

> **Status:** early development. Monorepo scaffold is in place; no features yet.
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

## Docker

### Development stack

Runs MongoDB (single-node replica set `rs0`), the API (hot reload) and the web app
(Vite HMR). Source is bind-mounted, so edits apply without rebuilding.

```bash
cp .env.example .env
make up        # or: docker compose up -d --build --wait --renew-anon-volumes
```

- Web: http://localhost:5173 (shows the API status; `/api` is proxied to the API)
- API: http://localhost:3000/health and `/api/v1/health`
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
