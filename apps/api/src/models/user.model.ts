import { model, Schema, type Model, type Types } from 'mongoose';
import { DEPARTMENT_SCOPED_ROLES, ROLES, type Role } from '@eas/shared';

export interface UserDoc {
  email: string;
  name: string;
  passwordHash: string;
  role: Role;
  departmentId: Types.ObjectId | null;
  isActive: boolean;
  mustChangePassword: boolean;
  /** Bumped on password change or deactivation; access and refresh tokens carry it. */
  tokenVersion: number;
  failedLoginAttempts: number;
  lockedUntil: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<UserDoc>(
  {
    // Unique index: emails are stored lowercase (see EmailSchema), so this is case-insensitive.
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    // Never returned by default; auth code opts in with `+passwordHash`.
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, required: true, enum: Object.values(ROLES) },
    departmentId: { type: Schema.Types.ObjectId, default: null },
    isActive: { type: Boolean, required: true, default: true },
    mustChangePassword: { type: Boolean, required: true, default: false },
    tokenVersion: { type: Number, required: true, default: 0 },
    failedLoginAttempts: { type: Number, required: true, default: 0 },
    lockedUntil: { type: Date, default: null },
    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true },
);

userSchema.index({ departmentId: 1, role: 1 });

userSchema.pre('validate', function checkDepartmentMatchesRole() {
  const scoped = DEPARTMENT_SCOPED_ROLES.includes(this.role);
  if (scoped && this.departmentId === null) {
    this.invalidate('departmentId', `departmentId is required for role ${this.role}`);
  }
  if (!scoped && this.departmentId !== null) {
    this.invalidate('departmentId', `departmentId must be null for role ${this.role}`);
  }
});

export const UserModel: Model<UserDoc> = model<UserDoc>('User', userSchema);
