import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { IntlProvider } from 'use-intl';
import { messages as allMessages } from '@670send/i18n';
import { LOCALE_STORAGE_KEY, type Locale } from '@670send/types';
import { api, setApiLocale } from '@/lib/api';
import { isLocale, normalizeLocale } from '@/lib/format';
import { sessionStore, useSession } from '@/lib/session';

type Dict = Record<string, unknown>;
const TET = allMessages.tet as unknown as Dict;

/** Tetun fills any hole in another language (parity tests make holes unlikely; this makes them harmless). */
function withFallback(base: Dict, over: Dict): Dict {
  const out: Dict = { ...base };
  for (const [k, v] of Object.entries(over)) {
    const b = out[k];
    out[k] = v && typeof v === 'object' && b && typeof b === 'object' ? withFallback(b as Dict, v as Dict) : v;
  }
  return out;
}
const bundles = new Map<Locale, Dict>();
function messagesFor(locale: Locale): Dict {
  if (!bundles.has(locale)) bundles.set(locale, locale === 'tet' ? TET : withFallback(TET, allMessages[locale] as unknown as Dict));
  return bundles.get(locale)!;
}

function storedLocale(): Locale {
  try {
    const v = localStorage.getItem(LOCALE_STORAGE_KEY);
    return isLocale(v) ? v : 'tet';
  } catch {
    return 'tet';
  }
}

interface LocaleCtx {
  locale: Locale;
  /** Switches the language everywhere at once and saves it to the user's profile when signed in. */
  setLocale: (l: Locale) => Promise<void>;
  /** True when the profile could not be updated (offline): the language still changed in this tab. */
  profileSyncFailed: boolean;
}
const Ctx = createContext<LocaleCtx | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const [locale, setLocaleState] = useState<Locale>(() => (user ? normalizeLocale(user.lang) : storedLocale()));
  const [profileSyncFailed, setFailed] = useState(false);
  const lastUserId = useRef<string | null>(user?.id ?? null);

  const apply = useCallback((l: Locale) => {
    setLocaleState(l);
    setApiLocale(l);
    document.documentElement.lang = l;
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, l);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    setApiLocale(locale);
    document.documentElement.lang = locale;
  }, [locale]);

  // Signing in adopts the language saved in the profile ("the profile wins"); signing out keeps the current one.
  useEffect(() => {
    if (user && user.id !== lastUserId.current) apply(normalizeLocale(user.lang));
    lastUserId.current = user?.id ?? null;
    if (user) setFailed(false);
  }, [user, apply]);

  const setLocale = useCallback(
    async (l: Locale) => {
      apply(l);
      const u = sessionStore.get().user;
      if (!u || normalizeLocale(u.lang) === l) return;
      try {
        sessionStore.setUser(await api.setLanguage(l));
        setFailed(false);
      } catch {
        setFailed(true);
      }
    },
    [apply],
  );

  const value = useMemo(() => ({ locale, setLocale, profileSyncFailed }), [locale, setLocale, profileSyncFailed]);
  return (
    <Ctx.Provider value={value}>
      <IntlProvider locale={locale} messages={messagesFor(locale) as never} timeZone="Asia/Dili" onError={() => undefined} getMessageFallback={({ namespace, key }) => `${namespace ?? ''}.${key}`}>
        {children}
      </IntlProvider>
    </Ctx.Provider>
  );
}

export function useLocaleState(): LocaleCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useLocaleState outside <LocaleProvider>');
  return v;
}
