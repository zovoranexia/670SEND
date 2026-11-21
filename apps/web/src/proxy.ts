import { NextRequest } from 'next/server';
import createMiddleware from 'next-intl/middleware';
import { LOCALE_COOKIE_NAME } from '@670send/types';
import { routing } from './i18n/routing';

const intl = createMiddleware(routing);

/**
 * Locale routing (Next.js 16 "proxy"). Without a language cookie the Accept-Language header is dropped
 * before next-intl sees it, so a first-time visitor always gets Tetun; with a cookie the chosen language wins.
 */
export default function proxy(request: NextRequest) {
  if (!request.cookies.has(LOCALE_COOKIE_NAME)) {
    const headers = new Headers(request.headers);
    headers.delete('accept-language');
    return intl(new NextRequest(request, { headers }));
  }
  return intl(request);
}

export const config = {
  // Everything except API routes, Next internals and files with an extension (icons, sitemap, robots, images).
  matcher: '/((?!api|_next|_vercel|.*\\..*).*)',
};
