import { defineRouting } from 'next-intl/routing';
import { DEFAULT_LOCALE, LOCALES, LOCALE_COOKIE_NAME } from '@670send/types';

/**
 * Every URL carries its language (`/tet/…`, `/pt/…`, `/en/…`, `/id/…`): clean hreflang for search engines,
 * shareable links that open in the sender's language, and no cache confusion.
 * Tetun is the default and the fallback. A visitor's browser language is NOT used to guess (see proxy.ts):
 * Timorese browsers are often set to English although the person prefers Tetun. Once someone picks a
 * language the cookie remembers it.
 */
export const routing = defineRouting({
  locales: LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  localePrefix: 'always',
  localeCookie: { name: LOCALE_COOKIE_NAME, maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' },
});
