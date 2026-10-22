import type { Express, Router } from 'express';
import request from 'supertest';
import { ROLES, type Role } from '@eas/shared';
import type { Config } from '../config/index.js';
import { connectWithRetry, disconnectDb } from '../db/index.js';
import { createLogger } from '../lib/logger.js';
import { createAuthKit, type AuthKit } from '../modules/auth/index.js';
import {
  AuditLogModel,
  DepartmentModel,
  FacultyModel,
  RefreshTokenModel,
  RolePermissionModel,
  UserModel,
} from '../models/index.js';
import { buildTestApp, testConfig, uniqueDbUri } from './helpers.js';

export const PASSWORD = 'correct-horse-battery';
export const DEPT_A = 'a1a1a1a1a1a1a1a1a1a1a1a1';
export const DEPT_B = 'b2b2b2b2b2b2b2b2b2b2b2b2';

/** Connects to a fresh database with indexes built and role permissions seeded. */
export async function startAuthDb(config: Config = testConfig()): Promise<AuthKit> {
  const kit = createAuthKit({ config, logger: createLogger(config) });
  await connectWithRetry(uniqueDbUri(), createLogger(config));
  // Build every index up front: the tests rely on the unique indexes to reject duplicates.
  await Promise.all([
    UserModel.init(),
    RefreshTokenModel.init(),
    RolePermissionModel.init(),
    FacultyModel.init(),
    DepartmentModel.init(),
    AuditLogModel.init(),
  ]);
  await kit.repos.rolePermissions.seedDefaults();
  return kit;
}

export async function stopAuthDb(): Promise<void> {
  await disconnectDb();
}

export async function resetUsersAndTokens(): Promise<void> {
  await Promise.all([UserModel.deleteMany({}), RefreshTokenModel.deleteMany({})]);
}

export interface TestUserOptions {
  email?: string;
  role?: Role;
  departmentId?: string | null;
  password?: string;
  isActive?: boolean;
  mustChangePassword?: boolean;
}

let counter = 0;

/** Creates a user directly through the system repository; returns its id and credentials. */
export async function createUser(
  kit: AuthKit,
  options: TestUserOptions = {},
): Promise<{ id: string; email: string; password: string; role: Role }> {
  counter += 1;
  const role = options.role ?? ROLES.TEACHER;
  const scoped = role === ROLES.DEPT_ADMIN || role === ROLES.TEACHER || role === ROLES.STUDENT;
  const email = options.email ?? `user${counter}@example.test`;
  const password = options.password ?? PASSWORD;
  const created = await kit.repos.users.createWithHash({
    email,
    name: `Test ${role} ${counter}`,
    role,
    departmentId:
      options.departmentId === undefined ? (scoped ? DEPT_A : null) : options.departmentId,
    passwordHash: await kit.hasher.hash(password),
    isActive: options.isActive ?? true,
    mustChangePassword: options.mustChangePassword ?? false,
  });
  return { id: created._id.toString(), email, password, role };
}

export interface AuthTestApp {
  app: Express;
  config: Config;
  kit: AuthKit;
}

/** The real app, wired to `kit`, with extra routers (built from the same kit) mounted. */
export function buildAuthApp(
  kit: AuthKit,
  config: Config = testConfig(),
  extraRouters: readonly Router[] = [],
): Express {
  return buildTestApp({ config, auth: kit, extraRouters });
}

export interface LoginTokens {
  accessToken: string;
  refreshToken: string;
}

/** Logs in with the refresh token returned in the body; throws if login fails. */
export async function login(
  app: Express,
  email: string,
  password = PASSWORD,
): Promise<LoginTokens> {
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ email, password, refreshTokenInBody: true });
  if (res.status !== 200)
    throw new Error(`Login failed: ${res.status} ${JSON.stringify(res.body)}`);
  const body = res.body as { accessToken: string; refreshToken: string };
  return { accessToken: body.accessToken, refreshToken: body.refreshToken };
}

export const bearer = (token: string): [string, string] => ['Authorization', `Bearer ${token}`];
