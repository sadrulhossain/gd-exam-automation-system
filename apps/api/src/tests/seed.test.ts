import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ROLES } from '@eas/shared';
import { createLogger } from '../lib/logger.js';
import type { AuthKit } from '../modules/auth/index.js';
import { DepartmentModel, FacultyModel, RolePermissionModel, UserModel } from '../models/index.js';
import {
  DEV_DEPARTMENT_ID,
  DEV_SEED_PASSWORD,
  runSeed,
  SeedRefusedError,
  type SeedEnv,
} from '../seed/seed.js';
import { resetUsersAndTokens, startAuthDb, stopAuthDb } from './authHelpers.js';
import { testConfig } from './helpers.js';

let kit: AuthKit;
const logger = createLogger(testConfig());

const seed = (env: SeedEnv) => runSeed({ env, repos: kit.repos, hasher: kit.hasher, logger });
const PROD_PASSWORD = 'a-long-production-password';
const PROD_ENV: SeedEnv = {
  NODE_ENV: 'production',
  ALLOW_PROD_SEED: 'true',
  SEED_PASSWORD: PROD_PASSWORD,
  SEED_SUPERADMIN_EMAIL: 'root@university.example',
};

beforeAll(async () => {
  kit = await startAuthDb();
});
afterAll(stopAuthDb);
beforeEach(async () => {
  await resetUsersAndTokens();
  await Promise.all([
    RolePermissionModel.deleteMany({}),
    FacultyModel.deleteMany({}),
    DepartmentModel.deleteMany({}),
  ]);
});

describe('seed script', () => {
  it('creates a superadmin, department admin, teacher and student plus role grants', async () => {
    const result = await seed({ NODE_ENV: 'development' });

    expect(result.created.sort()).toEqual([
      'admin@example.test',
      'student@example.test',
      'superadmin@example.test',
      'teacher@example.test',
    ]);
    const users = await UserModel.find().lean();
    expect(users.map((u) => u.role).sort()).toEqual(
      [ROLES.DEPT_ADMIN, ROLES.STUDENT, ROLES.SUPERADMIN, ROLES.TEACHER].sort(),
    );
    for (const user of users) {
      expect(user.departmentId?.toString() ?? null).toBe(
        user.role === ROLES.SUPERADMIN ? null : DEV_DEPARTMENT_ID,
      );
      expect(user.mustChangePassword).toBe(false);
    }
    expect(await RolePermissionModel.countDocuments()).toBe(Object.values(ROLES).length);

    const found = await kit.repos.users.findForLogin('teacher@example.test');
    expect(found?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(await kit.hasher.verify(found?.passwordHash ?? '', DEV_SEED_PASSWORD)).toBe(true);
  });

  it('creates the development department the seeded users belong to', async () => {
    await seed({ NODE_ENV: 'development' });
    const department = await DepartmentModel.findById(DEV_DEPARTMENT_ID).lean();
    expect(department).toMatchObject({ code: 'DEVD', isArchived: false });
    expect(await FacultyModel.findById(department?.facultyId).lean()).toMatchObject({
      code: 'DEVF',
    });
  });

  it('is idempotent and never resets an existing password', async () => {
    await seed({ NODE_ENV: 'development' });
    const newHash = await kit.hasher.hash('changed-by-the-user');
    await UserModel.updateOne({ email: 'admin@example.test' }, { passwordHash: newHash });

    const second = await seed({ NODE_ENV: 'development' });
    expect(second.created).toEqual([]);
    expect(second.skipped).toHaveLength(4);
    const admin = await kit.repos.users.findForLogin('admin@example.test');
    expect(admin?.passwordHash).toBe(newHash);
    expect(await UserModel.countDocuments()).toBe(4);
    expect(await FacultyModel.countDocuments()).toBe(1);
    expect(await DepartmentModel.countDocuments()).toBe(1);
  });

  it('uses SEED_PASSWORD when provided', async () => {
    await seed({ NODE_ENV: 'development', SEED_PASSWORD: 'my-own-dev-password' });
    const user = await kit.repos.users.findForLogin('student@example.test');
    expect(await kit.hasher.verify(user?.passwordHash ?? '', 'my-own-dev-password')).toBe(true);
  });

  it('refuses to run in production without ALLOW_PROD_SEED, and touches nothing', async () => {
    await expect(seed({ NODE_ENV: 'production' })).rejects.toThrow(SeedRefusedError);
    await expect(seed({ ...PROD_ENV, ALLOW_PROD_SEED: 'yes' })).rejects.toThrow(
      /ALLOW_PROD_SEED=true/,
    );
    expect(await UserModel.countDocuments()).toBe(0);
    expect(await RolePermissionModel.countDocuments()).toBe(0);
  });

  it.each([
    ['no password', { SEED_PASSWORD: undefined }],
    ['a short password', { SEED_PASSWORD: 'short' }],
    ['no superadmin email', { SEED_SUPERADMIN_EMAIL: undefined }],
  ])('refuses production seeding with %s', async (_name, override) => {
    await expect(seed({ ...PROD_ENV, ...override })).rejects.toThrow(SeedRefusedError);
    expect(await UserModel.countDocuments()).toBe(0);
  });

  it('seeds only a superadmin in production, who must change the password', async () => {
    const result = await seed(PROD_ENV);
    expect(result.created).toEqual(['root@university.example']);

    const user = await kit.repos.users.findForLogin('root@university.example');
    expect(user).toMatchObject({ role: ROLES.SUPERADMIN, mustChangePassword: true });
    expect(await kit.hasher.verify(user?.passwordHash ?? '', PROD_PASSWORD)).toBe(true);
    expect(await DepartmentModel.countDocuments()).toBe(0);
  });
});
