import { describe, expect, it, vi } from 'vitest';
import { fetchHealth } from './health';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe('fetchHealth', () => {
  it('requests /api/v1/health on the given base URL', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ status: 'ok', service: 'x' }));
    const result = await fetchHealth('http://api.test', fetchFn);
    expect(fetchFn).toHaveBeenCalledWith('http://api.test/api/v1/health');
    expect(result).toEqual({ status: 'ok', service: 'x' });
  });

  it('throws on a non-2xx response', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({}, 503));
    await expect(fetchHealth('', fetchFn)).rejects.toThrow('503');
  });
});
