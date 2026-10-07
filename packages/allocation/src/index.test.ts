import { describe, expect, it } from 'vitest';
import { seatCount } from './index.js';

describe('@eas/allocation', () => {
  it('computes seats in a rows x columns grid', () => {
    expect(seatCount(4, 6)).toBe(24);
  });
});
