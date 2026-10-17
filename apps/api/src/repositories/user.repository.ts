import { Types } from 'mongoose';
import { UserModel, type UserDoc } from '../models/index.js';
import { ScopedRepository, type Lean } from './base.repository.js';
import type { RepoScope } from './scope.js';

export type UserRecord = Lean<UserDoc>;
/** A user including the password hash; only the auth service ever asks for this. */
export type UserWithSecret = UserRecord;

/** Fields needed to create a user; the department crosses the boundary as an id string. */
export interface NewUser {
  email: string;
  name: string;
  role: UserDoc['role'];
  departmentId: string | null;
  passwordHash: string;
  isActive?: boolean;
  mustChangePassword?: boolean;
}

export interface LockoutPolicy {
  threshold: number;
  baseMs: number;
  maxMs: number;
}

/**
 * Users, scoped like every other collection: dept_admin and teacher see their own
 * department, students see only themselves, authority is read-only. The credential
 * methods below are for the system scope (no signed-in actor yet) and refuse anything else.
 */
export class UserRepository extends ScopedRepository<UserDoc> {
  constructor(scope: RepoScope) {
    super(UserModel, scope, { departmentField: 'departmentId', studentOwnerField: '_id' });
  }

  private requireSystem(): void {
    if (this.scope.kind !== 'system') {
      throw new Error('Credential operations require the system scope');
    }
  }

  async findForLogin(email: string): Promise<UserWithSecret | null> {
    this.requireSystem();
    return (await UserModel.findOne({ email: email.toLowerCase() })
      .select('+passwordHash')
      .lean()
      .exec()) as UserWithSecret | null;
  }

  async findForPasswordChange(id: string | Types.ObjectId): Promise<UserWithSecret | null> {
    this.requireSystem();
    return (await UserModel.findById(id)
      .select('+passwordHash')
      .lean()
      .exec()) as UserWithSecret | null;
  }

  /**
   * Counts a failed login and, once the threshold is reached, locks the account. The lock
   * doubles with every further failure (base, 2x base, 4x base ...) up to `maxMs`.
   */
  async recordFailedLogin(
    id: string | Types.ObjectId,
    policy: LockoutPolicy,
    now: Date,
  ): Promise<void> {
    this.requireSystem();
    const updated = await UserModel.findByIdAndUpdate(
      id,
      { $inc: { failedLoginAttempts: 1 } },
      { returnDocument: 'after' },
    ).exec();
    if (updated === null || updated.failedLoginAttempts < policy.threshold) return;
    const extra = Math.min(updated.failedLoginAttempts - policy.threshold, 30);
    const lockMs = Math.min(policy.baseMs * 2 ** extra, policy.maxMs);
    await UserModel.updateOne(
      { _id: id },
      { $set: { lockedUntil: new Date(now.getTime() + lockMs) } },
    ).exec();
  }

  async recordSuccessfulLogin(id: string | Types.ObjectId, now: Date): Promise<void> {
    this.requireSystem();
    await UserModel.updateOne(
      { _id: id },
      { $set: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: now } },
    ).exec();
  }

  /**
   * Stores a new password hash and bumps `tokenVersion`, which invalidates every access
   * token and refresh token issued before. Returns the new version.
   */
  async setPassword(
    id: string | Types.ObjectId,
    passwordHash: string,
    options: { mustChangePassword: boolean },
  ): Promise<number | null> {
    this.requireSystem();
    const updated = await UserModel.findByIdAndUpdate(
      id,
      {
        $set: {
          passwordHash,
          mustChangePassword: options.mustChangePassword,
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
        $inc: { tokenVersion: 1 },
      },
      { returnDocument: 'after' },
    ).exec();
    return updated === null ? null : updated.tokenVersion;
  }

  /** Creates a user from a ready password hash (seeding, and later the user-management API). */
  async createWithHash(data: NewUser): Promise<UserRecord> {
    const { departmentId, ...rest } = data;
    return this.create({
      ...rest,
      departmentId: departmentId === null ? null : new Types.ObjectId(departmentId),
    });
  }
}
