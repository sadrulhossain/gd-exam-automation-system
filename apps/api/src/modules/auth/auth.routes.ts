import { Router, type CookieOptions, type Response } from 'express';
import { z } from 'zod';
import {
  ChangePasswordSchema,
  LoginRequestSchema,
  LogoutRequestSchema,
  RefreshRequestSchema,
  type AuthSession,
  type MeResponse,
} from '@eas/shared';
import type { Config } from '../../config/index.js';
import { notFound, unauthenticated } from '../../lib/errors.js';
import { requireAuth, requireRepos, type AuthMiddleware } from '../../middleware/auth.js';
import { createRateLimiter } from '../../middleware/rateLimit.js';
import { validate, validated } from '../../middleware/validate.js';
import { toAuthUser, type AuthService, type IssuedSession } from './auth.service.js';

export const REFRESH_COOKIE = 'refresh_token';
export const AUTH_PATH = '/auth';

export interface AuthRouterDeps {
  config: Pick<Config, 'isProduction' | 'auth'>;
  service: AuthService;
  auth: AuthMiddleware;
}

/** Clients that send no body (cookie mode) must still pass validation. */
const optionalBody = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => value ?? {}, schema);

/**
 * The refresh cookie is httpOnly (not readable by scripts) and scoped to the auth routes.
 * SameSite=Strict keeps it off cross-site requests, which doubles as CSRF protection for
 * refresh and logout. The cost: a front end on a different site never gets the cookie, so
 * such deployments ask for the token in the response body instead (`refreshTokenInBody`).
 */
function cookieOptions(
  config: Pick<Config, 'isProduction'>,
  session?: IssuedSession,
): CookieOptions {
  return {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: 'strict',
    path: `/api/v1${AUTH_PATH}`,
    ...(session === undefined ? {} : { expires: session.refreshTokenExpiresAt }),
  };
}

function readCookie(cookies: unknown, name: string): string | undefined {
  if (typeof cookies !== 'object' || cookies === null) return undefined;
  const value = (cookies as Record<string, unknown>)[name];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function createAuthRouter({ config, service, auth }: AuthRouterDeps): Router {
  const router = Router();
  const credentialLimiter = createRateLimiter(config.auth.rateLimit);

  /** Sends the session, delivering the refresh token by cookie or in the body, never both. */
  function sendSession(res: Response, session: IssuedSession, tokenInBody: boolean): void {
    if (tokenInBody) {
      res.clearCookie(REFRESH_COOKIE, cookieOptions(config));
    } else {
      res.cookie(REFRESH_COOKIE, session.refreshToken, cookieOptions(config, session));
    }
    const body: AuthSession = {
      accessToken: session.accessToken,
      tokenType: 'Bearer',
      expiresIn: session.expiresInSeconds,
      accessTokenExpiresAt: session.accessTokenExpiresAt.toISOString(),
      ...(tokenInBody ? { refreshToken: session.refreshToken } : {}),
      user: session.user,
    };
    res.set('Cache-Control', 'no-store').json(body);
  }

  const loginSchemas = { body: LoginRequestSchema };
  router.post(`${AUTH_PATH}/login`, credentialLimiter, validate(loginSchemas), async (req, res) => {
    const { body } = validated<typeof loginSchemas>(req);
    const session = await service.login(body.email, body.password);
    sendSession(res, session, body.refreshTokenInBody);
  });

  const refreshSchemas = { body: optionalBody(RefreshRequestSchema) };
  router.post(
    `${AUTH_PATH}/refresh`,
    credentialLimiter,
    validate(refreshSchemas),
    async (req, res) => {
      const { body } = validated<typeof refreshSchemas>(req);
      const token = body.refreshToken ?? readCookie(req.cookies, REFRESH_COOKIE);
      if (token === undefined) throw unauthenticated('Refresh token is missing');
      const session = await service.refresh(token);
      // A client that sent the token in the body gets the next one back the same way.
      sendSession(res, session, body.refreshToken !== undefined || body.refreshTokenInBody);
    },
  );

  const logoutSchemas = { body: optionalBody(LogoutRequestSchema) };
  router.post(`${AUTH_PATH}/logout`, validate(logoutSchemas), async (req, res) => {
    const { body } = validated<typeof logoutSchemas>(req);
    await service.logout(body.refreshToken ?? readCookie(req.cookies, REFRESH_COOKIE));
    res.clearCookie(REFRESH_COOKIE, cookieOptions(config));
    res.status(204).end();
  });

  const changePasswordSchemas = { body: ChangePasswordSchema };
  router.post(
    `${AUTH_PATH}/change-password`,
    credentialLimiter,
    auth.authenticate({ allowPasswordChangePending: true }),
    validate(changePasswordSchemas),
    async (req, res) => {
      const { body } = validated<typeof changePasswordSchemas>(req);
      const { userId } = requireAuth(req);
      const session = await service.changePassword(userId, body.currentPassword, body.newPassword);
      sendSession(res, session, body.refreshTokenInBody);
    },
  );

  router.get(
    `${AUTH_PATH}/me`,
    auth.authenticate({ allowPasswordChangePending: true }),
    async (req, res) => {
      const { userId } = requireAuth(req);
      const user = await requireRepos(req).users.findById(userId);
      if (user === null) throw notFound('User not found');
      const body: MeResponse = { user: toAuthUser(user) };
      res.set('Cache-Control', 'no-store').json(body);
    },
  );

  return router;
}
