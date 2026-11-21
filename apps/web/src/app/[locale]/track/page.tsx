import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Suspense } from 'react';
import type { Locale } from '@670send/types';
import { Tracker } from '@/components/tracker/tracker';
import { pageMetadata } from '@/lib/seo';

type Props = { params: Promise<{ locale: Locale }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  // The canonical URL has no ?no=…, so waybill variants collapse into this one page in search engines.
  return pageMetadata(locale, 'track');
}

export default async function TrackPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('web.tracker');

  return (
    <div className="container-page py-10 sm:py-14">
      <h1 className="mx-auto max-w-3xl text-3xl font-extrabold tracking-tight text-brand-800 sm:text-4xl">{t('title')}</h1>
      <p className="mx-auto mt-3 max-w-3xl text-lg text-slate-700">{t('lead')}</p>
      <div className="mt-8">
        <Suspense fallback={<div className="card mx-auto h-40 max-w-3xl animate-pulse bg-slate-100" aria-hidden="true" />}>
          <Tracker />
        </Suspense>
      </div>
    </div>
  );
}
