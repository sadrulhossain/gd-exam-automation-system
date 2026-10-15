import { z } from 'zod';

export const NODE_ENVS = ['development', 'test', 'production'] as const;
export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

const MIN_SECRET_LENGTH = 32;
const PLACEHOLDER_PREFIX = 'change-me';

const secret = z
  .string()
  .min(MIN_SECRET_LENGTH, `must be at least ${MIN_SECRET_LENGTH} characters`);

function isOrigin(value: string): boolean {
  try {
    return new URL(value).origin === value;
  } catch {
    return false;
  }
}

/** CORS_ORIGIN is a comma-separated list of explicit origins; wildcards are not allowed. */
const corsOrigins = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
  )
  .pipe(
    z
      .array(
        z.string().refine(isOrigin, {
          message: 'must be an origin like https://app.example.com (no path or trailing slash)',
        }),
      )
      .min(1, 'must list at least one origin'),
  );

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(NODE_ENVS).default('development'),
    PORT: z.coerce.number().int().min(0).max(65535).default(3000),
    MONGODB_URI: z
      .string()
      .regex(/^mongodb(\+srv)?:\/\//, 'must start with mongodb:// or mongodb+srv://'),
    JWT_ACCESS_SECRET: secret,
    JWT_REFRESH_SECRET: secret,
    JWT_ACCESS_TTL: z.string().min(1).default('15m'),
    JWT_REFRESH_TTL: z.string().min(1).default('7d'),
    CORS_ORIGIN: corsOrigins.optional(),
    LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
    /** Number of reverse proxies in front of the API (Caddy in production = 1). */
    TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(0),
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(60_000),
    RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(300),
  })
  .superRefine((env, ctx) => {
    if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_REFRESH_SECRET'],
        message: 'must differ from JWT_ACCESS_SECRET',
      });
    }
    if (env.NODE_ENV !== 'production') return;
    if (env.CORS_ORIGIN === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['CORS_ORIGIN'],
        message: 'is required in production',
      });
    }
    for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'] as const) {
      if (env[key].toLowerCase().startsWith(PLACEHOLDER_PREFIX)) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: 'is still a placeholder value; set a real secret in production',
        });
      }
    }
  });

export const DEV_CORS_ORIGINS: readonly string[] = ['http://localhost:5173'];

export interface Config {
  nodeEnv: (typeof NODE_ENVS)[number];
  isProduction: boolean;
  port: number;
  mongodbUri: string;
  jwt: {
    accessSecret: string;
    refreshSecret: string;
    accessTtl: string;
    refreshTtl: string;
  };
  corsOrigins: readonly string[];
  logLevel: (typeof LOG_LEVELS)[number];
  trustProxy: number;
  rateLimit: { windowMs: number; max: number };
}

/** Thrown when the environment is invalid. `message` lists every problem, one per line. */
export class ConfigError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(
      `Invalid environment configuration:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`,
    );
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

/**
 * Validates the environment and returns typed config. Pure: reads only `source`, so
 * tests can pass their own object. Secrets are never echoed in error messages.
 */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    throw new ConfigError(
      result.error.issues.map((issue) => {
        const name = issue.path.length > 0 ? issue.path.join('.') : 'environment';
        return `${name}: ${issue.message}`;
      }),
    );
  }
  const env = result.data;
  return {
    nodeEnv: env.NODE_ENV,
    isProduction: env.NODE_ENV === 'production',
    port: env.PORT,
    mongodbUri: env.MONGODB_URI,
    jwt: {
      accessSecret: env.JWT_ACCESS_SECRET,
      refreshSecret: env.JWT_REFRESH_SECRET,
      accessTtl: env.JWT_ACCESS_TTL,
      refreshTtl: env.JWT_REFRESH_TTL,
    },
    corsOrigins: env.CORS_ORIGIN ?? DEV_CORS_ORIGINS,
    logLevel: env.LOG_LEVEL,
    trustProxy: env.TRUST_PROXY,
    rateLimit: { windowMs: env.RATE_LIMIT_WINDOW_MS, max: env.RATE_LIMIT_MAX },
  };
}
