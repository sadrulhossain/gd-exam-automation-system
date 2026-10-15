import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { conditions: ['source'] },
  ssr: { resolve: { conditions: ['source'] } },
  test: {
    name: '@eas/api',
    environment: 'node',
    globalSetup: ['./src/tests/globalSetup.ts'],
    // The first run downloads a mongod binary; later runs start it in a second or two.
    testTimeout: 20_000,
    hookTimeout: 120_000,
  },
});
