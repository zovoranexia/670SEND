import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import type { Locale } from '@670send/types';

/**
 * Any unknown path under a language renders the localized not-found page (app/[locale]/not-found.tsx) with a real
 * HTTP 404. Note: Next.js 16 answers a `notFound()` thrown before streaming with a bare HTML shell and renders the
 * page itself once the browser has hydrated (verified: correct <html lang>, heading, header and footer afterwards).
 */
export default async function CatchAll({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  notFound();
}
