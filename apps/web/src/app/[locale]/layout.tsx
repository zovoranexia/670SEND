import type { Metadata, Viewport } from 'next';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { routing } from '@/i18n/routing';
import { WEB_URL } from '@/lib/config';
import '../globals.css';

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#0B4F5C' };

export const metadata: Metadata = {
  metadataBase: new URL(WEB_URL),
  title: { default: '670Send', template: '%s | 670Send' },
  applicationName: '670Send',
  formatDetection: { telephone: false },
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  // The browser only needs the strings client components use (form labels, errors, status names); the
  // long legal texts are rendered on the server and never shipped as JSON.
  const all = await getMessages();
  const clientMessages = { common: all.common, web: all.web, status: all.status, errors: { validation: all.errors.validation } };

  return (
    <html lang={locale}>
      <body className="flex min-h-dvh flex-col">
        <NextIntlClientProvider locale={locale} messages={clientMessages}>
          <a href="#main" className="sr-only z-[60] rounded-lg bg-white px-4 py-3 font-semibold text-brand-800 focus:not-sr-only focus:fixed focus:left-4 focus:top-4">
            {all.web.a11y.skip}
          </a>
          <SiteHeader />
          <main id="main" className="flex-1" tabIndex={-1}>
            {children}
          </main>
          <SiteFooter />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
