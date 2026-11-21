import { LOCALES, normalizeLocale, type Locale } from '@670send/types';

export { normalizeLocale };
export const isLocale = (v: unknown): v is Locale => typeof v === 'string' && (LOCALES as readonly string[]).includes(v);

/** Numeric day/month/year and a 24 h clock in Díli time — identical meaning in all four languages. */
export function formatDiliDateTime(iso: string | Date, locale: Locale): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return '';
  const tag = locale === 'en' ? 'en-GB' : locale === 'id' ? 'id-ID' : 'pt-PT'; // Intl has no Tetun; pt gives dd/mm/yyyy
  return new Intl.DateTimeFormat(tag, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Dili' }).format(d);
}

/** Pasted waybills arrive with spaces, lowercase, or typographic dashes. */
export function normalizeWaybill(input: string): string {
  return input.replace(/[‐-―−]/g, '-').replace(/\s+/g, '').toUpperCase();
}

/** Parse a user-typed decimal; the comma is the decimal mark on many phone keyboards. */
export function parseDecimal(input: string): number | null {
  const s = input.trim().replace(',', '.');
  return /^\d+(\.\d+)?$/.test(s) ? Number(s) : null;
}

/** "100.0000" → "$100.00" (display only; arithmetic stays on the server). */
export const usd = (amount: string | number) => `$${Number(amount).toFixed(2)}`;

/** tel: / WhatsApp / map links for the courier. */
export const telUrl = (phone: string) => `tel:${phone}`;
export const whatsappUrl = (phone: string, text?: string) => `https://wa.me/${phone.replace(/\D/g, '')}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
export const mapsUrl = (lat: number | null, lng: number | null, address?: string) =>
  lat != null && lng != null ? `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=18/${lat}/${lng}` : `https://www.openstreetmap.org/search?query=${encodeURIComponent(address ?? '')}`;
