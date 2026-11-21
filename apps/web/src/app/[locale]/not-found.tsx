'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';

/** Localized 404. A client component: the locale and messages come from <NextIntlClientProvider> in the layout. */
export default function NotFound() {
  const t = useTranslations('web.notFound');
  return (
    <div className="container-page py-24 text-center">
      <p className="text-6xl font-extrabold text-brand-200" aria-hidden="true">
        404
      </p>
      <h1 className="mt-4 text-3xl font-bold text-brand-800">{t('title')}</h1>
      <p className="mx-auto mt-3 max-w-md text-lg text-slate-600">{t('body')}</p>
      <Link href="/" className="btn btn-primary mt-8">
        {t('home')}
      </Link>
    </div>
  );
}
