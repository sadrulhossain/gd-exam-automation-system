import { Router } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { seatCount } from '@eas/allocation';
import {
  ApiErrorSchema,
  CreateFacultySchema,
  ERROR_CODES,
  PaginationQuerySchema,
} from '@eas/shared';
import { z } from 'zod';
import { conflict } from '../lib/errors.js';
import { validate, validated } from '../middleware/index.js';
import { buildTestApp, capturingLogger, fakeDb, productionConfig, testConfig } from './helpers.js';

const SECRET_MESSAGE = 'connection string mongodb://admin:hunter2@db leaked';

const listSchemas = { query: PaginationQuerySchema };
const createSchemas = { body: CreateFacultySchema };
const paramSchemas = { params: z.object({ id: z.string().regex(/^[a-f\d]{24}$/) }) };

/** Routes that exercise error paths and middleware; mounted under /api/v1/probe. */
function probeRouter(): Router {
  const router = Router();
  router.get('/boom', () => {
    throw new Error(SECRET_MESSAGE);
  });
  router.get('/async-boom', async () => {
    await Promise.resolve();
    throw new Error(SECRET_MESSAGE);
  });
  router.get('/conflict', () => {
    throw conflict('Already exists', { field: 'code' });
  });
  router.get('/duplicate', () => {
    throw Object.assign(new Error('E11000 dup key: { email: "a@b.c" }'), {
      code: 11000,
      keyPattern: { email: 1 },
    });
  });
  router.get('/list', validate(listSchemas), (req, res) => {
    res.json(validated<typeof listSchemas>(req).query);
  });
  router.post('/faculties', validate(createSchemas), (req, res) => {
    res.status(201).json(validated<typeof createSchemas>(req).body);
  });
  router.get('/items/:id', validate(paramSchemas), (req, res) => {
    res.json(validated<typeof paramSchemas>(req).params);
  });
  const outer = Router();
  outer.use('/probe', router);
  return outer;
}

const app = buildTestApp({ extraRouters: [probeRouter()] });

describe('workspace', () => {
  it('can import @eas/allocation through the workspace', () => {
    expect(seatCount(2, 3)).toBe(6);
  });
});

describe('health endpoints', () => {
  it('GET /health is a DB-independent liveness probe', async () => {
    const res = await request(buildTestApp({ db: fakeDb('disconnected') })).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', service: 'Exam Automation System' });
  });

  it('GET /api/v1/health reports the database state', async () => {
    const up = await request(buildTestApp({ db: fakeDb('connected') })).get('/api/v1/health');
    expect(up.status).toBe(200);
    expect(up.body).toEqual({
      status: 'ok',
      service: 'Exam Automation System',
      db: { state: 'connected' },
    });

    const down = await request(buildTestApp({ db: fakeDb('disconnected') })).get('/api/v1/health');
    expect(down.status).toBe(200);
    expect(down.body).toMatchObject({ status: 'degraded', db: { state: 'disconnected' } });
  });

  it('GET /api/v1/ready is 200 when the database answers', async () => {
    const res = await request(buildTestApp({ db: fakeDb('connected') })).get('/api/v1/ready');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ready' });
  });

  it('GET /api/v1/ready is 503 in the shared error shape when it does not', async () => {
    const res = await request(buildTestApp({ db: fakeDb('connecting') })).get('/api/v1/ready');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      error: { code: ERROR_CODES.SERVICE_UNAVAILABLE, message: 'Database is not ready' },
    });
  });
});

