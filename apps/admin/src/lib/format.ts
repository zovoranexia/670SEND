import { LOCALES, normalizeLocale, type Locale } from '@670send/types';

export { normalizeLocale };
export const isLocale = (v: unknown): v is Locale => typeof v === 'string' && (LOCALES as readonly string[]).includes(v);

const tag = (locale: Locale) => (locale === 'en' ? 'en-GB' : locale === 'id' ? 'id-ID' : 'pt-PT'); // Intl has no Tetun; pt gives dd/mm/yyyy

/** Numeric day/month/year and a 24 h clock in Díli time — identical meaning in all four languages. */
export function formatDiliDateTime(iso: string | Date | null | undefined, locale: Locale): string {
  if (!iso) return '';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(tag(locale), { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Dili' }).format(d);
}

export function formatDiliDate(iso: string | Date | null | undefined, locale: Locale): string {
  if (!iso) return '';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(tag(locale), { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Dili' }).format(d);
}

/** Today in Díli (UTC+9) as YYYY-MM-DD — what `from` / `to` filters and date inputs use. */
export function diliToday(offsetDays = 0, now = new Date()): string {
  const t = new Date(now.getTime() + 9 * 3600_000 + offsetDays * 86_400_000);
  return t.toISOString().slice(0, 10);
}

/** First instant of a Díli calendar day, as the UTC ISO string the API accepts (`2026-11-21` → `2026-11-20T15:00:00.000Z`). */
export const diliDayStartIso = (date: string) => new Date(`${date}T00:00:00+09:00`).toISOString();
/** Last millisecond of a Díli calendar day, as UTC ISO. */
export const diliDayEndIso = (date: string) => new Date(`${date}T23:59:59.999+09:00`).toISOString();

/** Pasted waybills arrive with spaces, lowercase, or typographic dashes. */
export function normalizeWaybill(input: string): string {
  return input.replace(/[‐-―−]/g, '-').replace(/\s+/g, '').toUpperCase();
}

/** Parse a user-typed decimal; the comma is the decimal mark on many keyboards. */
export function parseDecimal(input: string): number | null {
  const s = input.trim().replace(',', '.');
  return /^\d+(\.\d+)?$/.test(s) ? Number(s) : null;
}

/** "100.0000" → "$100.00" (display only; arithmetic stays on the server). */
export const usd = (amount: string | number | null | undefined) => (amount == null || amount === '' ? '—' : `$${Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

/** "12.50" kept as a plain 4-decimal string for the API (NUMERIC(14,4)); null when not a positive amount. */
export function toAmount(input: string): string | null {
  const n = parseDecimal(input);
  return n != null && n > 0 && n < 1e9 ? n.toFixed(4) : null;
}

export const whatsappUrl = (phone: string, text?: string) => `https://wa.me/${phone.replace(/\D/g, '')}${text ? `?text=${encodeURIComponent(text)}` : ''}`;

/** Trigger a browser download of text/blob content under a file name. */
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
