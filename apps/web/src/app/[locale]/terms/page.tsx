import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Locale } from '@670send/types';
import { Link } from '@/i18n/navigation';
import { PageHero } from '@/components/page-hero';
import { pageMetadata } from '@/lib/seo';

type Props = { params: Promise<{ locale: Locale }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  return pageMetadata(locale, 'terms');
}

/** Reading order of the clauses. */
const CLAUSES = ['declaration', 'identity', 'inspection', 'liability', 'exclusions', 'claimDeadline', 'storage'] as const;

export default async function TermsPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('terms');
  const nav = await getTranslations('web.nav');

  return (
    <>
      <PageHero title={t('title')} lead={t('intro')} />
      <div className="container-page max-w-3xl pb-10 pt-4">
        <ol className="space-y-8">
          {CLAUSES.map((k, i) => (
            <li key={k} className="flex gap-4">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-700 font-bold text-white" aria-hidden="true">
                {i + 1}
              </span>
              <section aria-labelledby={`clause-${k}`}>
                <h2 id={`clause-${k}`} className="text-xl font-bold text-brand-800">
                  {t(`clauses.${k}.title`)}
                </h2>
                <p className="mt-2 text-base leading-relaxed text-slate-800">{t(`clauses.${k}.body`)}</p>
              </section>
            </li>
          ))}
        </ol>

        <p className="mt-12">
          <Link href="/prohibited" className="font-semibold text-accent-600 hover:underline">
            {nav('prohibited')} →
          </Link>
        </p>
      </div>
    </>
  );
}
