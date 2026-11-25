import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Suspense } from 'react';
import type { Locale } from '@670send/types';
import { Tracker } from '@/components/tracker/tracker';
import { PageHero } from '@/components/page-hero';
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
    <>
      <PageHero title={t('title')} lead={t('lead')} />
      <div className="container-page pb-10 pt-4">
        <Suspense fallback={<div className="card mx-auto h-40 max-w-3xl animate-pulse bg-slate-100" aria-hidden="true" />}>
          <Tracker />
        </Suspense>
      </div>
    </>
  );
}
