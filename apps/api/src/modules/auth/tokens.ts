import { createHmac, randomBytes } from 'node:crypto';
import { errors, jwtVerify, SignJWT } from 'jose';
import { ERROR_CODES } from '@eas/shared';
import type { Config } from '../../config/index.js';
import { AppError, unauthenticated } from '../../lib/errors.js';
import { parseDurationMs } from '../../lib/duration.js';

const ISSUER = 'eas-api';
const AUDIENCE = 'eas-client';
const ALGORITHM = 'HS256';

export interface AccessTokenClaims {
  userId: string;
  tokenVersion: number;
}

export interface IssuedAccessToken {
  token: string;
  expiresAt: Date;
  expiresInSeconds: number;
}

export interface AccessTokenService {
  sign(claims: AccessTokenClaims, now?: Date): Promise<IssuedAccessToken>;
  /** Throws TOKEN_EXPIRED for an expired token and UNAUTHENTICATED for anything else wrong. */
  verify(token: string): Promise<AccessTokenClaims>;
}

/**
 * Short-lived bearer tokens (HS256, signed with JWT_ACCESS_SECRET). Only the user id and
 * token version are trusted from the token; role and department are re-read from the
 * database on every request, so a role change or deactivation takes effect immediately.
 */
export function createAccessTokenService(config: Pick<Config, 'jwt'>): AccessTokenService {
  const secret = new TextEncoder().encode(config.jwt.accessSecret);
  const ttlMs = parseDurationMs(config.jwt.accessTtl);

  return {
    async sign({ userId, tokenVersion }, now = new Date()) {
      const issuedAt = Math.floor(now.getTime() / 1000);
      const expiresInSeconds = Math.floor(ttlMs / 1000);
      const token = await new SignJWT({ tv: tokenVersion })
        .setProtectedHeader({ alg: ALGORITHM })
        .setSubject(userId)
        .setIssuer(ISSUER)
        .setAudience(AUDIENCE)
        .setIssuedAt(issuedAt)
        .setExpirationTime(issuedAt + expiresInSeconds)
        .sign(secret);
      return {
        token,
        expiresAt: new Date((issuedAt + expiresInSeconds) * 1000),
        expiresInSeconds,
      };
    },

    async verify(token) {
      try {
        const { payload } = await jwtVerify(token, secret, {
          algorithms: [ALGORITHM],
          issuer: ISSUER,
          audience: AUDIENCE,
        });
        const tokenVersion = payload['tv'];
        if (typeof payload.sub !== 'string' || typeof tokenVersion !== 'number') {
          throw unauthenticated('Invalid access token');
        }
        return { userId: payload.sub, tokenVersion };
      } catch (error) {
        if (error instanceof AppError) throw error;
        if (error instanceof errors.JWTExpired) {
          throw new AppError(ERROR_CODES.TOKEN_EXPIRED, 'Access token has expired');
        }
        throw unauthenticated('Invalid access token');
      }
    },
  };
}

/** Refresh tokens are opaque 256-bit random values; only an HMAC of them is stored. */
export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashRefreshToken(token: string, secret: string): string {
  return createHmac('sha256', secret).update(token).digest('hex');
}
