import { getLocale, getTranslations } from 'next-intl/server';
import { LOCALES, LOCALE_LABELS, type Locale } from '@670send/types';
import { Link } from '@/i18n/navigation';
import { SUPPORT_WHATSAPP } from '@/lib/config';
import { Parallax } from './fx/parallax';
import { IconWhatsApp } from './icons';

const EXPLORE = ['calculator', 'track', 'book'] as const;
const LEGAL = ['prohibited', 'terms'] as const;

export async function SiteFooter() {
  const t = await getTranslations('web');
  const tLanguage = await getTranslations('common.language');
  const locale = (await getLocale()) as Locale;
  const year = new Date().getFullYear();
  // The operator name ends with a full stop ("Zovoranexia, Lda."), and the sentence adds its own.
  const operatorInSentence = t('footer.operator').replace(/\.$/, '');

  const linkClass = 'group inline-flex min-h-11 items-center gap-2 text-brand-100 transition hover:text-white';
  const arrow = (
    <span aria-hidden="true" className="text-[#ff9a6b] opacity-0 transition duration-200 group-hover:translate-x-1 group-hover:opacity-100">
      →
    </span>
  );

  return (
    <footer className="on-dark relative mt-16 text-brand-100">
      <svg viewBox="0 0 1440 70" preserveAspectRatio="none" className="relative -mb-px block h-10 w-full text-brand-900 sm:h-16" aria-hidden="true" focusable="false">
        <path fill="currentColor" d="M0 40 C200 0 420 74 680 38 C940 2 1160 64 1440 22 V70 H0Z" />
      </svg>

      <div className="relative isolate overflow-hidden bg-gradient-to-b from-brand-900 to-[#04222a]">
        {/* decorative: faint logo mark drifting at the back, and an orange "route" line across the top */}
        <Parallax speed={0.18} className="absolute -right-10 -top-6 -z-10 sm:right-6" innerClassName="">
          <svg viewBox="0 0 120 120" className="h-72 w-72 rotate-6 sm:h-96 sm:w-96" fill="none" stroke="white" strokeOpacity="0.07" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" focusable="false">
            <rect x="20" y="58" width="80" height="42" rx="11" />
            <path d="M60 58 V76 M44 16 V44 M34 34 L44 44 L54 34 M76 46 V18 M66 28 L76 18 L86 28" />
          </svg>
        </Parallax>
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#ff7a45]/70 to-transparent" aria-hidden="true" />

        <div className="container-page grid gap-x-8 gap-y-10 pb-10 pt-8 sm:grid-cols-2 lg:grid-cols-[1.6fr_1fr_1fr_1fr]">
          <div className="sm:col-span-2 lg:col-span-1">
            {/* eslint-disable-next-line @next/next/no-img-element -- static SVG */}
            <img src="/brand/logo-reversed.svg" alt="670Send" width={150} height={36} className="h-9 w-auto" />
            <p className="mt-4 max-w-sm text-base leading-relaxed text-brand-100">{t('footer.about', { operator: operatorInSentence })}</p>
            {SUPPORT_WHATSAPP && (
              <a
                href={`https://wa.me/${SUPPORT_WHATSAPP}`}
                target="_blank"
                rel="noopener noreferrer"
                className="group mt-6 flex max-w-xs items-center gap-3 rounded-2xl border border-white/15 bg-white/[0.07] p-3 pr-5 font-semibold text-white backdrop-blur transition hover:-translate-y-0.5 hover:bg-white/15"
              >
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#25d366] text-brand-900 transition group-hover:rotate-6 group-hover:scale-105">
                  <IconWhatsApp width={24} height={24} />
                </span>
                {t('footer.support')}
                <span className="sr-only">{t('a11y.external')}</span>
              </a>
            )}
          </div>

          <div className="grid grid-cols-2 gap-x-8 gap-y-10 sm:col-span-2 lg:col-span-2">
            <nav aria-labelledby="footer-explore">
              <h2 id="footer-explore" className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-white">
                <span className="h-0.5 w-5 rounded-full bg-[#ff7a45]" aria-hidden="true" />
                {t('footer.exploreHeading')}
              </h2>
              <ul className="mt-3">
                {EXPLORE.map((k) => (
                  <li key={k}>
                    <Link href={`/${k}`} className={linkClass}>
                      {t(`nav.${k}`)}
                      {arrow}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>

            <nav aria-labelledby="footer-legal">
              <h2 id="footer-legal" className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-white">
                <span className="h-0.5 w-5 rounded-full bg-[#ff7a45]" aria-hidden="true" />
                {t('footer.legalHeading')}
              </h2>
              <ul className="mt-3">
                {LEGAL.map((k) => (
                  <li key={k}>
                    <Link href={`/${k}`} className={linkClass}>
                      {t(`nav.${k}`)}
                      {arrow}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          </div>

          <nav aria-label={t('a11y.languageMenu')} className="sm:col-span-2 lg:col-span-1">
            <p className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-white">
              <span className="h-0.5 w-5 rounded-full bg-[#ff7a45]" aria-hidden="true" />
              {tLanguage('label')}
            </p>
            <ul className="mt-4 flex flex-wrap gap-2">
              {LOCALES.map((l) => (
                <li key={l}>
                  <Link
                    href="/"
                    locale={l}
                    lang={l}
                    hrefLang={l}
                    aria-current={l === locale ? 'true' : undefined}
                    className="inline-flex min-h-11 items-center rounded-full border border-white/20 px-4 text-sm font-semibold text-white transition hover:border-white/60 hover:bg-white/10 aria-[current=true]:border-transparent aria-[current=true]:bg-accent-600"
                  >
                    {LOCALE_LABELS[l].native}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        <div className="border-t border-white/10">
          <div className="container-page flex flex-wrap items-center justify-between gap-3 py-5">
            <p className="text-sm text-brand-200">
              © {year} {t('footer.operator')} — {t('footer.rights')}
            </p>
            <a href="#main" className="group inline-flex min-h-11 items-center gap-2 rounded-full border border-white/20 px-4 text-sm font-semibold text-white transition hover:border-white/60 hover:bg-white/10">
              <span aria-hidden="true" className="transition group-hover:-translate-y-0.5">
                ↑
              </span>
              {t('footer.top')}
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
