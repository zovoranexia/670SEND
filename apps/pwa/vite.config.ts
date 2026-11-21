import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // "prompt": a new version waits until the agent taps Update — never reloads in the middle of a drop-off.
      registerType: 'prompt',
      includeAssets: ['icons/*.png', 'favicon.svg'],
      manifest: {
        id: '/',
        name: '670Send Field',
        short_name: '670Send',
        description: 'Field app for 670Link agents, couriers and fleet drivers — 670Send, Timor-Leste.',
        lang: 'tet',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0B4F5C',
        theme_color: '#0B4F5C',
        categories: ['business', 'logistics'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // The shell (HTML, JS, CSS, icons) works offline. API calls are never cached: money, OTPs and stock
        // levels must always come from the server, and retries are made safe by idempotency keys instead.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
        clientsClaim: false,
        skipWaiting: false,
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { host: true, port: 3101, strictPort: true },
  preview: { host: true, port: 3101, strictPort: true },
  build: {
    target: 'es2022',
    sourcemap: false,
    rollupOptions: {
      output: {
        // Libraries change rarely: keeping them in their own chunks means an app update re-downloads only the app code.
        manualChunks: {
          react: ['react', 'react-dom', 'react-router'],
          i18n: ['use-intl', '@670send/i18n'],
          validation: ['zod', '@670send/validation', '@670send/types'],
        },
      },
    },
  },
});
