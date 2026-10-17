import type { Request, RequestHandler } from 'express';
import { ERROR_CODES, type Permission, type Role } from '@eas/shared';
import { AppError, forbidden, unauthenticated } from '../lib/errors.js';
import type { AccessTokenService } from '../modules/auth/tokens.js';
import {
  actorScope,
  createRepositories,
  type Repositories,
  type SystemRepositories,
} from '../repositories/index.js';

export interface AuthContext {
  userId: string;
  role: Role;
  departmentId: string | null;
  mustChangePassword: boolean;
}

declare module 'express-serve-static-core' {
  interface Request {
    /** The signed-in user, set by `authenticate`. */
    auth?: AuthContext;
    /** Repositories scoped to `auth`: the only way route handlers reach data. */
    repos?: Repositories;
    /** Permissions of `auth.role`, loaded once per request by the permission guards. */
    permissions?: ReadonlySet<Permission>;
  }
}

export interface AuthenticateOptions {
  /**
   * Accept users who still must change their password. Only the endpoints needed to do so
   * (`/auth/me`, `/auth/change-password`) set this; everything else is blocked until they do.
   */
  allowPasswordChangePending?: boolean;
}

export interface AuthMiddleware {
  authenticate(options?: AuthenticateOptions): RequestHandler;
  /** Passes when the user holds ALL of the permissions. */
  requirePermission(...permissions: Permission[]): RequestHandler;
  /** Passes when the user holds AT LEAST ONE of the permissions. */
  requireAnyPermission(...permissions: Permission[]): RequestHandler;
}

export interface AuthMiddlewareDeps {
  accessTokens: AccessTokenService;
  repos: SystemRepositories;
}

const BEARER_PREFIX = /^Bearer\s+(\S+)$/i;

function bearerToken(req: Request): string {
  const header = req.header('authorization');
  const match = header === undefined ? null : BEARER_PREFIX.exec(header);
  if (match?.[1] === undefined) throw unauthenticated();
  return match[1];
}

export function requireAuth(req: Request): AuthContext {
  if (req.auth === undefined) throw unauthenticated();
  return req.auth;
}

/** The request-scoped repositories. Route handlers use these and never import models. */
export function requireRepos(req: Request): Repositories {
  if (req.repos === undefined) throw unauthenticated();
  return req.repos;
}

/** Passes when the signed-in user has one of the roles. Mount it after `authenticate`. */
export function requireRole(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    const { role } = requireAuth(req);
    if (!roles.includes(role)) throw forbidden();
    next();
  };
}

export function createAuthMiddleware({ accessTokens, repos }: AuthMiddlewareDeps): AuthMiddleware {
  async function loadPermissions(req: Request): Promise<ReadonlySet<Permission>> {
    const { role } = requireAuth(req);
    req.permissions ??= new Set(await repos.rolePermissions.permissionsFor(role));
    return req.permissions;
  }

  return {
    authenticate({ allowPasswordChangePending = false } = {}) {
      return async (req, _res, next) => {
        const claims = await accessTokens.verify(bearerToken(req));
        // System scope on purpose: the actor is being established here, not yet known.
        const user = await repos.users.findById(claims.userId);
        // A bumped tokenVersion (password change) or a deactivated user ends access at once.
        if (user === null || !user.isActive || user.tokenVersion !== claims.tokenVersion) {
          throw unauthenticated('Invalid access token');
        }
        if (user.mustChangePassword && !allowPasswordChangePending) {
          throw new AppError(
            ERROR_CODES.PASSWORD_CHANGE_REQUIRED,
            'You must change your password before continuing',
          );
        }
        const auth: AuthContext = {
          userId: user._id.toString(),
          role: user.role,
          departmentId: user.departmentId === null ? null : user.departmentId.toString(),
          mustChangePassword: user.mustChangePassword,
        };
        req.auth = auth;
        req.repos = createRepositories(actorScope(auth));
        next();
      };
    },

    requirePermission(...permissions) {
      return async (req, _res, next) => {
        const granted = await loadPermissions(req);
        if (!permissions.every((permission) => granted.has(permission))) throw forbidden();
        next();
      };
    },

    requireAnyPermission(...permissions) {
      return async (req, _res, next) => {
        const granted = await loadPermissions(req);
        if (!permissions.some((permission) => granted.has(permission))) throw forbidden();
        next();
      };
    },
  };
}
