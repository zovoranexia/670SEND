import type { Locale } from '@670send/types';
import { sessionStore } from './session';
import type { PublicUser, SessionResult } from './types';

export const API_URL = String(import.meta.env.VITE_API_URL ?? 'http://localhost:4010').replace(/\/+$/, '');
/** Reports and ledger queries can be heavy: give a request time, then let the caller retry. */
const TIMEOUT_MS = 60_000;

let currentLocale: Locale = 'tet';
/** Language of the error messages the API returns (sent as `X-Lang`). */
export const setApiLocale = (l: Locale) => {
  currentLocale = l;
};

export interface ApiErrorBody {
  code?: string;
  message?: string;
  details?: Array<{ path?: string; message?: string }>;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: ApiErrorBody['details'],
  ) {
    super(message);
    this.name = 'ApiError';
  }
  /** No answer at all: offline, timeout, DNS, server down. The request MAY have reached the server. */
  get isNetwork() {
    return this.status === 0;
  }
}

const networkError = () => new ApiError(0, 'network', 'network');
const isAbort = (e: unknown) => (e as { name?: string })?.name === 'AbortError';

let refreshing: Promise<boolean> | null = null;

/**
 * Exchange the refresh token for a new pair. One refresh at a time (parallel requests share it). A dead token ends
 * the session; a network failure does NOT — the user is simply offline and keeps their session.
 */
export function refreshTokens(): Promise<boolean> {
  const token = sessionStore.get().refreshToken;
  if (!token) return Promise.resolve(false);
  refreshing ??= (async () => {
    try {
      const res = await fetch(`${API_URL}/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Lang': currentLocale },
        body: JSON.stringify({ refreshToken: token }),
      });
      if (res.ok) {
        const t = (await res.json()) as { accessToken: string; refreshToken: string };
        sessionStore.setTokens(t);
        return true;
      }
      if (res.status === 401 || res.status === 403) sessionStore.signOut('expired');
      return false;
    } catch {
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  form?: FormData;
  /** Idempotency-Key: makes a retry after a dropped connection safe (money-moving calls). */
  key?: string;
  /** X-Audit-Reason for sensitive operations (override status, reveal bank details…). */
  reason?: string;
  signal?: AbortSignal;
  /** false for the login call itself. */
  auth?: boolean;
  /** Return the raw response (CSV downloads) instead of parsing JSON. */
  raw?: boolean;
}

async function once(path: string, o: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = { Accept: o.raw ? '*/*' : 'application/json', 'X-Lang': currentLocale };
  const at = sessionStore.get().accessToken;
  if (o.auth !== false && at) headers.Authorization = `Bearer ${at}`;
  if (o.body !== undefined) headers['Content-Type'] = 'application/json';
  if (o.key) headers['Idempotency-Key'] = o.key;
  if (o.reason) headers['X-Audit-Reason'] = o.reason;
  const timeout = typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal ? AbortSignal.timeout(TIMEOUT_MS) : undefined;
  const signal = o.signal && timeout && 'any' in AbortSignal ? AbortSignal.any([o.signal, timeout]) : (o.signal ?? timeout);
  try {
    return await fetch(`${API_URL}/v1${path}`, {
      method: o.method ?? (o.body !== undefined || o.form ? 'POST' : 'GET'),
      headers,
      body: o.form ?? (o.body !== undefined ? JSON.stringify(o.body) : undefined),
      signal,
      cache: 'no-store',
    });
  } catch (e) {
    // A caller-initiated abort (leaving the screen) is not an error; a timeout is a network problem.
    if (isAbort(e) && o.signal?.aborted) throw e;
    throw networkError();
  }
}

async function send(path: string, o: RequestOptions): Promise<Response> {
  const needsAuth = o.auth !== false;
  // After a reload only the refresh token survives: get an access token first instead of failing once.
  if (needsAuth && !sessionStore.get().accessToken && sessionStore.get().refreshToken) await refreshTokens();

  let res = await once(path, o);
  if (res.status === 401 && needsAuth && sessionStore.get().refreshToken) {
    if (await refreshTokens()) res = await once(path, o);
    else if (!sessionStore.get().user) throw new ApiError(401, 'refresh_invalid', '');
  }
  if (res.ok) return res;

  let body: ApiErrorBody = {};
  try {
    body = (await res.json()) as ApiErrorBody;
  } catch {
    /* proxy error page: generic */
  }
  throw new ApiError(res.status, body.code ?? 'generic', body.message ?? '', body.details);
}

export async function request<T>(path: string, o: RequestOptions = {}): Promise<T> {
  const res = await send(path, o);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

/** A file the API generates (CSV reports): the bytes plus the server's suggested name. */
export async function download(path: string, signal?: AbortSignal): Promise<{ blob: Blob; filename: string }> {
  const res = await send(path, { raw: true, signal });
  const cd = res.headers.get('content-disposition') ?? '';
  const filename = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd)?.[1] ?? 'report.csv';
  return { blob: await res.blob(), filename: decodeURIComponent(filename) };
}

/** Build a query string, dropping empty values. */
export const q = (params: Record<string, string | number | boolean | undefined | null>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') s.set(k, String(v));
  const out = s.toString();
  return out ? `?${out}` : '';
};

export const enc = encodeURIComponent;

/** Endpoints grouped by screen live in `./endpoints`; the session endpoints stay here (the i18n provider needs them). */
export const api = {
  login: (email: string, password: string) => request<SessionResult>('/auth/login', { body: { email, password }, auth: false }),
  logout: (refreshToken?: string) => request<void>('/auth/logout', { body: { refreshToken } }),
  me: () => request<PublicUser>('/auth/me'),
  setLanguage: (lang: Locale) => request<PublicUser>('/auth/me/language', { method: 'PATCH', body: { lang } }),
  changePassword: (currentPassword: string, newPassword: string) => request<void>('/auth/password/change', { body: { currentPassword, newPassword } }),
};
