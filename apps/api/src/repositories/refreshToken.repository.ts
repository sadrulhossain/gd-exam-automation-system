import type { Types } from 'mongoose';
import { RefreshTokenModel, type RefreshTokenDoc } from '../models/index.js';
import type { Lean } from './base.repository.js';

export type RefreshTokenRecord = Lean<RefreshTokenDoc>;

export interface NewRefreshToken {
  tokenHash: string;
  familyId: string;
  userId: Types.ObjectId | string;
  tokenVersion: number;
  expiresAt: Date;
}

/** Refresh-token store. System-level: tokens are looked up by value, before any actor exists. */
export class RefreshTokenRepository {
  async create(token: NewRefreshToken): Promise<void> {
    await RefreshTokenModel.create(token);
  }

  async findByHash(tokenHash: string): Promise<RefreshTokenRecord | null> {
    return (await RefreshTokenModel.findOne({ tokenHash })
      .lean()
      .exec()) as RefreshTokenRecord | null;
  }

  /**
   * Marks a token as used, atomically. Returns false when it was already used or revoked,
   * which is how two concurrent refreshes with one token are told apart from a single one.
   */
  async markUsed(id: Types.ObjectId, now: Date): Promise<boolean> {
    const result = await RefreshTokenModel.updateOne(
      { _id: id, usedAt: null, revokedAt: null },
      { $set: { usedAt: now } },
    ).exec();
    return result.modifiedCount === 1;
  }

  async revokeFamily(familyId: string, now: Date): Promise<void> {
    await RefreshTokenModel.updateMany(
      { familyId, revokedAt: null },
      { $set: { revokedAt: now } },
    ).exec();
  }

  async revokeAllForUser(userId: Types.ObjectId | string, now: Date): Promise<void> {
    await RefreshTokenModel.updateMany(
      { userId, revokedAt: null },
      { $set: { revokedAt: now } },
    ).exec();
  }
}
