import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { seatCount } from '@eas/allocation';
import { createApp } from './app.js';

describe('GET /health', () => {
  it('responds with status ok', async () => {
    const res = await request(createApp()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', service: 'Exam Automation System' });
  });

  it('can import @eas/allocation through the workspace', () => {
    expect(seatCount(2, 3)).toBe(6);
  });
});
