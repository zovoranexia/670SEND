import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      'virtual:pwa-register': fileURLToPath(new URL('./src/test/pwa-stub.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/storage.ts', './src/test/setup.ts'],
    css: false,
    restoreMocks: true,
    testTimeout: 20_000,
    // Each jsdom worker costs a few hundred MB; two keep the suite fast without exhausting a developer laptop that
    // is also running Postgres, Redis and the API tests (a parallel `turbo run test` once ran a worker out of memory).
    poolOptions: { forks: { maxForks: 2 } },
  },
});
