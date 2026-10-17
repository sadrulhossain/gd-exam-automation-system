import { z } from 'zod';
import { IsoDateTimeSchema } from './common.js';
import { LoginSchema, PasswordSchema, UserSchema } from './organization.js';

/**
 * Login request. The refresh token is delivered in an httpOnly cookie by default; set
 * `refreshTokenInBody` for cross-site deployments where the cookie is not sent.
 */
export const LoginRequestSchema = LoginSchema.extend({
  refreshTokenInBody: z.boolean().default(false),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

/** Refresh and logout read the token from the cookie, or from the body when it is supplied. */
export const RefreshRequestSchema = z.object({
  refreshToken: z.string().min(1).max(512).optional(),
  refreshTokenInBody: z.boolean().default(false),
});
export type RefreshRequest = z.infer<typeof RefreshRequestSchema>;

export const LogoutRequestSchema = z.object({
  refreshToken: z.string().min(1).max(512).optional(),
});
export type LogoutRequest = z.infer<typeof LogoutRequestSchema>;

export const ChangePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(128),
    newPassword: PasswordSchema,
    refreshTokenInBody: z.boolean().default(false),
  })
  .refine((value) => value.newPassword !== value.currentPassword, {
    path: ['newPassword'],
    message: 'must differ from the current password',
  });
export type ChangePassword = z.infer<typeof ChangePasswordSchema>;

/** The signed-in user as returned by the auth endpoints. */
export const AuthUserSchema = UserSchema.safeExtend({ mustChangePassword: z.boolean() });
export type AuthUser = z.infer<typeof AuthUserSchema>;

export const AuthSessionSchema = z.object({
  accessToken: z.string(),
  tokenType: z.literal('Bearer'),
  /** Access token lifetime in seconds. */
  expiresIn: z.number().int().positive(),
  accessTokenExpiresAt: IsoDateTimeSchema,
  /** Present only when the client asked for it (`refreshTokenInBody`). */
  refreshToken: z.string().optional(),
  user: AuthUserSchema,
});
export type AuthSession = z.infer<typeof AuthSessionSchema>;

export const MeResponseSchema = z.object({ user: AuthUserSchema });
export type MeResponse = z.infer<typeof MeResponseSchema>;
