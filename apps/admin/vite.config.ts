import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { host: true, port: 3102, strictPort: true },
  preview: { host: true, port: 3102, strictPort: true },
  build: {
    target: 'es2022',
    sourcemap: false,
    rollupOptions: {
      output: {
        // Libraries change rarely: separate long-lived chunks mean a release re-downloads only the app code.
        manualChunks: {
          react: ['react', 'react-dom', 'react-router'],
          i18n: ['use-intl', '@670send/i18n'],
          validation: ['zod', '@670send/validation', '@670send/types'],
        },
      },
    },
  },
});
