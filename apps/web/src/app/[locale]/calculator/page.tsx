import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Suspense } from 'react';
import type { Locale } from '@670send/types';
import { Calculator } from '@/components/calculator/calculator';
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
    <div className="container-page py-10 sm:py-14">
      <h1 className="text-3xl font-extrabold tracking-tight text-brand-800 sm:text-4xl">{t('title')}</h1>
      <p className="mt-3 max-w-2xl text-lg text-slate-700">{t('lead')}</p>
      <div className="mt-8">
        <Suspense fallback={<div className="card h-96 animate-pulse bg-slate-100" aria-hidden="true" />}>
          <Calculator />
        </Suspense>
      </div>
    </div>
  );
}
