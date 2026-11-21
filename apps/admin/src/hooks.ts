import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'use-intl';
import { hasPermission } from '@670send/types';
import { ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';

export interface Resource<T> {
  data: T | undefined;
  error: unknown;
  loading: boolean;
  reload: () => void;
}

/** Load something when a screen opens (and on demand); cancel the request when the screen goes away. */
export function useResource<T>(load: (signal: AbortSignal) => Promise<T>, deps: readonly unknown[], opts: { enabled?: boolean } = {}): Resource<T> {
  const enabled = opts.enabled ?? true;
  const [state, setState] = useState<{ data: T | undefined; error: unknown; loading: boolean }>({ data: undefined, error: undefined, loading: enabled });
  const [tick, setTick] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    if (!enabled) {
      setState((s) => ({ ...s, loading: false }));
      return;
    }
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
  }, [...deps, tick, enabled]);

  return { ...state, reload: useCallback(() => setTick((n) => n + 1), []) };
}

/** Human text for an error: the API's own translated message, or a plain "no connection" notice. */
export function useErrorText() {
  const t = useTranslations();
  return useCallback(
    (e: unknown): string => {
      if (e instanceof ApiError) return e.isNetwork ? t('admin.app.needsConnection') : e.message || t('errors.generic');
      return t('errors.generic');
    },
    [t],
  );
}

/** What the signed-in user may do — drives the navigation and which buttons exist (the API enforces it again). */
export function useCan() {
  const { user } = useSession();
  const perms = user?.permissions ?? [];
  return useCallback((key: string) => hasPermission(perms, key), [perms]);
}

/** Run a mutation with a busy flag and an error text; returns true when it succeeded. */
export function useAction() {
  const errorText = useErrorText();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(
    async (fn: () => Promise<unknown>): Promise<boolean> => {
      setBusy(true);
      setError(null);
      try {
        await fn();
        return true;
      } catch (e) {
        setError(errorText(e));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [errorText],
  );
  return { busy, error, run, clearError: () => setError(null) };
}

/** Debounce a fast-changing value (search boxes) so the API is called once the typing pauses. */
export function useDebounced<T>(value: T, ms = 350): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}
