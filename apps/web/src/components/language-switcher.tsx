'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { LOCALES, LOCALE_LABELS, type Locale } from '@670send/types';
import { Link, usePathname } from '@/i18n/navigation';
import { IconGlobe } from './icons';

/**
 * Four plain links (one per language) inside a <details>: works without JavaScript, keeps the current page and
 * its query (e.g. the waybill being tracked), and the chosen language is remembered by the locale cookie.
 */
export function LanguageSwitcher({ className = '' }: { className?: string }) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const pathname = usePathname();
  const search = useSearchParams();
  const query = Object.fromEntries(search.entries());

  return (
    <details className={`relative ${className}`}>
      <summary className="flex min-h-11 list-none items-center gap-2 rounded-lg border border-white/40 px-3 text-sm font-semibold text-white hover:bg-white/10" aria-label={t('web.a11y.languageMenu')}>
        <IconGlobe width={18} height={18} />
        <span aria-hidden="true">{LOCALE_LABELS[locale].short}</span>
        <span className="sr-only">{t('common.language.label')}: {LOCALE_LABELS[locale].native}</span>
      </summary>
      <ul className="absolute right-0 z-50 mt-2 w-44 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 text-slate-800 shadow-lg" aria-label={t('web.a11y.languageMenu')}>
        {LOCALES.map((l) => (
          <li key={l}>
            <Link
              href={{ pathname, query }}
              locale={l}
              lang={l}
              hrefLang={l}
              aria-current={l === locale ? 'true' : undefined}
              className={`flex min-h-11 items-center justify-between px-4 text-base hover:bg-brand-50 ${l === locale ? 'font-bold text-brand-700' : ''}`}
            >
              <span>{LOCALE_LABELS[l].native}</span>
              <span className="text-xs text-slate-500">{LOCALE_LABELS[l].short}</span>
            </Link>
          </li>
        ))}
      </ul>
    </details>
  );
}
