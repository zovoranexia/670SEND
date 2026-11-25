import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Locale } from '@670send/types';
import { BookingFormView } from '@/components/booking/booking-form';
import { PageHero } from '@/components/page-hero';
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
    <>
      <PageHero title={t('title')} lead={t('lead')} />
      <div className="container-page pb-10 pt-4">
        <BookingFormView />
      </div>
    </>
  );
}
