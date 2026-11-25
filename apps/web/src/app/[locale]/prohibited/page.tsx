import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Locale } from '@670send/types';
import { IconAlert, IconBan } from '@/components/icons';
import { Link } from '@/i18n/navigation';
import { PageHero } from '@/components/page-hero';
import { pageMetadata } from '@/lib/seo';

type Props = { params: Promise<{ locale: Locale }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  return pageMetadata(locale, 'prohibited');
}

// Same seven lines the agent must tick in the kiosk app (SOP §3.1) — order matters for the customer, keep it.
const REFUSED = ['narcotics', 'weapons_sharp', 'fuel_flammable', 'cash_gold_jewelry', 'protected_wildlife', 'untaxed_contraband', 'raw_perishables'] as const;
const RESTRICTED = ['electronics', 'documents', 'liquids'] as const;

export default async function ProhibitedPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('prohibited');
  const nav = await getTranslations('web.nav');

  return (
    <>
      <PageHero title={t('title')} lead={t('intro')} />
      <div className="container-page max-w-4xl pb-10 pt-4">
        <section aria-labelledby="refused">
          <h2 id="refused" className="text-xl font-bold text-red-800">
            {t('refusedTitle')}
          </h2>
          <ul className="mt-4 grid gap-3">
            {REFUSED.map((k) => (
              <li key={k} className="flex gap-3 rounded-xl border border-red-200 bg-red-50 p-4">
                <IconBan width={24} height={24} className="mt-0.5 shrink-0 text-red-700" />
                <span className="text-base text-slate-900">{t(`items.${k}`)}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-10" aria-labelledby="restricted">
          <h2 id="restricted" className="text-xl font-bold text-accent-700">
            {t('restrictedTitle')}
          </h2>
          <ul className="mt-4 grid gap-3">
            {RESTRICTED.map((k) => (
              <li key={k} className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
                <IconAlert width={24} height={24} className="mt-0.5 shrink-0 text-accent-600" />
                <span className="text-base text-slate-900">{t(`restricted.${k}`)}</span>
              </li>
            ))}
          </ul>
        </section>

        <p className="mt-8 rounded-xl bg-brand-50 p-4 text-base font-medium text-brand-900">{t('footerNote')}</p>
        <p className="mt-6">
          <Link href="/terms" className="font-semibold text-accent-600 hover:underline">
            {nav('terms')} →
          </Link>
        </p>
      </div>
    </>
  );
}
