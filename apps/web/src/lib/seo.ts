import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { LOCALES, type Locale } from '@670send/types';
import { WEB_URL } from './config';

export type PageKey = 'home' | 'calculator' | 'track' | 'book' | 'prohibited' | 'terms';

export const PAGE_PATHS: Record<PageKey, string> = { home: '', calculator: '/calculator', track: '/track', book: '/book', prohibited: '/prohibited', terms: '/terms' };

/** Absolute URL of a page in a given language ("/tet", "/pt/track", …). */
export const pageUrl = (locale: Locale, page: PageKey) => `${WEB_URL}/${locale}${PAGE_PATHS[page]}`;

/** hreflang map: every language + x-default (Tetun). */
export function languageAlternates(page: PageKey): Record<string, string> {
  return { ...Object.fromEntries(LOCALES.map((l) => [l, pageUrl(l, page)])), 'x-default': pageUrl('tet', page) };
}

const OG_LOCALE: Record<Locale, string> = { tet: 'tet_TL', pt: 'pt_TL', en: 'en_US', id: 'id_ID' };

/** Title / description / canonical / hreflang / social card for a page, in the visitor's language. */
export async function pageMetadata(locale: Locale, page: PageKey, opts: { index?: boolean } = {}): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'web.meta' });
  const title = t(`${page}.title`);
  const description = t(`${page}.description`);
  return {
    title: page === 'home' ? { absolute: title } : title,
    description,
    alternates: { canonical: pageUrl(locale, page), languages: languageAlternates(page) },
    openGraph: {
      type: 'website',
      siteName: '670Send',
      title,
      description,
      url: pageUrl(locale, page),
      locale: OG_LOCALE[locale],
      alternateLocale: LOCALES.filter((l) => l !== locale).map((l) => OG_LOCALE[l]),
    },
    twitter: { card: 'summary', title, description },
    robots: opts.index === false ? { index: false, follow: true } : undefined,
  };
}
