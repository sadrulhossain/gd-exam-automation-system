import { Router } from 'express';
import request from 'supertest';
import { SignJWT } from 'jose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ERROR_CODES, ROLES } from '@eas/shared';
import { createAccessTokenService, type AuthKit } from '../modules/auth/index.js';
import { RefreshTokenModel, UserModel } from '../models/index.js';
import {
  bearer,
  buildAuthApp,
  createUser,
  login,
  PASSWORD,
  resetUsersAndTokens,
  startAuthDb,
  stopAuthDb,
} from './authHelpers.js';
import { testConfig } from './helpers.js';

const API = '/api/v1';
const LOCKOUT_THRESHOLD = 3;

let kit: AuthKit;

const config = testConfig({
  auth: {
    rateLimit: { windowMs: 60_000, max: 10_000 },
    lockout: { threshold: LOCKOUT_THRESHOLD, baseMs: 60_000, maxMs: 3_600_000 },
  },
});

function probeRouter(): Router {
  const router = Router();
  router.get('/probe/authenticated', kit.middleware.authenticate(), (req, res) => {
    res.json({ userId: req.auth?.userId });
  });
  return router;
}

function app() {
  return buildAuthApp(kit, config, [probeRouter()]);
}

beforeAll(async () => {
  kit = await startAuthDb(config);
});
afterAll(stopAuthDb);
beforeEach(resetUsersAndTokens);

