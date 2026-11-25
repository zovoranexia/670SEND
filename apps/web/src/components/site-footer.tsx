import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { SUPPORT_WHATSAPP } from '@/lib/config';
import { IconWhatsApp } from './icons';

export async function SiteFooter() {
  const t = await getTranslations('web');
  const year = new Date().getFullYear();

  return (
    <footer className="on-dark relative mt-16 text-brand-100">
      <svg viewBox="0 0 1440 70" preserveAspectRatio="none" className="relative -mb-px block h-10 w-full text-brand-900 sm:h-16" aria-hidden="true" focusable="false">
        <path fill="currentColor" d="M0 40 C200 0 420 74 680 38 C940 2 1160 64 1440 22 V70 H0Z" />
      </svg>
      <div className="bg-brand-900">
        <div className="container-page grid gap-10 pb-12 pt-6 md:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            {/* eslint-disable-next-line @next/next/no-img-element -- static SVG */}
            <img src="/brand/logo-reversed.svg" alt="670Send" width={150} height={36} className="h-9 w-auto" />
            <p className="mt-4 max-w-sm text-base leading-relaxed text-brand-100">{t('footer.about', { operator: t('footer.operator') })}</p>
            {SUPPORT_WHATSAPP && (
              <a
                href={`https://wa.me/${SUPPORT_WHATSAPP}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/15 bg-white/10 px-4 font-semibold text-white transition hover:-translate-y-0.5 hover:bg-white/20"
              >
                <IconWhatsApp width={20} height={20} />
                {t('footer.support')}
                <span className="sr-only">{t('a11y.external')}</span>
              </a>
            )}
          </div>

          <nav aria-labelledby="footer-explore">
            <h2 id="footer-explore" className="text-sm font-bold uppercase tracking-wider text-white">
              {t('footer.exploreHeading')}
            </h2>
            <ul className="mt-3 space-y-1">
              {(['calculator', 'track', 'book'] as const).map((k) => (
                <li key={k}>
                  <Link href={`/${k}`} className="inline-flex min-h-10 items-center transition hover:translate-x-1 hover:text-white hover:underline">
                    {t(`nav.${k}`)}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <nav aria-labelledby="footer-legal">
            <h2 id="footer-legal" className="text-sm font-bold uppercase tracking-wider text-white">
              {t('footer.legalHeading')}
            </h2>
            <ul className="mt-3 space-y-1">
              {(['prohibited', 'terms'] as const).map((k) => (
                <li key={k}>
                  <Link href={`/${k}`} className="inline-flex min-h-10 items-center transition hover:translate-x-1 hover:text-white hover:underline">
                    {t(`nav.${k}`)}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
        <div className="border-t border-white/10">
          <p className="container-page py-5 text-sm text-brand-200">
            © {year} {t('footer.operator')} — {t('footer.rights')}
          </p>
        </div>
      </div>
    </footer>
  );
}
