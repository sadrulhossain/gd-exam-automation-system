import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const apiTarget = process.env['API_PROXY_TARGET'] ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { conditions: ['source'] },
  server: {
    port: 5173,
    // File events from bind mounts are unreliable on Docker Desktop; compose enables polling.
    watch: { usePolling: process.env['VITE_USE_POLLING'] === 'true' },
    proxy: { '/api': { target: apiTarget, changeOrigin: true } },
  },
  test: {
    name: '@eas/web',
    environment: 'node',
  },
});
