# Exam Automation System

Web application for universities with two modules:

1. **Student exam seat plans**: design and publish seat allocations per exam.
2. **Teacher exam duty plans**: allocate invigilators and publish duty rosters.

> **Status:** early development. Only project context and conventions exist so far.
> See [CLAUDE.md](CLAUDE.md) for the segment plan and progress.

## Roles

| Role | Access |
|------|--------|
| superadmin | Faculties, departments, authority users, role-permission control |
| dept_admin | Own department only: campuses, buildings, rooms (row x column seat grids), teachers, students, courses, classes and sections, exams, seat plans, duty plans |
| teacher | Edit own profile; view seat plans, own duty plans, department reports |
| student | View own seat assignment only |
| authority | Read-only reports across departments |

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

Setup, run and test instructions will be added as the tooling lands
(monorepo scaffold, Docker environment). The full README is finalised in the
documentation segment.
