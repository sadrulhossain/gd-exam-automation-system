import { ROLES, EmailSchema, type Role } from '@eas/shared';
import type { Logger } from '../lib/logger.js';
import type { PasswordHasher } from '../modules/auth/password.js';
import type { SystemRepositories } from '../repositories/index.js';

/**
 * Id of the department the development users belong to. Non-production seeding creates the
 * real department document (under a development faculty) with this id.
 */
export const DEV_DEPARTMENT_ID = '6a0000000000000000000001';

const DEV_FACULTY = { name: 'Development Faculty', code: 'DEVF' };
const DEV_DEPARTMENT = { name: 'Development Department', code: 'DEVD' };

/** Password given to seeded users in development when SEED_PASSWORD is not set. */
export const DEV_SEED_PASSWORD = 'DevPassw0rd!';

const MIN_PRODUCTION_PASSWORD_LENGTH = 12;

export class SeedRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeedRefusedError';
  }
}

export interface SeedEnv {
  NODE_ENV?: string | undefined;
  ALLOW_PROD_SEED?: string | undefined;
  SEED_PASSWORD?: string | undefined;
  SEED_SUPERADMIN_EMAIL?: string | undefined;
}

export interface SeedDeps {
  env: SeedEnv;
  repos: SystemRepositories;
  hasher: PasswordHasher;
  logger: Logger;
}

export interface SeedResult {
  created: string[];
  skipped: string[];
}

interface SeedUser {
  email: string;
  name: string;
  role: Role;
  departmentId: string | null;
}

const isProduction = (env: SeedEnv): boolean => env.NODE_ENV === 'production';

/** Refuses production unless ALLOW_PROD_SEED=true, then demands an explicit password. */
export function assertSeedAllowed(env: SeedEnv): void {
  if (!isProduction(env)) return;
  if (env.ALLOW_PROD_SEED !== 'true') {
    throw new SeedRefusedError(
      'Refusing to seed with NODE_ENV=production. Set ALLOW_PROD_SEED=true to override.',
    );
  }
  if (
    env.SEED_PASSWORD === undefined ||
    env.SEED_PASSWORD.length < MIN_PRODUCTION_PASSWORD_LENGTH
  ) {
    throw new SeedRefusedError(
      `Production seeding needs SEED_PASSWORD of at least ${MIN_PRODUCTION_PASSWORD_LENGTH} characters.`,
    );
  }
  if (env.SEED_SUPERADMIN_EMAIL === undefined) {
    throw new SeedRefusedError('Production seeding needs SEED_SUPERADMIN_EMAIL.');
  }
}

function seedUsers(env: SeedEnv): SeedUser[] {
  const superadminEmail = EmailSchema.parse(env.SEED_SUPERADMIN_EMAIL ?? 'superadmin@example.test');
  const superadmin: SeedUser = {
    email: superadminEmail,
    name: 'Super Admin',
    role: ROLES.SUPERADMIN,
    departmentId: null,
  };
  // Production gets the superadmin only: the sample users point at a development department.
  if (isProduction(env)) return [superadmin];
  return [
    superadmin,
    {
      email: 'admin@example.test',
      name: 'Dev Department Admin',
      role: ROLES.DEPT_ADMIN,
      departmentId: DEV_DEPARTMENT_ID,
    },
    {
      email: 'teacher@example.test',
      name: 'Dev Teacher',
      role: ROLES.TEACHER,
      departmentId: DEV_DEPARTMENT_ID,
    },
    {
      email: 'student@example.test',
      name: 'Dev Student',
      role: ROLES.STUDENT,
      departmentId: DEV_DEPARTMENT_ID,
    },
  ];
}

/**
 * Creates the default role grants and the starter users. Idempotent: existing users are
 * never modified, so re-running cannot reset a changed password. In production the
 * accounts must change their password on first sign-in.
 */
export async function runSeed({ env, repos, hasher, logger }: SeedDeps): Promise<SeedResult> {
  assertSeedAllowed(env);
  const password = env.SEED_PASSWORD ?? DEV_SEED_PASSWORD;
  const result: SeedResult = { created: [], skipped: [] };

  const roles = await repos.rolePermissions.seedDefaults();
  if (roles.length > 0) logger.info({ roles }, 'Seeded default role permissions');

  if (!isProduction(env)) {
    const faculty = await repos.faculties.ensure(DEV_FACULTY);
    const created = await repos.departments.ensureWithId({
      id: DEV_DEPARTMENT_ID,
      facultyId: faculty._id.toString(),
      ...DEV_DEPARTMENT,
    });
    if (created) logger.info({ departmentId: DEV_DEPARTMENT_ID }, 'Seeded development department');
  }

  const passwordHash = await hasher.hash(password);
  for (const user of seedUsers(env)) {
    if ((await repos.users.findForLogin(user.email)) !== null) {
      result.skipped.push(user.email);
      continue;
    }
    await repos.users.createWithHash({
      email: user.email,
      name: user.name,
      role: user.role,
      departmentId: user.departmentId,
      passwordHash,
      isActive: true,
      mustChangePassword: isProduction(env),
    });
    result.created.push(user.email);
  }
  return result;
}
