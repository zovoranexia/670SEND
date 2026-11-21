import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'use-intl';
import { ApiError } from '@/lib/api';
import type { FieldError } from '@/lib/intake';

/** navigator.onLine is a hint ("a network interface exists"), but it is the best cheap signal for the banner. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

export interface Resource<T> {
  data: T | undefined;
  error: unknown;
  loading: boolean;
  reload: () => void;
}

/** Load something when a screen opens (and on demand); cancel the request when the screen goes away. */
export function useResource<T>(load: (signal: AbortSignal) => Promise<T>, deps: readonly unknown[]): Resource<T> {
  const [state, setState] = useState<{ data: T | undefined; error: unknown; loading: boolean }>({ data: undefined, error: undefined, loading: true });
  const [tick, setTick] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    const ctl = new AbortController();
    setState((s) => ({ ...s, loading: true, error: undefined }));
    loadRef.current(ctl.signal).then(
      (data) => !ctl.signal.aborted && setState({ data, error: undefined, loading: false }),
      (error: unknown) => {
        if (ctl.signal.aborted || (error as { name?: string })?.name === 'AbortError') return;
        setState((s) => ({ ...s, error, loading: false }));
      },
    );
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `deps` is the caller's dependency list
  }, [...deps, tick]);

  return { ...state, reload: useCallback(() => setTick((n) => n + 1), []) };
}

/** Human text for an error: the API's own translated message, or a plain "no connection" notice. */
export function useErrorText() {
  const t = useTranslations();
  return useCallback(
    (e: unknown): string => {
      if (e instanceof ApiError) return e.isNetwork ? t('pwa.app.needsConnection') : e.message || t('errors.generic');
      return t('errors.generic');
    },
    [t],
  );
}

/** Text for a form-field error produced by the wizard's validators. */
export function useFieldErrorText() {
  const t = useTranslations();
  return useCallback(
    (e: FieldError | undefined): string | undefined => {
      if (!e) return undefined;
      switch (e.key) {
        case 'max':
          return t('web.form.max', { max: e.params?.max ?? 0 });
        case 'minChars':
          return t('web.form.minChars', { min: e.params?.min ?? 0 });
        case 'number':
          return t('web.form.number');
        case 'positive':
          return t('web.form.positive');
        case 'phone':
          return t('errors.validation.whatsapp_phone');
        case 'name':
          return t('errors.validation.name');
        case 'checklist':
          return t('pwa.wizard.checklistAll');
        case 'photos':
          return t('pwa.wizard.photosIntro');
        case 'kiosk':
          return t('pwa.wizard.noKiosk');
        case 'pin':
          return t('errors.validation.pin');
        default:
          return t('web.form.required');
      }
    },
    [t],
  );
}
