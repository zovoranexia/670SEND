import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Suspense } from 'react';
import type { Locale } from '@670send/types';
import { Calculator } from '@/components/calculator/calculator';
import { PageHero } from '@/components/page-hero';
import { pageMetadata } from '@/lib/seo';

type Props = { params: Promise<{ locale: Locale }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  return pageMetadata(locale, 'calculator');
}

export default async function CalculatorPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('web.calculator');

  return (
    <>
      <PageHero title={t('title')} lead={t('lead')} />
      <div className="container-page pb-10 pt-4">
        <Suspense fallback={<div className="card h-96 animate-pulse bg-slate-100" aria-hidden="true" />}>
          <Calculator />
        </Suspense>
      </div>
    </>
  );
}
