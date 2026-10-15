import {
  extendZodWithOpenApi,
  OpenAPIRegistry,
  OpenApiGeneratorV31,
} from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { ApiErrorSchema } from '@eas/shared';
import { HealthResponseSchema, ReadyResponseSchema } from '../modules/health/health.schemas.js';

extendZodWithOpenApi(z);

/** Modules register their routes here; the document is generated from these registrations. */
export const registry = new OpenAPIRegistry();

const json = <T extends z.ZodType>(schema: T) => ({ 'application/json': { schema } });

registry.registerPath({
  method: 'get',
  path: '/api/v1/health',
  tags: ['Health'],
  summary: 'Service and database state',
  responses: { 200: { description: 'API is up', content: json(HealthResponseSchema) } },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/ready',
  tags: ['Health'],
  summary: 'Readiness: succeeds only when MongoDB answers',
  responses: {
    200: { description: 'Ready for traffic', content: json(ReadyResponseSchema) },
    503: { description: 'Database not ready', content: json(ApiErrorSchema) },
  },
});

export function buildOpenApiDocument() {
  return new OpenApiGeneratorV31(registry.definitions).generateDocument({
    openapi: '3.1.0',
    info: { title: 'Exam Automation System API', version: '0.0.0' },
    servers: [{ url: '/' }],
  });
}
