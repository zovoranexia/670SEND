'use client';

import { useTranslations } from 'next-intl';
import { Suspense } from 'react';
import { Link, usePathname } from '@/i18n/navigation';
import { IconMenu } from './icons';
import { LanguageSwitcher } from './language-switcher';

const NAV = [
  { href: '/calculator', key: 'calculator' },
  { href: '/track', key: 'track' },
  { href: '/prohibited', key: 'prohibited' },
] as const;

const MOBILE_NAV = [
  { href: '/', key: 'home' },
  { href: '/calculator', key: 'calculator' },
  { href: '/track', key: 'track' },
  { href: '/book', key: 'book' },
  { href: '/prohibited', key: 'prohibited' },
  { href: '/terms', key: 'terms' },
] as const;

export function SiteHeader() {
  const t = useTranslations('web');
  const pathname = usePathname();
  const active = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-brand-900/90 text-white shadow-[0_8px_30px_-12px_rgb(0_0_0/0.5)] backdrop-blur-xl">
      <div className="container-page flex min-h-16 items-center justify-between gap-3">
        <Link href="/" className="flex shrink-0 items-center rounded-lg transition hover:opacity-90" aria-label={`670Send — ${t('nav.home')}`}>
          {/* eslint-disable-next-line @next/next/no-img-element -- static SVG, no optimisation needed */}
          <img src="/brand/logo-reversed.svg" alt="670Send" width={150} height={36} className="h-9 w-auto" />
        </Link>

        <nav aria-label={t('a11y.mainNav')} className="hidden items-center gap-1 lg:flex">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              aria-current={active(n.href) ? 'page' : undefined}
              className="relative flex min-h-11 items-center rounded-lg px-3.5 text-base font-medium text-brand-100 transition hover:bg-white/10 hover:text-white aria-[current=page]:font-semibold aria-[current=page]:text-white aria-[current=page]:after:absolute aria-[current=page]:after:inset-x-3.5 aria-[current=page]:after:bottom-1.5 aria-[current=page]:after:h-0.5 aria-[current=page]:after:rounded-full aria-[current=page]:after:bg-[#ff7a45]"
            >
              {t(`nav.${n.key}`)}
            </Link>
          ))}
          <Link href="/book" aria-current={active('/book') ? 'page' : undefined} className="btn btn-accent ml-2 min-h-10 py-2 aria-[current=page]:ring-2 aria-[current=page]:ring-white/70">
            {t('nav.book')}
          </Link>
        </nav>

        <div className="flex items-center gap-2">
          <Suspense fallback={<div className="h-11 w-20" />}>
            <LanguageSwitcher />
          </Suspense>

          {/* Mobile menu: a <details>, so it keeps working if JavaScript is slow or blocked. */}
          <details className="relative lg:hidden">
            <summary className="flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-white/30 transition hover:bg-white/10" aria-label={t('a11y.menu')}>
              <IconMenu />
            </summary>
            <nav aria-label={t('a11y.mainNav')} className="absolute right-0 z-50 mt-2 w-64 overflow-hidden rounded-2xl border border-slate-200 bg-white py-1.5 text-slate-800 shadow-lift">
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
