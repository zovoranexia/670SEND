import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Locale } from '@670send/types';
import { BookingFormView } from '@/components/booking/booking-form';
import { pageMetadata } from '@/lib/seo';

type Props = { params: Promise<{ locale: Locale }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  return pageMetadata(locale, 'book');
}

export default async function BookPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('web.booking');

  return (
    <div className="container-page py-10 sm:py-14">
      <div className="mx-auto max-w-5xl">
        <h1 className="text-3xl font-extrabold tracking-tight text-brand-800 sm:text-4xl">{t('title')}</h1>
        <p className="mt-3 max-w-2xl text-lg text-slate-700">{t('lead')}</p>
      </div>
      <div className="mt-8">
        <BookingFormView />
      </div>
    </div>
  );
}
