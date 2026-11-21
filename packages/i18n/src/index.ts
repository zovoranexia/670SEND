import {
  DEFAULT_LOCALE,
  FALLBACK_LOCALE,
  LOCALES,
  normalizeLocale,
  type Locale,
} from '@670send/types';
import tet from './locales/tet.json';
import pt from './locales/pt.json';
import en from './locales/en.json';
import id from './locales/id.json';

export * from './whatsapp-templates';
export { DEFAULT_LOCALE, FALLBACK_LOCALE, LOCALES, normalizeLocale };
export type { Locale };

/** Tetun is the structural source of truth: every locale must have the same keys. */
export type Messages = typeof tet;

export const NAMESPACES = [
  'common',
  'web',
  'pwa',
  'admin',
  'status',
  'errors',
  'receipt',
  'terms',
  'prohibited',
] as const;
export type Namespace = (typeof NAMESPACES)[number];

export const messages: Record<Locale, Messages> = { tet, pt, en, id };

export function getMessages(locale: Locale): Messages {
  return messages[locale] ?? messages[FALLBACK_LOCALE];
}

export function getNamespace<N extends Namespace>(locale: Locale, ns: N): Messages[N] {
  return getMessages(locale)[ns];
}

type Params = Record<string, string | number>;

function lookup(dict: unknown, path: string): string | undefined {
  let cur: unknown = dict;
  for (const part of path.split('.')) {
    if (cur && typeof cur === 'object' && part in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return typeof cur === 'string' ? cur : undefined;
}

/**
 * Framework-free translate: `t('pt', 'errors.invalid_otp')`.
 * Missing key in the requested locale → Tetun → the key itself (never throws).
 */
export function t(locale: Locale, key: string, params?: Params): string {
  const raw = lookup(messages[locale], key) ?? lookup(messages[FALLBACK_LOCALE], key) ?? key;
  if (!params) return raw;
  return raw.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  );
}

/** Flatten a dictionary to dot-paths (used by parity tests and the admin editor). */
export function flattenKeys(obj: unknown, prefix = ''): string[] {
  if (!obj || typeof obj !== 'object') return [];
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) => {
    const path = prefix ? `${prefix}.${k}` : k;
    return typeof v === 'string' ? [path] : flattenKeys(v, path);
  });
}

/** Locale lookup for headers/cookies with Tetun fallback. */
export function resolveLocale(value: unknown): Locale {
  return normalizeLocale(value);
}

export const ALL_LOCALES = LOCALES;
export const defaultLocale = DEFAULT_LOCALE;
