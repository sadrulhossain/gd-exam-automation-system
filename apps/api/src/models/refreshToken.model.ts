import { model, Schema, type Model, type Types } from 'mongoose';

export interface RefreshTokenDoc {
  /** HMAC-SHA256 of the opaque token; the token itself is never stored. */
  tokenHash: string;
  /** All tokens descended from one login share a family, so reuse can revoke them together. */
  familyId: string;
  userId: Types.ObjectId;
  tokenVersion: number;
  expiresAt: Date;
  /** Set when the token was exchanged for a new one. Presenting it again is reuse. */
  usedAt: Date | null;
  /** Set on logout or when the family is revoked. */
  revokedAt: Date | null;
  createdAt: Date;
}

const refreshTokenSchema = new Schema<RefreshTokenDoc>(
  {
    tokenHash: { type: String, required: true, unique: true },
    familyId: { type: String, required: true, index: true },
    userId: { type: Schema.Types.ObjectId, required: true, index: true },
    tokenVersion: { type: Number, required: true },
    // TTL index: MongoDB removes the document once it has expired.
    expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
    usedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export const RefreshTokenModel: Model<RefreshTokenDoc> = model<RefreshTokenDoc>(
  'RefreshToken',
  refreshTokenSchema,
);
