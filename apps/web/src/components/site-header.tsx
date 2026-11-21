'use client';

import { useTranslations } from 'next-intl';
import { Suspense } from 'react';
import { Link, usePathname } from '@/i18n/navigation';
import { IconMenu } from './icons';
import { LanguageSwitcher } from './language-switcher';

const NAV = [
  { href: '/calculator', key: 'calculator' },
  { href: '/track', key: 'track' },
  { href: '/book', key: 'book' },
  { href: '/prohibited', key: 'prohibited' },
] as const;

const MOBILE_NAV = [{ href: '/', key: 'home' }, ...NAV, { href: '/terms', key: 'terms' }] as const;

export function SiteHeader() {
  const t = useTranslations('web');
  const pathname = usePathname();
  const active = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <header className="sticky top-0 z-40 bg-brand-700 text-white shadow-md">
      <div className="container-page flex min-h-16 items-center justify-between gap-3">
        <Link href="/" className="flex shrink-0 items-center rounded-lg" aria-label={`670Send — ${t('nav.home')}`}>
          {/* eslint-disable-next-line @next/next/no-img-element -- static SVG, no optimisation needed */}
          <img src="/brand/logo-reversed.svg" alt="670Send" width={150} height={36} className="h-9 w-auto" />
        </Link>

        <nav aria-label={t('a11y.mainNav')} className="hidden items-center gap-1 lg:flex">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              aria-current={active(n.href) ? 'page' : undefined}
              className={`flex min-h-11 items-center rounded-lg px-3 text-base font-medium hover:bg-white/10 ${active(n.href) ? 'bg-white/15 font-semibold' : ''}`}
            >
              {t(`nav.${n.key}`)}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Suspense fallback={<div className="h-11 w-20" />}>
            <LanguageSwitcher />
          </Suspense>

          {/* Mobile menu: a <details>, so it keeps working if JavaScript is slow or blocked. */}
          <details className="relative lg:hidden">
            <summary className="flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-white/40 hover:bg-white/10" aria-label={t('a11y.menu')}>
              <IconMenu />
            </summary>
            <nav aria-label={t('a11y.mainNav')} className="absolute right-0 z-50 mt-2 w-64 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 text-slate-800 shadow-lg">
              {MOBILE_NAV.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  aria-current={(n.href === '/' ? pathname === '/' : active(n.href)) ? 'page' : undefined}
                  className="flex min-h-12 items-center px-4 text-base hover:bg-brand-50 aria-[current=page]:bg-brand-50 aria-[current=page]:font-bold aria-[current=page]:text-brand-700"
                >
                  {t(`nav.${n.key}`)}
                </Link>
              ))}
            </nav>
          </details>
        </div>
      </div>
    </header>
  );
}
