import type { Locale } from '@670send/types';

const DILI_TZ = 'Asia/Dili';

/** Numeric day/month/year + 24 h clock in Díli time. Numeric on purpose: identical meaning in all 4 languages. */
export function formatDiliDateTime(iso: string | Date, locale: Locale): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return '';
  // Intl has no Tetun data; Portuguese gives the dd/mm/yyyy order Timorese readers expect.
  const tag = locale === 'en' ? 'en-GB' : locale === 'id' ? 'id-ID' : 'pt-PT';
  return new Intl.DateTimeFormat(tag, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: DILI_TZ }).format(d);
}

/**
 * Pasted waybills arrive with spaces, lowercase, or typographic dashes (WhatsApp, Word, PDF copy).
 * "670s–dil–bcu–261121–0042" → "670S-DIL-BCU-261121-0042".
 */
export function normalizeWaybill(input: string): string {
  return input
    .replace(/[‐-―−]/g, '-')
    .replace(/\s+/g, '')
    .toUpperCase();
}

export const WAYBILL_SHAPE = /^670S-[A-Z]{3}-[A-Z]{3}-\d{6}-\d{4}$/;

/** "-8.55690, 125.56030" — 5 decimals ≈ 1 m, enough for a courier, no false precision. */
export const formatCoord = (n: number) => n.toFixed(5);

/** Open-street-map deep link for a kiosk (no tracking, no API key). */
export const mapLink = (lat: number, lng: number) => `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`;

/** Parse a user-typed decimal ("2,5" or "2.5") — Timorese keyboards often use the comma. */
export function parseDecimal(input: string): number | null {
  const s = input.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
