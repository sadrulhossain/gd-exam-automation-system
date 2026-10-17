import { randomBytes } from 'node:crypto';
import { argon2id, hash, verify } from 'argon2';

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(passwordHash: string, password: string): Promise<boolean>;
  /**
   * Spends the same time as a real verification and always returns false. Called for
   * unknown emails so response time does not reveal which accounts exist.
   */
  verifyAgainstDummy(password: string): Promise<false>;
}

export interface Argon2Cost {
  memoryCost: number;
  timeCost: number;
  parallelism: number;
}

/** OWASP-recommended argon2id minimum (19 MiB, 2 iterations, 1 lane). */
export const PRODUCTION_ARGON2_COST: Argon2Cost = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

/** Deliberately weak, for the test suite only. */
export const TEST_ARGON2_COST: Argon2Cost = { memoryCost: 1_024, timeCost: 1, parallelism: 1 };

export function createPasswordHasher(cost: Argon2Cost = PRODUCTION_ARGON2_COST): PasswordHasher {
  // The library types `argon2id` as a plain number but its options accept only 0 | 1 | 2.
  const options = { type: argon2id as 2, ...cost };
  let dummyHash: Promise<string> | undefined;

  return {
    hash: (password) => hash(password, options),
    async verify(passwordHash, password) {
      try {
        return await verify(passwordHash, password);
      } catch {
        // A malformed stored hash must fail the login, not crash the request.
        return false;
      }
    },
    async verifyAgainstDummy(password) {
      dummyHash ??= hash(randomBytes(16).toString('hex'), options);
      await verify(await dummyHash, password);
      return false;
    },
  };
}
