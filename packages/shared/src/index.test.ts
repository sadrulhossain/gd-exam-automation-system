import { describe, expect, it } from 'vitest';
import { appName } from './index.js';

describe('@eas/shared', () => {
  it('returns the application name', () => {
    expect(appName()).toBe('Exam Automation System');
  });
});