describe('request id', () => {
  it('generates one when the caller sends none', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('echoes a safe caller-supplied id', async () => {
    const res = await request(app).get('/health').set('X-Request-Id', 'client-req-12345');
    expect(res.headers['x-request-id']).toBe('client-req-12345');
  });

  it('replaces an unsafe or too-short id', async () => {
    for (const bad of ['short', 'has spaces and <script>', 'x'.repeat(200)]) {
      const res = await request(app).get('/health').set('X-Request-Id', bad);
      expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    }
  });
});

describe('logging', () => {
  it('logs each request with its request id and redacts credentials', async () => {
    const { logger, lines } = capturingLogger();
    const res = await request(buildTestApp({ logger }))
      .get('/api/v1/health')
      .set('Authorization', 'Bearer super-secret-token')
      .set('Cookie', 'session=super-secret-cookie');
    const id = res.headers['x-request-id'];

    const logged = lines();
    expect(logged.some((line) => (line['req'] as { id?: string } | undefined)?.id === id)).toBe(
      true,
    );
    const text = JSON.stringify(logged);
    expect(text).not.toContain('super-secret-token');
    expect(text).not.toContain('super-secret-cookie');
  });

  it('keeps the liveness probe out of the log', async () => {
    const { logger, lines } = capturingLogger();
    await request(buildTestApp({ logger })).get('/health');
    expect(lines()).toHaveLength(0);
  });
});

describe('security middleware', () => {
  it('sets helmet headers and hides x-powered-by', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toBeDefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('allows a listed CORS origin and exposes the request id header', async () => {
    const res = await request(app).get('/api/v1/health').set('Origin', 'http://localhost:5173');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
    expect(res.headers['access-control-expose-headers']).toContain('X-Request-Id');
  });

  it('does not grant CORS to an unlisted origin', async () => {
    const res = await request(app).get('/api/v1/health').set('Origin', 'https://evil.example.com');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('answers preflight for a listed origin only', async () => {
    const ok = await request(app)
      .options('/api/v1/probe/faculties')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'POST');
    expect(ok.status).toBe(204);
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:5173');

    const denied = await request(app)
      .options('/api/v1/probe/faculties')
      .set('Origin', 'https://evil.example.com')
      .set('Access-Control-Request-Method', 'POST');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rate limits the API with the shared error shape, but not the liveness probe', async () => {
    const limited = buildTestApp({
      config: testConfig({ rateLimit: { windowMs: 60_000, max: 2 } }),
    });
    expect((await request(limited).get('/api/v1/health')).status).toBe(200);
    expect((await request(limited).get('/api/v1/health')).status).toBe(200);
    const res = await request(limited).get('/api/v1/health');
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe(ERROR_CODES.RATE_LIMITED);
    expect(res.headers['ratelimit']).toBeDefined();

    expect((await request(limited).get('/health')).status).toBe(200);
  });
});

describe('body handling', () => {
  it('rejects malformed JSON with 400 BAD_REQUEST', async () => {
    const res = await request(app)
      .post('/api/v1/probe/faculties')
      .set('Content-Type', 'application/json')
      .send('{"name": ');
    expect(res.status).toBe(400);
    expect(ApiErrorSchema.parse(res.body).error.code).toBe(ERROR_CODES.BAD_REQUEST);
  });

  it('rejects a body over the limit with 413', async () => {
    const res = await request(app)
      .post('/api/v1/probe/faculties')
      .send({ name: 'x'.repeat(200_000), code: 'A' });
    expect(res.status).toBe(413);
    expect(ApiErrorSchema.parse(res.body).error.code).toBe(ERROR_CODES.BAD_REQUEST);
  });
});

describe('validate middleware', () => {
  it('hands parsed, coerced query values to the handler (defaults applied)', async () => {
    const res = await request(app).get('/api/v1/probe/list?page=3');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ page: 3, limit: 20 });
  });

  it('rejects invalid query with VALIDATION_ERROR and field details', async () => {
    const res = await request(app).get('/api/v1/probe/list?page=0&limit=1000');
    expect(res.status).toBe(400);
    const { error } = ApiErrorSchema.parse(res.body);
    expect(error.code).toBe(ERROR_CODES.VALIDATION_ERROR);
    expect(error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ location: 'query', path: 'page' }),
        expect.objectContaining({ location: 'query', path: 'limit' }),
      ]),
    );
  });

  it('validates the body against a shared schema', async () => {
    const ok = await request(app)
      .post('/api/v1/probe/faculties')
      .send({ name: ' Science ', code: 'SCI' });
    expect(ok.status).toBe(201);
    expect(ok.body).toEqual({ name: 'Science', code: 'SCI' });

    const bad = await request(app).post('/api/v1/probe/faculties').send({ name: '' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe(ERROR_CODES.VALIDATION_ERROR);
    expect(bad.body.error.details.map((d: { path: string }) => d.path).sort()).toEqual([
      'code',
      'name',
    ]);
  });

  it('validates route params', async () => {
    const id = 'a'.repeat(24);
    expect((await request(app).get(`/api/v1/probe/items/${id}`)).body).toEqual({ id });
    const bad = await request(app).get('/api/v1/probe/items/not-an-id');
    expect(bad.status).toBe(400);
    expect(bad.body.error.details[0]).toMatchObject({ location: 'params', path: 'id' });
  });
});

