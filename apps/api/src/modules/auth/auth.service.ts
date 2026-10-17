import { randomUUID } from 'node:crypto';
import { ERROR_CODES, type AuthUser } from '@eas/shared';
import type { Config } from '../../config/index.js';
import { parseDurationMs } from '../../lib/duration.js';
import { AppError, forbidden, unauthenticated } from '../../lib/errors.js';
import type { Logger } from '../../lib/logger.js';
import type { SystemRepositories, UserRecord } from '../../repositories/index.js';
import type { PasswordHasher } from './password.js';
import { generateRefreshToken, hashRefreshToken, type AccessTokenService } from './tokens.js';

export interface IssuedSession {
  accessToken: string;
  accessTokenExpiresAt: Date;
  expiresInSeconds: number;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
  user: AuthUser;
}

export interface AuthServiceDeps {
  config: Pick<Config, 'jwt' | 'auth'>;
  repos: SystemRepositories;
  hasher: PasswordHasher;
  accessTokens: AccessTokenService;
  logger: Logger;
  now?: () => Date;
}

const INVALID_CREDENTIALS_MESSAGE = 'Invalid email or password';

export function toAuthUser(user: UserRecord): AuthUser {
  return {
    id: user._id.toString(),
    email: user.email,
    name: user.name,
    role: user.role,
    departmentId: user.departmentId === null ? null : user.departmentId.toString(),
    isActive: user.isActive,
    mustChangePassword: user.mustChangePassword,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

export class AuthService {
  private readonly now: () => Date;
  private readonly refreshTtlMs: number;

  constructor(private readonly deps: AuthServiceDeps) {
    this.now = deps.now ?? (() => new Date());
    this.refreshTtlMs = parseDurationMs(deps.config.jwt.refreshTtl);
  }

  async login(email: string, password: string): Promise<IssuedSession> {
    const { repos, hasher, config } = this.deps;
    const now = this.now();
    const user = await repos.users.findForLogin(email);

    if (user === null) {
      await hasher.verifyAgainstDummy(password);
      throw invalidCredentials();
    }

    if (user.lockedUntil !== null && user.lockedUntil > now) {
      const retryAfterSeconds = Math.ceil((user.lockedUntil.getTime() - now.getTime()) / 1000);
      throw new AppError(
        ERROR_CODES.RATE_LIMITED,
        'Too many failed sign-in attempts, please try again later',
        { details: { retryAfterSeconds } },
      );
    }

    if (!(await hasher.verify(user.passwordHash, password))) {
      await repos.users.recordFailedLogin(user._id, config.auth.lockout, now);
      throw invalidCredentials();
    }
    if (!user.isActive) throw forbidden('This account is disabled');

    await repos.users.recordSuccessfulLogin(user._id, now);
    return this.issueSession(user, randomUUID());
  }

  /**
   * Exchanges a refresh token for a new access token and a new refresh token (rotation).
   * Presenting a token that was already exchanged means it was stolen or replayed, so the
   * whole token family is revoked and the user must sign in again.
   */
  async refresh(rawToken: string): Promise<IssuedSession> {
    const { repos, config } = this.deps;
    const now = this.now();
    const record = await repos.refreshTokens.findByHash(
      hashRefreshToken(rawToken, config.jwt.refreshSecret),
    );

    if (record === null || record.revokedAt !== null)
      throw unauthenticated('Invalid refresh token');

    if (record.usedAt !== null) {
      return this.rejectReuse(record.familyId, record.userId.toString());
    }
    if (record.expiresAt <= now) {
      throw new AppError(ERROR_CODES.TOKEN_EXPIRED, 'Refresh token has expired');
    }
    // Atomic claim: if two requests race with one token, exactly one wins and the loser
    // is treated as reuse.
    if (!(await repos.refreshTokens.markUsed(record._id, now))) {
      return this.rejectReuse(record.familyId, record.userId.toString());
    }

    const user = await repos.users.findById(record.userId);
    if (user === null || !user.isActive || user.tokenVersion !== record.tokenVersion) {
      await repos.refreshTokens.revokeFamily(record.familyId, now);
      throw unauthenticated('Invalid refresh token');
    }
    return this.issueSession(user, record.familyId);
  }

  /** Revokes the token's whole family. Idempotent: unknown or missing tokens are ignored. */
  async logout(rawToken: string | undefined): Promise<void> {
    if (rawToken === undefined) return;
    const { repos, config } = this.deps;
    const record = await repos.refreshTokens.findByHash(
      hashRefreshToken(rawToken, config.jwt.refreshSecret),
    );
    if (record !== null) await repos.refreshTokens.revokeFamily(record.familyId, this.now());
  }

  /**
   * Changes the password, ends every other session (token version bump plus refresh-token
   * revocation) and returns a fresh session for the caller.
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<IssuedSession> {
    const { repos, hasher } = this.deps;
    const now = this.now();
    const user = await repos.users.findForPasswordChange(userId);
    if (user === null || !user.isActive) throw unauthenticated();

    if (!(await hasher.verify(user.passwordHash, currentPassword))) {
      throw new AppError(ERROR_CODES.INVALID_CREDENTIALS, 'Current password is incorrect');
    }
    const tokenVersion = await repos.users.setPassword(user._id, await hasher.hash(newPassword), {
      mustChangePassword: false,
    });
    if (tokenVersion === null) throw unauthenticated();
    await repos.refreshTokens.revokeAllForUser(user._id, now);

    const updated = await repos.users.findById(user._id);
    if (updated === null) throw unauthenticated();
    return this.issueSession(updated, randomUUID());
  }

  private async rejectReuse(familyId: string, userId: string): Promise<never> {
    await this.deps.repos.refreshTokens.revokeFamily(familyId, this.now());
    this.deps.logger.warn({ userId, familyId }, 'Refresh token reuse detected; family revoked');
    throw unauthenticated('Refresh token was already used; please sign in again');
  }

  private async issueSession(user: UserRecord, familyId: string): Promise<IssuedSession> {
    const { repos, accessTokens, config } = this.deps;
    const now = this.now();
    const access = await accessTokens.sign(
      { userId: user._id.toString(), tokenVersion: user.tokenVersion },
      now,
    );
    const refreshToken = generateRefreshToken();
    const refreshTokenExpiresAt = new Date(now.getTime() + this.refreshTtlMs);
    await repos.refreshTokens.create({
      tokenHash: hashRefreshToken(refreshToken, config.jwt.refreshSecret),
      familyId,
      userId: user._id,
      tokenVersion: user.tokenVersion,
      expiresAt: refreshTokenExpiresAt,
    });
    return {
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt,
      expiresInSeconds: access.expiresInSeconds,
      refreshToken,
      refreshTokenExpiresAt,
      user: toAuthUser(user),
    };
  }
}

function invalidCredentials(): AppError {
  return new AppError(ERROR_CODES.INVALID_CREDENTIALS, INVALID_CREDENTIALS_MESSAGE);
}
