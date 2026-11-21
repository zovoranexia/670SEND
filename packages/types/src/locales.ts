/**
 * Locale codes used in URLs, cookies, JSON dictionaries and APIs (lowercase).
 * The Prisma `LanguageCode` enum uses the uppercase form (TET | PT | EN | ID).
 *
 * Tetun (`tet`) is the strict default AND the automatic fallback everywhere.
 */
export const LOCALES = ['tet', 'pt', 'en', 'id'] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'tet';
export const FALLBACK_LOCALE: Locale = 'tet';

export const LOCALE_COOKIE_NAME = '670send_lang';
export const LOCALE_STORAGE_KEY = '670send.lang';

/** Native names shown in language switchers. */
export const LOCALE_LABELS: Record<Locale, { short: string; native: string }> = {
  tet: { short: 'TET', native: 'Tetun' },
  pt: { short: 'PT', native: 'Português' },
  en: { short: 'EN', native: 'English' },
  id: { short: 'ID', native: 'Indonesia' },
};

export type PrismaLanguageCode = 'TET' | 'PT' | 'EN' | 'ID';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** Coerce arbitrary input (cookie, header, query) to a supported locale, else Tetun. */
export function normalizeLocale(value: unknown): Locale {
  if (typeof value !== 'string') return DEFAULT_LOCALE;
  const lower = value.trim().toLowerCase();
  if (isLocale(lower)) return lower;
  // "pt-TL", "en-US", "id-ID", "tet-TL" ...
  const base = lower.split(/[-_]/)[0];
  return isLocale(base) ? base : DEFAULT_LOCALE;
}

export function toPrismaLanguage(locale: Locale): PrismaLanguageCode {
  return locale.toUpperCase() as PrismaLanguageCode;
}

export function fromPrismaLanguage(code: PrismaLanguageCode): Locale {
  return code.toLowerCase() as Locale;
}

/**
 * Parse an Accept-Language header into the best supported locale.
 * Unsupported languages fall through to Tetun (never to English).
 */
export function pickLocaleFromAcceptLanguage(header: string | undefined | null): Locale {
  if (!header) return DEFAULT_LOCALE;
  const ranked = header
    .split(',')
    .map((part) => {
      const [tag = '', ...params] = part.trim().split(';');
      const q = params.find((p) => p.trim().startsWith('q='));
      return { tag, q: q ? Number.parseFloat(q.trim().slice(2)) : 1 };
    })
    .filter((x) => x.tag && Number.isFinite(x.q))
    .sort((a, b) => b.q - a.q);

  for (const { tag } of ranked) {
    const base = tag.toLowerCase().split(/[-_]/)[0];
    if (isLocale(base)) return base;
    // Indonesian is sometimes sent as the legacy "in" tag.
    if (base === 'in') return 'id';
  }
  return DEFAULT_LOCALE;
}
