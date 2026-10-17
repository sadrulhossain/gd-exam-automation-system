import { describe, expect, it } from 'vitest';
import {
  AuthUserSchema,
  ChangePasswordSchema,
  LoginRequestSchema,
  RefreshRequestSchema,
  ROLES,
} from './index.js';

describe('auth schemas', () => {
  it('defaults refreshTokenInBody to false and lowercases the email', () => {
    expect(LoginRequestSchema.parse({ email: 'A@B.COM', password: 'x' })).toEqual({
      email: 'a@b.com',
      password: 'x',
      refreshTokenInBody: false,
    });
  });

  it('accepts a refresh request with no fields (cookie mode)', () => {
    expect(RefreshRequestSchema.parse({})).toEqual({ refreshTokenInBody: false });
    expect(RefreshRequestSchema.safeParse({ refreshToken: '' }).success).toBe(false);
  });

  it('requires a new password that is valid and different from the current one', () => {
    const base = { currentPassword: 'old-password-1', newPassword: 'new-password-1' };
    expect(ChangePasswordSchema.safeParse(base).success).toBe(true);
    expect(ChangePasswordSchema.safeParse({ ...base, newPassword: 'short' }).success).toBe(false);
    const same = ChangePasswordSchema.safeParse({ ...base, newPassword: base.currentPassword });
    expect(same.success).toBe(false);
    expect(same.error?.issues[0]?.path).toEqual(['newPassword']);
  });

  it('keeps the role and department rule on the auth user', () => {
    const user = {
      id: 'a'.repeat(24),
      createdAt: '2030-01-01T00:00:00.000Z',
      updatedAt: '2030-01-01T00:00:00.000Z',
      email: 'a@b.com',
      name: 'A',
      role: ROLES.TEACHER,
      departmentId: null,
      isActive: true,
      mustChangePassword: false,
    };
    expect(AuthUserSchema.safeParse(user).success).toBe(false);
    expect(AuthUserSchema.safeParse({ ...user, departmentId: 'b'.repeat(24) }).success).toBe(true);
  });
});
