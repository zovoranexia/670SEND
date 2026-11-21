import { useTranslations } from 'use-intl';
import { LOCALES, LOCALE_LABELS } from '@670send/types';
import { useLocaleState } from '@/i18n';

/** The four-language switcher (Tetun · Português · English · Indonesia). Signed in, the choice is saved to the profile. */
export function LanguageSwitcher({ tone = 'light' }: { tone?: 'light' | 'dark' }) {
  const t = useTranslations();
  const { locale, setLocale, profileSyncFailed } = useLocaleState();
  const on = tone === 'dark' ? 'bg-white text-brand-800' : 'bg-brand-700 text-white';
  const off = tone === 'dark' ? 'bg-brand-800 text-brand-100 ring-1 ring-brand-500' : 'bg-white text-brand-800 ring-1 ring-slate-300';
  return (
    <div>
      <div className="flex gap-1" role="group" aria-label={t('common.language.label')}>
        {LOCALES.map((l) => (
          <button key={l} type="button" lang={l} onClick={() => void setLocale(l)} aria-pressed={l === locale} title={LOCALE_LABELS[l].native} className={`min-h-9 min-w-11 rounded-full px-2.5 text-xs font-bold ${l === locale ? on : off}`}>
            {LOCALE_LABELS[l].short}
          </button>
        ))}
      </div>
      {profileSyncFailed && (
        <p className="mt-1 text-xs text-amber-200" role="status">
          {t('admin.app.languageNotSaved')}
        </p>
      )}
    </div>
  );
}
