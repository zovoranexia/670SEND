import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { CSSProperties } from 'react';
import type { Locale } from '@670send/types';
import { Ridges, RouteMap } from '@/components/fx/decor';
import { Parallax } from '@/components/fx/parallax';
import { Reveal } from '@/components/fx/reveal';
import { ScrollProgress } from '@/components/fx/scroll-progress';
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
const SCHEME_ICON = {
  SCHEME_A: IconPackage,
  SCHEME_B: IconTruck,
  SCHEME_C: IconPin,
  SCHEME_D: IconShip,
} as const;
const STEPS = ['s1', 's2', 's3', 's4', 's5'] as const;
const TRUST = [
  { key: 'otp', Icon: IconShield },
  { key: 'photos', Icon: IconCamera },
  { key: 'whatsapp', Icon: IconChat },
  { key: 'tariff', Icon: IconTag },
] as const;
const STATS = [
  { key: 'municipalities', value: '14' },
  { key: 'schemes', value: '4' },
  { key: 'steps', value: '5' },
  { key: 'languages', value: '4' },
] as const;

const delay = (ms: number) => ({ '--d': `${ms}ms` }) as CSSProperties;

export default async function HomePage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('web');

  return (
    <>
      {/* ------------------------------------------------------------------ hero */}
      <section className="on-dark relative isolate overflow-hidden bg-gradient-to-b from-brand-900 via-brand-800 to-brand-700 text-white">
        {/* parallax layers: glows (far) → route network → floating parcels (near) → ridges (nearest) */}
        <Parallax speed={0.38} className="absolute -inset-y-40 inset-x-0 -z-10" innerClassName="relative h-full">
          <div className="absolute -left-28 top-24 h-[26rem] w-[26rem] rounded-full bg-brand-500/45 blur-3xl" />
          <div className="absolute -right-16 top-72 h-[30rem] w-[30rem] rounded-full bg-accent-500/20 blur-3xl" />
        </Parallax>
        <Parallax speed={0.22} className="absolute -inset-y-24 inset-x-0 -z-10 hidden opacity-60 lg:left-[46%] lg:block" innerClassName="h-full">
          <RouteMap className="h-full w-full" />
        </Parallax>
        <Parallax speed={-0.18} className="absolute right-[6%] top-28 -z-10 hidden md:block" innerClassName="">
          <div className="float-slow flex h-16 w-16 items-center justify-center rounded-2xl glass text-white shadow-lift">
            <IconPackage width={32} height={32} />
          </div>
        </Parallax>
        <Parallax speed={-0.3} className="absolute right-[2%] top-[74%] -z-10 hidden lg:block" innerClassName="">
          <div className="float-slower flex h-14 w-14 items-center justify-center rounded-2xl glass text-[#ffb08a] shadow-lift">
            <IconTruck width={28} height={28} />
          </div>
        </Parallax>
        <Parallax speed={-0.12} className="absolute right-[34%] top-[9%] -z-10 hidden lg:block" innerClassName="">
          <div className="float-slow flex h-12 w-12 items-center justify-center rounded-xl glass text-white shadow-lift">
            <IconShip width={24} height={24} />
          </div>
        </Parallax>
        <Ridges className="-z-10" />

        <div className="container-page relative grid gap-12 pb-40 pt-14 sm:pt-20 lg:grid-cols-[1.2fr_1fr] lg:items-center lg:pb-52 lg:pt-24">
          <div>
            <p className="rise inline-flex items-center gap-2.5 rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-sm font-semibold text-brand-100 backdrop-blur">
              <span className="pulse-dot h-2.5 w-2.5 rounded-full bg-[#ff7a45]" aria-hidden="true" />
              {t('hero.eyebrow')}
            </p>
            <h1 className="rise mt-5 text-4xl font-extrabold leading-[1.08] tracking-tight text-balance sm:text-5xl lg:text-6xl" style={delay(80)}>
              {t('hero.title')}
            </h1>
            <p className="rise mt-6 max-w-2xl text-lg leading-relaxed text-brand-100 sm:text-xl" style={delay(160)}>
              {t('hero.subtitle')}
            </p>
            <div className="rise mt-9 flex flex-wrap gap-3" style={delay(240)}>
              <Link href="/calculator" className="btn btn-accent">
                <IconCalc width={20} height={20} />
                {t('hero.ctaCalculate')}
              </Link>
              <Link href="/track" className="btn btn-light">
                <IconSearch width={20} height={20} />
                {t('hero.ctaTrack')}
              </Link>
              <Link href="/book" className="btn btn-ghost-light">
                <IconTruck width={20} height={20} />
                {t('hero.ctaBook')}
              </Link>
            </div>
          </div>

          {/* Quick tracker: a plain GET form, so it works without JavaScript. */}
          <form action={`/${locale}/track`} method="get" className="rise rounded-3xl bg-white p-6 text-slate-800 shadow-lift ring-1 ring-white/50 sm:p-7" style={delay(200)}>
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-700" aria-hidden="true">
              <IconSearch width={26} height={26} />
            </span>
            <h2 className="mt-4 text-xl font-bold text-brand-800">{t('tracker.title')}</h2>
            <p className="mt-1 text-sm text-slate-600">{t('tracker.lead')}</p>
            <label htmlFor="quick-no" className="field-label mt-4">
              {t('tracker.title')}
            </label>
            <input
              id="quick-no"
              name="no"
              type="text"
              inputMode="text"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              placeholder="670S-DIL-BCU-261121-0042"
              className="input font-mono"
              required
            />
            <button type="submit" className="btn btn-primary mt-4 w-full">
              <IconSearch width={20} height={20} />
              {t('tracker.button')}
            </button>
          </form>
        </div>
      </section>

      {/* ----------------------------------------------------------------- stats */}
      <section className="container-page relative z-10 -mt-24 lg:-mt-32" aria-label="670Send">
        <Reveal>
          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-3xl bg-slate-200/70 shadow-lift ring-1 ring-slate-200/80 md:grid-cols-4">
            {STATS.map((s) => (
              <div key={s.key} className="flex flex-col-reverse items-center gap-1 bg-white px-4 py-6 text-center">
                <dt className="text-sm font-semibold text-slate-600">{t(`home.stats.${s.key}`)}</dt>
                <dd className="text-4xl font-extrabold tracking-tight text-brand-700 sm:text-5xl">{s.value}</dd>
              </div>
            ))}
          </dl>
        </Reveal>
      </section>

      {/* --------------------------------------------------------------- schemes */}
      <section className="container-page pt-24" aria-labelledby="schemes-title">
        <Reveal>
          <h2 id="schemes-title" className="section-title">
            {t('home.schemesTitle')}
          </h2>
          <p className="section-lead">{t('home.schemesLead')}</p>
        </Reveal>
        <ul className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {SCHEMES.map((s, i) => {
            const Icon = SCHEME_ICON[s];
            return (
              <li key={s}>
                <Reveal delay={i * 90} className="group card relative flex h-full flex-col overflow-hidden transition duration-300 hover:-translate-y-1.5 hover:shadow-lift">
                  <span
                    className="absolute inset-x-0 top-0 h-1 origin-left scale-x-0 bg-gradient-to-r from-accent-500 to-[#ffb08a] transition duration-500 group-hover:scale-x-100"
                    aria-hidden="true"
                  />
                  <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-600 to-brand-800 text-white shadow-soft transition duration-300 group-hover:rotate-3 group-hover:scale-105">
                    <Icon width={28} height={28} />
                  </span>
                  <h3 className="mt-5 text-lg font-bold text-brand-800">{t(`schemes.${s}`)}</h3>
                  <p className="mt-2 flex-1 text-base text-slate-600">{t(`home.schemeDesc.${s}`)}</p>
                  <Link href={{ pathname: '/calculator', query: { scheme: s } }} className="mt-5 inline-flex min-h-11 items-center gap-1 font-semibold text-accent-600 hover:underline">
                    {t('hero.ctaCalculate')}
                    <span aria-hidden="true" className="transition group-hover:translate-x-1">
                      →
                    </span>
                  </Link>
                </Reveal>
              </li>
            );
          })}
        </ul>
      </section>

      {/* ------------------------------------------------------------ how it works */}
      <section className="relative mt-24 overflow-hidden bg-brand-50 py-24" aria-labelledby="how-title">
        <Parallax speed={0.25} className="absolute -inset-y-20 inset-x-0" innerClassName="dot-grid h-full opacity-70" />
        <div className="container-page relative">
          <Reveal>
            <h2 id="how-title" className="section-title">
              {t('home.howTitle')}
            </h2>
          </Reveal>
          <ScrollProgress className="relative mt-12">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute bottom-6 left-6 top-6 w-1 -translate-x-1/2 rounded-full bg-brand-200 md:bottom-auto md:left-6 md:right-[calc(20%-1.5rem)] md:top-6 md:h-1 md:w-auto md:translate-x-0 md:-translate-y-1/2"
            >
              <span className="progress-fill block h-full w-full rounded-full bg-gradient-to-b from-accent-500 to-[#ffb08a] md:bg-gradient-to-r" />
            </div>
            <ol className="relative grid gap-8 md:grid-cols-5 md:gap-5">
              {STEPS.map((s, i) => (
                <li key={s} className="relative flex gap-4 md:flex-col md:gap-5">
                  <span
                    className="relative z-10 flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-accent-600 text-lg font-extrabold text-white shadow-[0_0_0_6px_var(--color-brand-50)]"
                    aria-hidden="true"
                  >
                    {i + 1}
                  </span>
                  <Reveal delay={i * 80} className="flex-1 rounded-2xl bg-white p-5 shadow-soft ring-1 ring-slate-200/70">
                    <h3 className="text-lg font-bold text-brand-800">
                      <span className="sr-only">{i + 1}. </span>
                      {t(`home.how.${s}.title`)}
                    </h3>
                    <p className="mt-2 text-base text-slate-600">{t(`home.how.${s}.body`)}</p>
                  </Reveal>
                </li>
              ))}
            </ol>
          </ScrollProgress>
        </div>
      </section>

      {/* ------------------------------------------------------------------ trust */}
      <section className="on-dark relative isolate overflow-hidden bg-brand-900 py-24 text-white" aria-labelledby="trust-title">
        <Parallax speed={0.3} className="absolute -inset-y-32 inset-x-0 -z-10" innerClassName="relative h-full">
          <div className="absolute -right-20 top-10 h-96 w-96 rounded-full bg-accent-500/20 blur-3xl" />
          <div className="absolute -left-24 bottom-10 h-96 w-96 rounded-full bg-brand-500/40 blur-3xl" />
        </Parallax>
        <div className="container-page">
          <Reveal>
            <h2 id="trust-title" className="text-3xl font-extrabold tracking-tight text-balance sm:text-4xl">
              {t('home.trustTitle')}
            </h2>
          </Reveal>
          <ul className="mt-10 grid gap-5 sm:grid-cols-2">
            {TRUST.map(({ key, Icon }, i) => (
              <li key={key}>
                <Reveal delay={i * 90} className="glass flex h-full gap-4 rounded-3xl p-6 transition duration-300 hover:-translate-y-1 hover:bg-white/10">
                  <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[#ff7a45]/15 text-[#ff9a6b] ring-1 ring-[#ff7a45]/30">
                    <Icon width={28} height={28} />
                  </span>
                  <div>
                    <h3 className="text-lg font-bold text-white">{t(`home.trust.${key}.title`)}</h3>
                    <p className="mt-1 text-base text-brand-100">{t(`home.trust.${key}.body`)}</p>
                  </div>
                </Reveal>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* --------------------------------------------------------------- coverage */}
      <section className="container-page pt-24" aria-labelledby="coverage-title">
        <Reveal>
          <h2 id="coverage-title" className="section-title">
            {t('home.coverageTitle')}
          </h2>
          <p className="section-lead">{t('home.coverageLead')}</p>
        </Reveal>
        <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {groupByCorridor().map(({ corridor, items }, i) => (
            <Reveal key={corridor} delay={(i % 3) * 90} className="card transition duration-300 hover:-translate-y-1 hover:shadow-lift">
              <h3 className="flex items-center gap-3 text-lg font-bold text-brand-800">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
                  {corridor === 'SEA' ? <IconShip width={22} height={22} /> : <IconBus width={22} height={22} />}
                </span>
                {t(`corridors.${corridor}`)}
              </h3>
              <ul className="mt-4 flex flex-wrap gap-2">
                {items.map((m) => (
                  <li key={m.code} className={`rounded-full px-3.5 py-1.5 text-sm font-medium ${m.isSea ? 'bg-brand-100 text-brand-800' : 'bg-slate-100 text-slate-800'}`}>
                    {m.name}
                  </li>
                ))}
              </ul>
              {corridor === 'SEA' && <p className="mt-3 text-sm text-slate-600">{t('calculator.seaNotice')}</p>}
            </Reveal>
          ))}
        </div>
      </section>

      {/* -------------------------------------------------------------------- CTA */}
      <section className="container-page pt-24">
        <Reveal>
          <div className="on-dark relative isolate overflow-hidden rounded-[2rem] bg-gradient-to-br from-brand-800 via-brand-700 to-brand-600 px-6 py-14 text-center text-white shadow-lift sm:px-12">
            <Parallax speed={0.35} className="absolute -inset-y-10 inset-x-0 -z-10" innerClassName="relative h-full">
              <div className="absolute -left-10 -top-10 h-64 w-64 rounded-full bg-accent-500/30 blur-3xl" />
              <div className="absolute -bottom-16 right-0 h-72 w-72 rounded-full bg-brand-300/25 blur-3xl" />
            </Parallax>
            <h2 className="text-3xl font-extrabold tracking-tight text-balance sm:text-4xl">{t('home.ctaTitle')}</h2>
            <p className="mx-auto mt-4 max-w-xl text-lg text-brand-100">{t('home.ctaBody')}</p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link href="/calculator" className="btn btn-accent">
                {t('hero.ctaCalculate')}
              </Link>
              <Link href="/book" className="btn btn-light">
                {t('hero.ctaBook')}
              </Link>
            </div>
          </div>
        </Reveal>
      </section>
    </>
  );
}
