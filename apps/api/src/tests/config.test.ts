import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { ConfigError, DEV_CORS_ORIGINS, loadConfig } from '../config/index.js';

const SECRET_A = 'a'.repeat(40);
const SECRET_B = 'b'.repeat(40);

const validEnv = {
  MONGODB_URI: 'mongodb://localhost:27017/exam_automation',
  JWT_ACCESS_SECRET: SECRET_A,
  JWT_REFRESH_SECRET: SECRET_B,
};

function issuesFor(env: NodeJS.ProcessEnv): readonly string[] {
  try {
    loadConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) return error.issues;
    throw error;
  }
  throw new Error('Expected loadConfig to throw');
}

describe('loadConfig', () => {
  it('applies defaults for a minimal valid environment', () => {
    const config = loadConfig(validEnv);
    expect(config).toMatchObject({
      nodeEnv: 'development',
      isProduction: false,
      port: 3000,
      logLevel: 'info',
      trustProxy: 0,
      corsOrigins: DEV_CORS_ORIGINS,
      rateLimit: { windowMs: 60_000, max: 300 },
      jwt: { accessSecret: SECRET_A, refreshSecret: SECRET_B, accessTtl: '15m', refreshTtl: '7d' },
    });
  });

  it('applies auth defaults: 20 requests per 15 minutes, lock after 5 failures', () => {
    expect(loadConfig(validEnv).auth).toEqual({
      rateLimit: { windowMs: 900_000, max: 20 },
      lockout: { threshold: 5, baseMs: 60_000, maxMs: 3_600_000 },
    });
  });

  it('reads auth overrides', () => {
    const config = loadConfig({
      ...validEnv,
      AUTH_RATE_LIMIT_MAX: '5',
      AUTH_LOCKOUT_THRESHOLD: '3',
      AUTH_LOCKOUT_BASE_MS: '2000',
    });
    expect(config.auth.rateLimit.max).toBe(5);
    expect(config.auth.lockout).toMatchObject({ threshold: 3, baseMs: 2000 });
  });

  it.each(['15', 'fifteen', '15 m', '1w', '-5m'])('rejects the token TTL %j', (ttl) => {
    expect(issuesFor({ ...validEnv, JWT_ACCESS_TTL: ttl })).toEqual([
      expect.stringContaining('JWT_ACCESS_TTL'),
    ]);
    expect(issuesFor({ ...validEnv, JWT_REFRESH_TTL: ttl })).toEqual([
      expect.stringContaining('JWT_REFRESH_TTL'),
    ]);
  });

  it('coerces numbers and parses the CORS origin list', () => {
    const config = loadConfig({
      ...validEnv,
      PORT: '8080',
      TRUST_PROXY: '1',
      CORS_ORIGIN: 'https://a.example.com, https://b.example.com:8443 ',
    });
    expect(config.port).toBe(8080);
    expect(config.trustProxy).toBe(1);
    expect(config.corsOrigins).toEqual(['https://a.example.com', 'https://b.example.com:8443']);
  });

  it('names every missing or invalid variable in one error', () => {
    const issues = issuesFor({ PORT: 'abc', LOG_LEVEL: 'loud', NODE_ENV: 'staging' });
    const text = issues.join('\n');
    for (const name of [
      'MONGODB_URI',
      'JWT_ACCESS_SECRET',
      'JWT_REFRESH_SECRET',
      'PORT',
      'LOG_LEVEL',
      'NODE_ENV',
    ]) {
      expect(text).toContain(name);
    }
  });

  it('formats the error message as a readable list', () => {
    expect(() => loadConfig({})).toThrow(/Invalid environment configuration:\n {2}- MONGODB_URI/);
  });

  it('rejects a non-mongodb URI', () => {
    expect(issuesFor({ ...validEnv, MONGODB_URI: 'postgres://x' }).join()).toContain('MONGODB_URI');
  });

  it('rejects short JWT secrets without echoing them', () => {
    const issues = issuesFor({ ...validEnv, JWT_ACCESS_SECRET: 'too-short-secret' });
    expect(issues.join()).toContain('JWT_ACCESS_SECRET');
    expect(issues.join()).not.toContain('too-short-secret');
  });

  it('rejects identical access and refresh secrets', () => {
    expect(issuesFor({ ...validEnv, JWT_REFRESH_SECRET: SECRET_A }).join()).toContain(
      'JWT_REFRESH_SECRET: must differ',
    );
  });

  it.each(['*', 'https://app.example.com/', 'https://app.example.com/path', 'not a url'])(
    'rejects CORS_ORIGIN value %j',
    (origin) => {
      expect(issuesFor({ ...validEnv, CORS_ORIGIN: origin }).join()).toContain('CORS_ORIGIN');
    },
  );

  it('rejects an empty CORS_ORIGIN list', () => {
    expect(issuesFor({ ...validEnv, CORS_ORIGIN: ' , ' }).join()).toContain('CORS_ORIGIN');
  });

  describe('in production', () => {
    const prod = { ...validEnv, NODE_ENV: 'production', CORS_ORIGIN: 'https://exam.example.com' };

    it('accepts a complete configuration', () => {
      const config = loadConfig(prod);
      expect(config.isProduction).toBe(true);
      expect(config.corsOrigins).toEqual(['https://exam.example.com']);
    });

    it('requires CORS_ORIGIN', () => {
      expect(issuesFor({ ...prod, CORS_ORIGIN: undefined }).join()).toContain(
        'CORS_ORIGIN: is required in production',
      );
    });

    it('rejects placeholder secrets from .env.example', () => {
      const placeholder = 'change-me-'.padEnd(40, 'x');
      const text = issuesFor({ ...prod, JWT_ACCESS_SECRET: placeholder }).join();
      expect(text).toContain('JWT_ACCESS_SECRET');
      expect(text).toContain('placeholder');
    });
  });
});

describe('startup with an invalid environment', () => {
  it('exits with code 1 and a clear message, without connecting to anything', () => {
    const result = spawnSync(
      process.execPath,
      ['--conditions=source', '--import', 'tsx', 'src/index.ts'],
      {
        cwd: new URL('../..', import.meta.url),
        // Only PATH is passed on purpose: no MONGODB_URI, no secrets.
        env: { PATH: process.env['PATH'] ?? '' },
        encoding: 'utf8',
        timeout: 30_000,
      },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Invalid environment configuration');
    expect(result.stderr).toContain('MONGODB_URI');
    expect(result.stderr).toContain('JWT_ACCESS_SECRET');
  });
});
