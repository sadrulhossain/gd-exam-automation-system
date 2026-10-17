import { describe, expect, it } from 'vitest';
import { parseDurationMs } from '../lib/duration.js';

describe('parseDurationMs', () => {
  it.each([
    ['30s', 30_000],
    ['15m', 900_000],
    ['12h', 43_200_000],
    ['7d', 604_800_000],
  ])('parses %s', (input, ms) => {
    expect(parseDurationMs(input)).toBe(ms);
  });

  it.each(['', '15', 'm', '1w', '1.5h', '-1m'])('rejects %j', (input) => {
    expect(() => parseDurationMs(input)).toThrow(/Invalid duration/);
  });
});
