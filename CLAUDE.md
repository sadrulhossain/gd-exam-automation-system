# Exam Automation System: Project Context

## Purpose
Web application for universities with two modules:
1. Student exam seat-plan design.
2. Teacher exam duty-plan design.

## Roles
- **superadmin**: faculties, departments, authority users, role-permission control.
- **dept_admin**: scoped to OWN department only. Manages campuses, buildings, rooms
  (a room is a grid of rows x columns of seats), teachers, students, courses,
  classes (a class has sections), exams, seat plans, duty plans.
- **teacher**: edits own profile; views seat plans, OWN duty plans, department reports.
- **student**: views OWN seat assignment only.
- **authority**: read-only reports across departments.

## Stack
- Frontend: React 18 + TypeScript + Vite
- Backend: Node.js (active LTS) + Express + TypeScript (ESM)
- Database: MongoDB + Mongoose
- Validation: Zod (shared)
- Testing: Vitest, Supertest, mongodb-memory-server, Playwright
- Infra: Docker, GitHub Actions
- Monorepo with npm workspaces: `apps/api`, `apps/web`, `packages/shared`, `packages/allocation`

## Conventions
- TypeScript strict mode, no `any`. API base path: `/api/v1`.
- Errors use one shape: `{ error: { code, message, details? } }`.
- Zod schemas live in `packages/shared` and are used by both API and web.
- MongoDB has no row-level security: ALL data access goes through a repository
  layer that injects `departmentId` for non-superadmin roles. Never query models
  directly inside route handlers.
- Integrity rules are enforced by UNIQUE COMPOUND INDEXES, not application checks.
- Seat/duty plans are generated as status `draft`, then published by a single
  document update. Students and teachers only ever see `published` plans.
- Allocation algorithms are pure functions in `packages/allocation` (no I/O).
- Secrets only via environment variables; never commit secrets or real data.
- Conventional Commits.
- No AI/Claude signature anywhere: not in code, comments, commit messages
  (no `Co-Authored-By` trailers), or PR descriptions.

## Working Agreement
- Work ONLY on the segment requested. Do not change earlier contracts without
  stating the change and the reason.
- State assumptions briefly instead of asking questions, unless blocked.
- Definition of done: lint, typecheck, tests, and build all pass; new code has
  tests; docs touched by the segment are updated; list files created or changed.

## Segment Plan
| Seg | Name | Depends on | Outcome |
|-----|------|------------|---------|
| 0 | Project context file | none | CLAUDE.md with shared rules |
| 1 | Monorepo scaffold and tooling | 0 | Workspaces, TypeScript, lint, test runner |
| 2 | Docker environment | 1 | One-command local stack |
| 3 | Shared package | 1 | Zod schemas, types, role and permission constants |
| 4 | API foundation | 2, 3 | Express app, config, logging, error handling |
| 5 | Authentication and RBAC | 4 | JWT, permissions, department-scoped repositories |
| 6 | Superadmin module | 5 | Faculties, departments, authority users, permissions |
| 7 | Infrastructure module | 5 | Campuses, buildings, rooms, seat grids |
| 8 | Academic data and bulk import | 5, 7 | Teachers, students, courses, classes, sections, Excel import |
| 9 | Exams and sessions | 8 | Exams, sessions, room and student enrolment |
| 10 | Seat-plan engine | 9 | Allocation algorithm and plan lifecycle API |
| 11 | Duty-plan engine and reports | 9 | Invigilator allocation, report endpoints |
| 12 | Frontend foundation | 3, 5 | Routing, auth, API client, layout, guards |
| 13 | Admin screens | 6, 7, 8, 9, 12 | CRUD screens for all setup data |
| 14 | Seat-plan designer UI | 10, 12 | Generate, preview, adjust, publish, print |
| 15 | Duty plan UI, role views, exports | 11, 12 | Teacher, student, authority views; PDF and Excel |
| 16 | Testing and quality gates | all code | RBAC matrix, integration and end-to-end tests |
| 17 | CI/CD and deployment scripts | 2, 16 | Workflows, backup and restore scripts, Render blueprint |
| 18 | README and documentation | all | README, architecture and deployment guides |
