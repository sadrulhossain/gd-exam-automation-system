import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { conditions: ['source'] },
  server: { port: 5173 },
  test: {
    name: '@eas/web',
    environment: 'node',
  },
});
