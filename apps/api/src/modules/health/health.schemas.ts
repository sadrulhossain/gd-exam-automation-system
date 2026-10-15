import { z } from 'zod';

export const HealthResponseSchema = z.object({
  /** `degraded` when the API is up but MongoDB is not connected. */
  status: z.enum(['ok', 'degraded']),
  service: z.string(),
  db: z.object({ state: z.enum(['connected', 'connecting', 'disconnecting', 'disconnected']) }),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const ReadyResponseSchema = z.object({ status: z.literal('ready') });
export type ReadyResponse = z.infer<typeof ReadyResponseSchema>;
