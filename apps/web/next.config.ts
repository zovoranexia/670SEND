import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');
const here = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.env.NODE_ENV !== 'production';

const origin = (value: string | undefined, fallback: string) => {
  try {
    return new URL(value ?? fallback).origin;
  } catch {
    return new URL(fallback).origin;
  }
};
const API_ORIGIN = origin(process.env.NEXT_PUBLIC_API_URL, 'http://localhost:4010');
// Map tiles: OpenStreetMap by default. Swap for your own tile server (see apps/web/README.md) via env.
const TILE_ORIGIN = origin((process.env.NEXT_PUBLIC_MAP_TILE_URL ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png').replace(/\{[^}]+\}/g, 'x'), 'https://tile.openstreetmap.org');

/**
 * Content-Security-Policy. Next.js injects small inline scripts for hydration, so `script-src` keeps
 * 'unsafe-inline' (a per-request nonce would force every page to render dynamically and lose CDN caching).
 * Everything else is locked to this site, the API origin and the tile server.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${TILE_ORIGIN}`,
  "font-src 'self'",
  `connect-src 'self' ${API_ORIGIN}${isDev ? ' ws: wss:' : ''}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(isDev ? [] : ['upgrade-insecure-requests']),
].join('; ');

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.join(here, '../../'),
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ['@670send/i18n', '@670send/types', '@670send/validation'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), payment=(), geolocation=(self)' },
          ...(isDev ? [] : [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' }]),
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