describe('POST /auth/login', () => {
  it('returns a bearer session and a httpOnly refresh cookie, never the hash', async () => {
    const user = await createUser(kit, { role: ROLES.TEACHER });
    const res = await request(app()).post(`${API}/auth/login`).send({
      email: user.email,
      password: user.password,
    });

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toMatchObject({
      tokenType: 'Bearer',
      expiresIn: 900,
      user: { id: user.id, email: user.email, role: ROLES.TEACHER, mustChangePassword: false },
    });
    expect(typeof res.body.accessToken).toBe('string');
    expect(res.body.refreshToken).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');

    const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.startsWith('refresh_token='),
    );
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).toMatch(/Path=\/api\/v1\/auth/);
  });

  it('puts the refresh token in the body instead of a cookie when asked', async () => {
    const user = await createUser(kit);
    const res = await request(app())
      .post(`${API}/auth/login`)
      .send({ email: user.email, password: user.password, refreshTokenInBody: true });

    expect(res.status).toBe(200);
    expect(typeof res.body.refreshToken).toBe('string');
    const cookies = (res.headers['set-cookie'] ?? []) as unknown as string[];
    expect(
      cookies.some((c) => /^refresh_token=[^;]+/.test(c) && !/Expires=Thu, 01 Jan 1970/.test(c)),
    ).toBe(false);
  });

  it('stores a password hash (argon2id) and only a hash of the refresh token', async () => {
    const user = await createUser(kit);
    const tokens = await login(app(), user.email);

    const stored = await UserModel.findOne({ email: user.email }).select('+passwordHash').lean();
    expect(stored?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(stored?.passwordHash).not.toContain(user.password);
    expect(await RefreshTokenModel.countDocuments({ tokenHash: tokens.refreshToken })).toBe(0);
    expect(await RefreshTokenModel.countDocuments()).toBe(1);
  });

  it('matches the email case-insensitively', async () => {
    const user = await createUser(kit, { email: 'mixed@example.test' });
    const res = await request(app())
      .post(`${API}/auth/login`)
      .send({ email: 'MiXeD@Example.TEST', password: user.password });
    expect(res.status).toBe(200);
  });

  it('rejects a wrong password and an unknown email with the same response', async () => {
    const user = await createUser(kit);
    const wrongPassword = await request(app())
      .post(`${API}/auth/login`)
      .send({ email: user.email, password: 'not-the-password' });
    const unknownEmail = await request(app())
      .post(`${API}/auth/login`)
      .send({ email: 'nobody@example.test', password: PASSWORD });

    expect(wrongPassword.status).toBe(401);
    expect(wrongPassword.body.error.code).toBe(ERROR_CODES.INVALID_CREDENTIALS);
    expect(unknownEmail.status).toBe(401);
    expect(unknownEmail.body).toEqual(wrongPassword.body);
  });

  it('rejects a disabled account only after the correct password is given', async () => {
    const user = await createUser(kit, { isActive: false });
    const right = await request(app())
      .post(`${API}/auth/login`)
      .send({ email: user.email, password: user.password });
    const wrong = await request(app())
      .post(`${API}/auth/login`)
      .send({ email: user.email, password: 'wrong-password-123' });

    expect(right.status).toBe(403);
    expect(right.body.error.code).toBe(ERROR_CODES.FORBIDDEN);
    expect(wrong.status).toBe(401);
  });

  it('validates the request body', async () => {
    const res = await request(app()).post(`${API}/auth/login`).send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(ERROR_CODES.VALIDATION_ERROR);
  });

  it('locks the account after repeated failures, even for the correct password', async () => {
    const user = await createUser(kit);
    for (let i = 0; i < LOCKOUT_THRESHOLD; i += 1) {
      const res = await request(app())
        .post(`${API}/auth/login`)
        .send({ email: user.email, password: 'wrong-password-123' });
      expect(res.status).toBe(401);
    }

    const locked = await request(app())
      .post(`${API}/auth/login`)
      .send({ email: user.email, password: user.password });
    expect(locked.status).toBe(429);
    expect(locked.body.error.code).toBe(ERROR_CODES.RATE_LIMITED);
    expect(locked.body.error.details.retryAfterSeconds).toBeGreaterThan(0);
    expect(locked.body.error.details.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it('doubles the lock for each further failure and caps it', async () => {
    const user = await createUser(kit);
    const policy = { threshold: 3, baseMs: 1_000, maxMs: 5_000 };
    const now = new Date('2030-01-01T00:00:00Z');
    const lockedFor = async (): Promise<number | null> => {
      const doc = await UserModel.findOne({ email: user.email }).lean();
      return doc?.lockedUntil == null ? null : doc.lockedUntil.getTime() - now.getTime();
    };

    const results: (number | null)[] = [];
    for (let i = 0; i < 7; i += 1) {
      await kit.repos.users.recordFailedLogin(user.id, policy, now);
      results.push(await lockedFor());
    }
    // Failures 1 and 2 do not lock; then 1s, 2s, 4s, and the 5s cap.
    expect(results).toEqual([null, null, 1_000, 2_000, 4_000, 5_000, 5_000]);
  });

  it('lets the user in once the lock has expired and clears the failure count', async () => {
    const user = await createUser(kit);
    for (let i = 0; i < LOCKOUT_THRESHOLD; i += 1) {
      await request(app())
        .post(`${API}/auth/login`)
        .send({ email: user.email, password: 'wrong-password-123' });
    }
    await UserModel.updateOne({ email: user.email }, { lockedUntil: new Date(Date.now() - 1_000) });

    const res = await request(app())
      .post(`${API}/auth/login`)
      .send({ email: user.email, password: user.password });
    expect(res.status).toBe(200);
    const stored = await UserModel.findOne({ email: user.email }).lean();
    expect(stored?.failedLoginAttempts).toBe(0);
    expect(stored?.lockedUntil).toBeNull();
  });

  it('rate limits the endpoint per IP', async () => {
    const limited = testConfig({
      auth: {
        rateLimit: { windowMs: 60_000, max: 3 },
        lockout: { threshold: 100, baseMs: 60_000, maxMs: 3_600_000 },
      },
    });
    const limitedApp = buildAuthApp(kit, limited);
    const statuses: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const res = await request(limitedApp)
        .post(`${API}/auth/login`)
        .send({ email: 'nobody@example.test', password: PASSWORD });
      statuses.push(res.status);
    }
    expect(statuses).toEqual([401, 401, 401, 429, 429]);
  });
});

describe('POST /auth/refresh', () => {
  it('rotates the refresh token: a new pair is issued and the old token is spent', async () => {
    const user = await createUser(kit);
    const first = await login(app(), user.email);

    const res = await request(app())
      .post(`${API}/auth/refresh`)
      .send({ refreshToken: first.refreshToken });
    expect(res.status).toBe(200);
    expect(res.body.refreshToken).toEqual(expect.any(String));
    expect(res.body.refreshToken).not.toBe(first.refreshToken);
    expect(res.body.user.id).toBe(user.id);

    const me = await request(app())
      .get(`${API}/auth/me`)
      .set(...bearer(res.body.accessToken as string));
    expect(me.status).toBe(200);
  });

  it('detects reuse of a spent token and revokes the whole family', async () => {
    const user = await createUser(kit);
    const first = await login(app(), user.email);
    const second = await request(app())
      .post(`${API}/auth/refresh`)
      .send({ refreshToken: first.refreshToken });
    const secondToken = second.body.refreshToken as string;

    const replay = await request(app())
      .post(`${API}/auth/refresh`)
      .send({ refreshToken: first.refreshToken });
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe(ERROR_CODES.UNAUTHENTICATED);

    // The legitimate holder of the newest token is signed out too.
    const afterReuse = await request(app())
      .post(`${API}/auth/refresh`)
      .send({ refreshToken: secondToken });
    expect(afterReuse.status).toBe(401);
    expect(await RefreshTokenModel.countDocuments({ revokedAt: null })).toBe(0);
  });

  it('does not touch other sessions of the same user when one family is revoked', async () => {
    const user = await createUser(kit);
    const laptop = await login(app(), user.email);
    const phone = await login(app(), user.email);
    await request(app()).post(`${API}/auth/refresh`).send({ refreshToken: laptop.refreshToken });
    await request(app()).post(`${API}/auth/refresh`).send({ refreshToken: laptop.refreshToken });

    const phoneRefresh = await request(app())
      .post(`${API}/auth/refresh`)
      .send({ refreshToken: phone.refreshToken });
    expect(phoneRefresh.status).toBe(200);
  });

  it('lets exactly one of two concurrent refreshes with the same token succeed', async () => {
    const user = await createUser(kit);
    const { refreshToken } = await login(app(), user.email);
    const responses = await Promise.all([
      request(app()).post(`${API}/auth/refresh`).send({ refreshToken }),
      request(app()).post(`${API}/auth/refresh`).send({ refreshToken }),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 401]);
  });

  it('reads the token from the cookie when the body has none', async () => {
    const user = await createUser(kit);
    const agent = request.agent(app());
    const loginRes = await agent
      .post(`${API}/auth/login`)
      .send({ email: user.email, password: user.password });
    expect(loginRes.status).toBe(200);

    const res = await agent.post(`${API}/auth/refresh`);
    expect(res.status).toBe(200);
    expect(res.body.refreshToken).toBeUndefined();
    // The rotated cookie works for the next refresh.
    expect((await agent.post(`${API}/auth/refresh`)).status).toBe(200);
  });

  it('rejects a missing token and an unknown token', async () => {
    const missing = await request(app()).post(`${API}/auth/refresh`);
    expect(missing.status).toBe(401);
    expect(missing.body.error.code).toBe(ERROR_CODES.UNAUTHENTICATED);

    const unknown = await request(app())
      .post(`${API}/auth/refresh`)
      .send({ refreshToken: 'not-a-real-token' });
    expect(unknown.status).toBe(401);
  });

  it('rejects an expired refresh token with TOKEN_EXPIRED', async () => {
    const user = await createUser(kit);
    const { refreshToken } = await login(app(), user.email);
    await RefreshTokenModel.updateMany({}, { expiresAt: new Date(Date.now() - 1_000) });

    const res = await request(app()).post(`${API}/auth/refresh`).send({ refreshToken });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe(ERROR_CODES.TOKEN_EXPIRED);
  });

  it('rejects the token once the user is deactivated', async () => {
    const user = await createUser(kit);
    const { refreshToken } = await login(app(), user.email);
    await UserModel.updateOne({ email: user.email }, { isActive: false });

    const res = await request(app()).post(`${API}/auth/refresh`).send({ refreshToken });
    expect(res.status).toBe(401);
  });
});

describe('POST /auth/logout', () => {
  it('revokes the session so the refresh token stops working', async () => {
    const user = await createUser(kit);
    const { refreshToken } = await login(app(), user.email);

    const out = await request(app()).post(`${API}/auth/logout`).send({ refreshToken });
    expect(out.status).toBe(204);

    const res = await request(app()).post(`${API}/auth/refresh`).send({ refreshToken });
    expect(res.status).toBe(401);
  });

  it('works from the cookie, clears it, and is idempotent', async () => {
    const user = await createUser(kit);
    const agent = request.agent(app());
    await agent.post(`${API}/auth/login`).send({ email: user.email, password: user.password });

    const out = await agent.post(`${API}/auth/logout`);
    expect(out.status).toBe(204);
    expect((out.headers['set-cookie'] as unknown as string[]).join(';')).toMatch(/refresh_token=;/);
    expect((await agent.post(`${API}/auth/refresh`)).status).toBe(401);
    expect((await agent.post(`${API}/auth/logout`)).status).toBe(204);
  });
});

describe('GET /auth/me and access tokens', () => {
  it('returns the signed-in user', async () => {
    const user = await createUser(kit, { role: ROLES.AUTHORITY });
    const { accessToken } = await login(app(), user.email);
    const res = await request(app())
      .get(`${API}/auth/me`)
      .set(...bearer(accessToken));
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: user.id, role: ROLES.AUTHORITY, departmentId: null });
  });

  it.each([
    ['no header', undefined],
    ['a non-bearer scheme', 'Basic abc'],
    ['a garbage token', 'Bearer not.a.jwt'],
  ])('rejects %s', async (_name, header) => {
    const req = request(app()).get(`${API}/auth/me`);
    const res = await (header === undefined ? req : req.set('Authorization', header));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe(ERROR_CODES.UNAUTHENTICATED);
  });

  it('rejects an expired access token with TOKEN_EXPIRED', async () => {
    const user = await createUser(kit);
    const tokens = createAccessTokenService(config);
    const issued = await tokens.sign(
      { userId: user.id, tokenVersion: 0 },
      new Date(Date.now() - 3_600_000),
    );
    const res = await request(app())
      .get(`${API}/auth/me`)
      .set(...bearer(issued.token));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe(ERROR_CODES.TOKEN_EXPIRED);
  });

  it('rejects a token signed with another secret', async () => {
    const user = await createUser(kit);
    const forged = await new SignJWT({ tv: 0 })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(user.id)
      .setIssuer('eas-api')
      .setAudience('eas-client')
      .setExpirationTime('15m')
      .sign(new TextEncoder().encode('x'.repeat(40)));
    const res = await request(app())
      .get(`${API}/auth/me`)
      .set(...bearer(forged));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe(ERROR_CODES.UNAUTHENTICATED);
  });

  it('rejects a token whose user was deactivated or deleted', async () => {
    const deactivated = await createUser(kit);
    const deleted = await createUser(kit);
    const a = await login(app(), deactivated.email);
    const b = await login(app(), deleted.email);
    await UserModel.updateOne({ email: deactivated.email }, { isActive: false });
    await UserModel.deleteOne({ email: deleted.email });

    expect(
      (
        await request(app())
          .get(`${API}/auth/me`)
          .set(...bearer(a.accessToken))
      ).status,
    ).toBe(401);
    expect(
      (
        await request(app())
          .get(`${API}/auth/me`)
          .set(...bearer(b.accessToken))
      ).status,
    ).toBe(401);
  });

  it('uses the role stored in the database, not anything the token claims', async () => {
    const user = await createUser(kit, { role: ROLES.TEACHER });
    const { accessToken } = await login(app(), user.email);
    await UserModel.updateOne({ email: user.email }, { role: ROLES.DEPT_ADMIN });
    const res = await request(app())
      .get(`${API}/auth/me`)
      .set(...bearer(accessToken));
    expect(res.body.user.role).toBe(ROLES.DEPT_ADMIN);
  });
});

