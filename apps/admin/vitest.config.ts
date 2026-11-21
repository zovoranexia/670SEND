import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/storage.ts', './src/test/setup.ts'],
    css: false,
    restoreMocks: true,
    testTimeout: 40_000,
    // Each jsdom worker costs a few hundred MB and this suite runs next to Postgres, Redis and the API tests.
    poolOptions: { forks: { maxForks: 2 } },
  },
});
