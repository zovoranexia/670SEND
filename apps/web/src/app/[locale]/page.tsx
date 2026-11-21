import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Locale } from '@670send/types';
import { IconBus, IconCalc, IconCamera, IconChat, IconPackage, IconPin, IconSearch, IconShield, IconShip, IconTag, IconTruck } from '@/components/icons';
import { Link } from '@/i18n/navigation';
import { groupByCorridor } from '@/lib/municipalities';
import { pageMetadata } from '@/lib/seo';

type Props = { params: Promise<{ locale: Locale }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  return pageMetadata(locale, 'home');
}

const SCHEMES = ['SCHEME_A', 'SCHEME_B', 'SCHEME_C', 'SCHEME_D'] as const;
const SCHEME_ICON = { SCHEME_A: IconPackage, SCHEME_B: IconTruck, SCHEME_C: IconPin, SCHEME_D: IconShip } as const;
const STEPS = ['s1', 's2', 's3', 's4', 's5'] as const;
const TRUST = [
  { key: 'otp', Icon: IconShield },
  { key: 'photos', Icon: IconCamera },
  { key: 'whatsapp', Icon: IconChat },
  { key: 'tariff', Icon: IconTag },
] as const;

export default async function HomePage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('web');

  return (
    <>
      {/* ------------------------------------------------------------------ hero */}
      <section className="bg-brand-700 text-white">
        <div className="container-page grid gap-10 py-14 lg:grid-cols-[1.25fr_1fr] lg:items-center lg:py-20">
          <div>
            <h1 className="text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl lg:text-5xl">{t('hero.title')}</h1>
            <p className="mt-5 max-w-2xl text-lg leading-relaxed text-brand-100 sm:text-xl">{t('hero.subtitle')}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/calculator" className="btn btn-accent">
                <IconCalc width={20} height={20} />
                {t('hero.ctaCalculate')}
              </Link>
              <Link href="/track" className="btn btn-light">
                <IconSearch width={20} height={20} />
                {t('hero.ctaTrack')}
              </Link>
              <Link href="/book" className="btn border-2 border-white/70 text-white hover:bg-white/10">
                <IconTruck width={20} height={20} />
                {t('hero.ctaBook')}
              </Link>
            </div>
          </div>

          {/* Quick tracker: a plain GET form, so it works without JavaScript. */}
          <form action={`/${locale}/track`} method="get" className="rounded-2xl bg-white p-5 text-slate-800 shadow-xl sm:p-6">
            <h2 className="text-xl font-bold text-brand-800">{t('tracker.title')}</h2>
            <p className="mt-1 text-sm text-slate-600">{t('tracker.lead')}</p>
            <label htmlFor="quick-no" className="field-label mt-4">
              {t('tracker.title')}
            </label>
            <input id="quick-no" name="no" type="text" inputMode="text" autoCapitalize="characters" autoComplete="off" spellCheck={false} placeholder="670S-DIL-BCU-261121-0042" className="input font-mono" required />
            <button type="submit" className="btn btn-primary mt-4 w-full">
              <IconSearch width={20} height={20} />
              {t('tracker.button')}
            </button>
          </form>
        </div>
      </section>

      {/* --------------------------------------------------------------- schemes */}
      <section className="container-page pt-16" aria-labelledby="schemes-title">
        <h2 id="schemes-title" className="section-title">
          {t('home.schemesTitle')}
        </h2>
        <p className="section-lead">{t('home.schemesLead')}</p>
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {SCHEMES.map((s) => {
            const Icon = SCHEME_ICON[s];
            return (
              <li key={s} className="card flex flex-col">
                <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
                  <Icon width={26} height={26} />
                </span>
                <h3 className="mt-4 text-lg font-bold text-brand-800">{t(`schemes.${s}`)}</h3>
                <p className="mt-2 flex-1 text-base text-slate-600">{t(`home.schemeDesc.${s}`)}</p>
                <Link href={{ pathname: '/calculator', query: { scheme: s } }} className="mt-4 inline-flex min-h-11 items-center font-semibold text-accent-600 hover:underline">
                  {t('hero.ctaCalculate')} →
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      {/* ------------------------------------------------------------ how it works */}
      <section className="mt-16 bg-brand-50 py-16" aria-labelledby="how-title">
        <div className="container-page">
          <h2 id="how-title" className="section-title">
            {t('home.howTitle')}
          </h2>
          <ol className="mt-8 grid gap-4 md:grid-cols-5">
            {STEPS.map((s, i) => (
              <li key={s} className="relative rounded-2xl bg-white p-5 shadow-sm">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent-600 text-lg font-bold text-white" aria-hidden="true">
                  {i + 1}
                </span>
                <h3 className="mt-3 text-lg font-bold text-brand-800">
                  <span className="sr-only">{i + 1}. </span>
                  {t(`home.how.${s}.title`)}
                </h3>
                <p className="mt-2 text-base text-slate-600">{t(`home.how.${s}.body`)}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ------------------------------------------------------------------ trust */}
      <section className="container-page pt-16" aria-labelledby="trust-title">
        <h2 id="trust-title" className="section-title">
          {t('home.trustTitle')}
        </h2>
        <ul className="mt-8 grid gap-6 sm:grid-cols-2">
          {TRUST.map(({ key, Icon }) => (
            <li key={key} className="flex gap-4">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-accent-50 text-accent-600">
                <Icon width={26} height={26} />
              </span>
              <div>
                <h3 className="text-lg font-bold text-brand-800">{t(`home.trust.${key}.title`)}</h3>
                <p className="mt-1 text-base text-slate-600">{t(`home.trust.${key}.body`)}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* --------------------------------------------------------------- coverage */}
      <section className="container-page pt-16" aria-labelledby="coverage-title">
        <h2 id="coverage-title" className="section-title">
          {t('home.coverageTitle')}
        </h2>
        <p className="section-lead">{t('home.coverageLead')}</p>
        <div className="mt-8 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {groupByCorridor().map(({ corridor, items }) => (
            <div key={corridor} className="card">
              <h3 className="flex items-center gap-2 text-lg font-bold text-brand-800">
                {corridor === 'SEA' ? <IconShip width={22} height={22} /> : <IconBus width={22} height={22} />}
                {t(`corridors.${corridor}`)}
              </h3>
              <ul className="mt-3 flex flex-wrap gap-2">
                {items.map((m) => (
                  <li key={m.code} className={`rounded-full px-3 py-1.5 text-sm font-medium ${m.isSea ? 'bg-brand-100 text-brand-800' : 'bg-slate-100 text-slate-800'}`}>
                    {m.name}
                  </li>
                ))}
              </ul>
              {corridor === 'SEA' && <p className="mt-3 text-sm text-slate-600">{t('calculator.seaNotice')}</p>}
            </div>
          ))}
        </div>
      </section>

      {/* -------------------------------------------------------------------- CTA */}
      <section className="container-page pt-16">
        <div className="rounded-3xl bg-brand-800 px-6 py-10 text-center text-white sm:px-12">
          <h2 className="text-2xl font-bold sm:text-3xl">{t('home.ctaTitle')}</h2>
          <p className="mx-auto mt-3 max-w-xl text-lg text-brand-100">{t('home.ctaBody')}</p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link href="/calculator" className="btn btn-accent">
              {t('hero.ctaCalculate')}
            </Link>
            <Link href="/book" className="btn btn-light">
              {t('hero.ctaBook')}
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
