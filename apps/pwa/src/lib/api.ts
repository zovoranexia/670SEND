import type { Locale } from '@670send/types';
import { sessionStore } from './session';
import type {
  CourierJobs,
  DepositRequestRow,
  FieldProfile,
  InboundResult,
  IntakeBody,
  IntakeResult,
  Kiosk,
  ManifestDetail,
  ManifestSummary,
  PodRequest,
  PrintJob,
  PublicUser,
  Quote,
  QuoteRequest,
  SessionResult,
  Shipment,
  ShipmentPage,
  UploadedPhoto,
  Wallet,
} from './types';

export const API_URL = String(import.meta.env.VITE_API_URL ?? 'http://localhost:4010').replace(/\/+$/, '');
/** Mobile networks in the provinces are slow and drop: give a request time, then let the caller retry safely. */
const TIMEOUT_MS = 40_000;

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
 * the session; a network failure does NOT — the agent is simply offline and keeps their session.
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

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  form?: FormData;
  /** Idempotency-Key: makes a retry after a dropped connection safe. */
  key?: string;
  signal?: AbortSignal;
  /** false for the login call itself. */
  auth?: boolean;
}

async function once(path: string, o: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json', 'X-Lang': currentLocale };
  const at = sessionStore.get().accessToken;
  if (o.auth !== false && at) headers.Authorization = `Bearer ${at}`;
  if (o.body !== undefined) headers['Content-Type'] = 'application/json';
  if (o.key) headers['Idempotency-Key'] = o.key;
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

export async function request<T>(path: string, o: RequestOptions = {}): Promise<T> {
  const needsAuth = o.auth !== false;
  // After an app restart only the refresh token survives: get an access token first instead of failing once.
  if (needsAuth && !sessionStore.get().accessToken && sessionStore.get().refreshToken) await refreshTokens();

  let res = await once(path, o);
  if (res.status === 401 && needsAuth && sessionStore.get().refreshToken) {
    if (await refreshTokens()) res = await once(path, o);
    else if (!sessionStore.get().user) throw new ApiError(401, 'refresh_invalid', '');
  }
  if (res.ok) return (res.status === 204 ? undefined : await res.json()) as T;

  let body: ApiErrorBody = {};
  try {
    body = (await res.json()) as ApiErrorBody;
  } catch {
    /* proxy error page: generic */
  }
  throw new ApiError(res.status, body.code ?? 'generic', body.message ?? '', body.details);
}

const q = (params: Record<string, string | number | undefined>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') s.set(k, String(v));
  const out = s.toString();
  return out ? `?${out}` : '';
};

export const api = {
  /* ---------------------------------------------------------------- session */
  loginPin: (phone: string, pin: string) => request<SessionResult>('/auth/login/pin', { body: { phone, pin }, auth: false }),
  logout: (refreshToken?: string) => request<void>('/auth/logout', { body: { refreshToken } }),
  me: () => request<PublicUser>('/auth/me'),
  setLanguage: (lang: Locale) => request<PublicUser>('/auth/me/language', { method: 'PATCH', body: { lang } }),
  changePin: (currentPin: string, newPin: string) => request<void>('/auth/pin/change', { body: { currentPin, newPin } }),
  fieldProfile: () => request<FieldProfile>('/field/profile'),

  /* ------------------------------------------------------------ drop-off flow */
  kiosks: (municipalityCode: string, signal?: AbortSignal) => request<Kiosk[]>(`/kiosks${q({ municipalityCode })}`, { signal }),
  quote: (body: QuoteRequest, signal?: AbortSignal) => request<Quote>('/public/quote', { body, auth: false, signal }),
  createShipment: (body: IntakeBody, key: string) => request<IntakeResult>('/shipments', { body, key }),
  listShipments: (params: { status?: string; q?: string; before?: string; limit?: number }, signal?: AbortSignal) => request<ShipmentPage>(`/shipments${q(params)}`, { signal }),
  shipment: (ref: string, signal?: AbortSignal) => request<Shipment>(`/shipments/${encodeURIComponent(ref)}`, { signal }),
  receipt: (ref: string, lang?: Locale) => request<PrintJob>(`/shipments/${encodeURIComponent(ref)}/receipt${q({ lang, format: 'json' })}`),
  label: (ref: string, lang?: Locale) => request<PrintJob>(`/shipments/${encodeURIComponent(ref)}/label${q({ lang, format: 'json' })}`),
  uploadPhoto: (file: Blob, photoType: string, signal?: AbortSignal) => {
    const form = new FormData();
    form.set('photoType', photoType);
    form.set('file', file, 'photo.jpg');
    return request<UploadedPhoto>('/uploads/photos', { form, signal });
  },

  /* ------------------------------------------------------------ kiosk: inbound + hand-over */
  inboundScan: (body: { code: string; condition: string; notes?: string; incidentPhotoUploadIds?: string[]; missingWaybills?: string[] }) => request<InboundResult>('/inbound/scan', { body }),
  storageFee: (ref: string) => request<{ waybill: string; storageDay: number; penalty: { usd: string } }>(`/shipments/${encodeURIComponent(ref)}/storage-fee`),
  resendOtp: (ref: string) => request<{ sent: boolean }>(`/shipments/${encodeURIComponent(ref)}/resend-otp`, { body: {} }),
  podVerify: (body: PodRequest) => request<{ waybill: string; status: string; deliveredAt: string; storagePenalty: { usd: string } }>('/pod/verify', { body }),

  /* ------------------------------------------------------------ wallet */
  wallets: () => request<Wallet[]>('/wallets/me'),
  deposits: () => request<DepositRequestRow[]>('/deposits/requests?limit=10'),
  requestDeposit: (body: { amountUsd: string; channel: string; referenceNo: string; proofUploadId?: string }, key: string) => request<DepositRequestRow>('/deposits/requests', { body, key }),

  /* ------------------------------------------------------------ courier */
  courierJobs: (signal?: AbortSignal) => request<CourierJobs>('/courier/jobs', { signal }),
  setAvailability: (available: boolean) => request<unknown>('/courier/me/availability', { method: 'PATCH', body: { available } }),
  startDelivery: (ref: string) => request<{ waybill: string; status: string }>(`/shipments/${encodeURIComponent(ref)}/out-for-delivery`, { body: {} }),
  deliveryFailed: (ref: string, notes?: string) => request<{ waybill: string; status: string; attempts: number; returnedToAgent: boolean }>(`/shipments/${encodeURIComponent(ref)}/delivery-failed`, { body: { notes } }),
  hubReceive: (hubCode: string, waybills: string[]) => request<{ received: string[]; failed: Array<{ waybill: string; reason?: string }> }>('/hub/receive', { body: { hubCode, waybills } }),

  /* ------------------------------------------------------------ driver */
  manifests: (signal?: AbortSignal) => request<ManifestSummary[]>('/manifests?limit=30', { signal }),
  manifest: (code: string, signal?: AbortSignal) => request<ManifestDetail>(`/manifests/${encodeURIComponent(code)}`, { signal }),
  handover: (code: string, baggagePhotoUploadId?: string) => request<unknown>(`/manifests/${encodeURIComponent(code)}/handover`, { body: { baggagePhotoUploadId } }),
  arrive: (code: string) => request<ManifestDetail>(`/manifests/${encodeURIComponent(code)}/arrive`, { body: {} }),
  confirmIncident: (id: string) => request<unknown>(`/incidents/${encodeURIComponent(id)}/driver-confirm`, { body: {} }),
};
