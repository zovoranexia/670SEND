import type { MetadataRoute } from 'next';
import { LOCALES } from '@670send/types';
import { languageAlternates, pageUrl, PAGE_PATHS, type PageKey } from '@/lib/seo';

export default function sitemap(): MetadataRoute.Sitemap {
  const pages = Object.keys(PAGE_PATHS) as PageKey[];
  return pages.flatMap((page) =>
    LOCALES.map((locale) => ({
      url: pageUrl(locale, page),
      changeFrequency: page === 'home' ? ('weekly' as const) : ('monthly' as const),
      priority: page === 'home' ? 1 : page === 'calculator' || page === 'track' ? 0.8 : 0.6,
      alternates: { languages: languageAlternates(page) },
    })),
  );
}
