import { useSyncExternalStore } from 'react';
import type { Locale } from '@670send/types';
import { isLocale } from './format';

/** Which language receipts are printed in: the sender's own (default) or a fixed one. Kept on this phone only. */
export type PrintLang = 'auto' | Locale;
const KEY = '670send.printLang';
const listeners = new Set<() => void>();

export function getPrintLang(): PrintLang {
  try {
    const v = localStorage.getItem(KEY);
    return v && isLocale(v) ? v : 'auto';
  } catch {
    return 'auto';
  }
}
export function setPrintLang(v: PrintLang) {
  try {
    localStorage.setItem(KEY, v);
  } catch {
    /* ignore */
  }
  for (const l of listeners) l();
}
export const usePrintLang = () =>
  useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    getPrintLang,
    getPrintLang,
  );

/** The `lang` to ask the server for: the customer's language unless the agent pinned another. */
export function receiptLang(pref: PrintLang, senderLang: string | undefined): Locale | undefined {
  if (pref !== 'auto') return pref;
  const l = senderLang?.toLowerCase();
  return l && isLocale(l) ? l : undefined;
}