describe('error handling', () => {
  it('returns 404 NOT_FOUND in the shared shape for unknown routes', async () => {
    for (const path of ['/nope', '/api/v1/nope']) {
      const res = await request(app).get(path);
      expect(res.status).toBe(404);
      expect(ApiErrorSchema.parse(res.body).error.code).toBe(ERROR_CODES.NOT_FOUND);
      expect(res.body.error.message).toContain(`GET ${path}`);
    }
  });

  it('maps AppError to its status, message and details', async () => {
    const res = await request(app).get('/api/v1/probe/conflict');
    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      error: { code: 'CONFLICT', message: 'Already exists', details: { field: 'code' } },
    });
  });

  it('maps a Mongo duplicate-key error to 409 without leaking the values', async () => {
    const res = await request(app).get('/api/v1/probe/duplicate');
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({
      code: ERROR_CODES.DUPLICATE_KEY,
      details: { fields: ['email'] },
    });
    expect(JSON.stringify(res.body)).not.toContain('a@b.c');
  });

  it.each(['/api/v1/probe/boom', '/api/v1/probe/async-boom'])(
    'hides internals of an unexpected error in production (%s)',
    async (path) => {
      const { logger, lines } = capturingLogger();
      const prod = buildTestApp({
        config: productionConfig(),
        logger,
        extraRouters: [probeRouter()],
      });
      const res = await request(prod).get(path);

      expect(res.status).toBe(500);
      expect(res.body).toEqual({
        error: { code: ERROR_CODES.INTERNAL_ERROR, message: 'Internal server error' },
      });
      const text = res.text;
      expect(text).not.toContain('hunter2');
      expect(text).not.toContain('stack');
      expect(text).not.toMatch(/\bat\s.+\(.+:\d+:\d+\)/);

      // The detail is still available to operators in the log.
      expect(JSON.stringify(lines())).toContain('hunter2');
    },
  );

  it('also hides internals under NODE_ENV=test', async () => {
    const res = await request(app).get('/api/v1/probe/boom');
    expect(res.status).toBe(500);
    expect(res.body.error.details).toBeUndefined();
    expect(res.text).not.toContain('hunter2');
  });

  it('includes the message and stack only in development', async () => {
    const dev = buildTestApp({
      config: testConfig({ nodeEnv: 'development' }),
      extraRouters: [probeRouter()],
    });
    const res = await request(dev).get('/api/v1/probe/boom');
    expect(res.status).toBe(500);
    expect(res.body.error.details.message).toBe(SECRET_MESSAGE);
    expect(res.body.error.details.stack).toContain('Error');
  });
});

describe('API docs', () => {
  it('serves the OpenAPI document and UI outside production', async () => {
    const json = await request(app).get('/api/v1/docs.json');
    expect(json.status).toBe(200);
    expect(json.body.openapi).toBe('3.1.0');
    expect(Object.keys(json.body.paths)).toEqual(
      expect.arrayContaining(['/api/v1/health', '/api/v1/ready']),
    );

    const ui = await request(app).get('/api/v1/docs/');
    expect(ui.status).toBe(200);
    expect(ui.headers['content-type']).toContain('text/html');
  });

  it('documents the superadmin endpoints', async () => {
    const json = await request(app).get('/api/v1/docs.json');
    expect(Object.keys(json.body.paths)).toEqual(
      expect.arrayContaining([
        '/api/v1/faculties',
        '/api/v1/faculties/{id}/restore',
        '/api/v1/departments/{id}',
        '/api/v1/users/department-admins',
        '/api/v1/users/{id}/reset-password',
        '/api/v1/roles/{role}/permissions',
        '/api/v1/audit-logs',
      ]),
    );
  });

  it('does not mount docs in production', async () => {
    const prod = buildTestApp({ config: productionConfig() });
    for (const path of ['/api/v1/docs.json', '/api/v1/docs/']) {
      const res = await request(prod).get(path);
      expect(res.status, path).toBe(404);
      expect(res.body.error.code).toBe(ERROR_CODES.NOT_FOUND);
    }
  });
});