describe('POST /auth/change-password', () => {
  const NEW_PASSWORD = 'a-brand-new-passphrase';

  it('changes the password, ends other sessions and returns a fresh one', async () => {
    const user = await createUser(kit);
    const old = await login(app(), user.email);

    const res = await request(app())
      .post(`${API}/auth/change-password`)
      .set(...bearer(old.accessToken))
      .send({
        currentPassword: user.password,
        newPassword: NEW_PASSWORD,
        refreshTokenInBody: true,
      });
    expect(res.status).toBe(200);
    expect(res.body.refreshToken).toEqual(expect.any(String));

    // Old access token (tokenVersion bumped) and old refresh token no longer work.
    expect(
      (
        await request(app())
          .get(`${API}/auth/me`)
          .set(...bearer(old.accessToken))
      ).status,
    ).toBe(401);
    expect(
      (await request(app()).post(`${API}/auth/refresh`).send({ refreshToken: old.refreshToken }))
        .status,
    ).toBe(401);
    // The new session does.
    expect(
      (
        await request(app())
          .get(`${API}/auth/me`)
          .set(...bearer(res.body.accessToken as string))
      ).status,
    ).toBe(200);

    const oldLogin = await request(app())
      .post(`${API}/auth/login`)
      .send({ email: user.email, password: user.password });
    const newLogin = await request(app())
      .post(`${API}/auth/login`)
      .send({ email: user.email, password: NEW_PASSWORD });
    expect(oldLogin.status).toBe(401);
    expect(newLogin.status).toBe(200);
  });

  it('rejects a wrong current password and an unchanged password', async () => {
    const user = await createUser(kit);
    const { accessToken } = await login(app(), user.email);

    const wrong = await request(app())
      .post(`${API}/auth/change-password`)
      .set(...bearer(accessToken))
      .send({ currentPassword: 'definitely-wrong', newPassword: NEW_PASSWORD });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error.code).toBe(ERROR_CODES.INVALID_CREDENTIALS);

    const same = await request(app())
      .post(`${API}/auth/change-password`)
      .set(...bearer(accessToken))
      .send({ currentPassword: user.password, newPassword: user.password });
    expect(same.status).toBe(400);
    expect(same.body.error.code).toBe(ERROR_CODES.VALIDATION_ERROR);
  });

  it('requires authentication', async () => {
    const res = await request(app())
      .post(`${API}/auth/change-password`)
      .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(401);
  });

  it('blocks everything except password change while mustChangePassword is set', async () => {
    const user = await createUser(kit, { mustChangePassword: true });
    const { accessToken } = await login(app(), user.email);

    const blocked = await request(app())
      .get(`${API}/probe/authenticated`)
      .set(...bearer(accessToken));
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe(ERROR_CODES.PASSWORD_CHANGE_REQUIRED);

    const me = await request(app())
      .get(`${API}/auth/me`)
      .set(...bearer(accessToken));
    expect(me.status).toBe(200);
    expect(me.body.user.mustChangePassword).toBe(true);

    const changed = await request(app())
      .post(`${API}/auth/change-password`)
      .set(...bearer(accessToken))
      .send({ currentPassword: user.password, newPassword: NEW_PASSWORD });
    expect(changed.status).toBe(200);
    expect(changed.body.user.mustChangePassword).toBe(false);

    const free = await request(app())
      .get(`${API}/probe/authenticated`)
      .set(...bearer(changed.body.accessToken as string));
    expect(free.status).toBe(200);
  });
});
