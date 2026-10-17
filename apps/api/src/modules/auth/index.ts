import type { Config } from '../../config/index.js';
import type { Logger } from '../../lib/logger.js';
import { createAuthMiddleware, type AuthMiddleware } from '../../middleware/auth.js';
import { createSystemRepositories, type SystemRepositories } from '../../repositories/index.js';
import { AuthService } from './auth.service.js';
import {
  createPasswordHasher,
  PRODUCTION_ARGON2_COST,
  TEST_ARGON2_COST,
  type PasswordHasher,
} from './password.js';
import { createAccessTokenService, type AccessTokenService } from './tokens.js';

export { createAuthRouter, REFRESH_COOKIE } from './auth.routes.js';
export { AuthService, toAuthUser } from './auth.service.js';
export type { IssuedSession } from './auth.service.js';
export { createPasswordHasher, PRODUCTION_ARGON2_COST, TEST_ARGON2_COST } from './password.js';
export type { PasswordHasher } from './password.js';
export { createAccessTokenService } from './tokens.js';
export type { AccessTokenService } from './tokens.js';

export interface AuthKit {
  service: AuthService;
  middleware: AuthMiddleware;
  accessTokens: AccessTokenService;
  hasher: PasswordHasher;
  repos: SystemRepositories;
}

export interface AuthKitDeps {
  config: Pick<Config, 'nodeEnv' | 'jwt' | 'auth'>;
  logger: Logger;
  repos?: SystemRepositories;
  hasher?: PasswordHasher;
  now?: () => Date;
}

/**
 * Wires the token service, password hasher, auth service and guard middleware from one
 * config. The app builds one; tests build another from the same config to guard probe routes.
 */
export function createAuthKit({ config, logger, repos, hasher, now }: AuthKitDeps): AuthKit {
  const systemRepos = repos ?? createSystemRepositories();
  // The test suite hashes with minimal argon2 cost to stay fast; every other env uses OWASP's.
  const passwordHasher =
    hasher ??
    createPasswordHasher(config.nodeEnv === 'test' ? TEST_ARGON2_COST : PRODUCTION_ARGON2_COST);
  const accessTokens = createAccessTokenService(config);
  return {
    service: new AuthService({
      config,
      repos: systemRepos,
      hasher: passwordHasher,
      accessTokens,
      logger,
      ...(now === undefined ? {} : { now }),
    }),
    middleware: createAuthMiddleware({ accessTokens, repos: systemRepos }),
    accessTokens,
    hasher: passwordHasher,
    repos: systemRepos,
  };
}
