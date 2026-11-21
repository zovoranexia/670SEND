import type { Locale } from '@670send/types';
import { API_URL } from './config';

/**
 * Typed client for the anonymous endpoints of the 670Send API (`/v1/public/*`).
 * The browser calls the API directly so the API's per-IP rate limit applies to the real visitor.
 * Error messages come back already translated (we send `X-Lang`), so the UI can show them as they are.
 */

export interface ApiErrorBody {
  statusCode: number;
  code: string;
  message: string;
  details?: Array<{ path?: string; message?: string }>;
}

export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: ApiErrorBody['details'],
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
  get isNetwork() {
    return this.code === 'network';
  }
  get isNotFound() {
    return this.status === 404;
  }
}

export interface Money {
  usd: string;
  display: string;
}
export interface AddonLine {
  service: string;
  fee: Money;
  courierShare: Money;
  platformShare: Money;
  wholesaleApplied: boolean;
}
export type TransportCanal = 'BUS_BAGGAGE' | 'CARGO_TRUCK_PICKUP' | 'SEA_FERRY_CARGO';
export type TariffTier = 'DOCUMENT' | 'SMALL' | 'CARGO';

export interface Quote {
  origin: string;
  destination: string;
  scheme: string;
  canal: TransportCanal;
  tariffTier: TariffTier;
  isSeaRoute: boolean;
  zone: string;
  eta: Record<Locale, string>;
  volumetricWeightKg: number;
  chargeableWeightKg: number;
  baseShippingFee: Money;
  pickupAddon: AddonLine | null;
  deliveryAddon: AddonLine | null;
  insurance: { premium: Money; insuredAmount: Money } | null;
  total: Money;
  currency: 'USD';
}

export interface QuoteRequest {
  originMunicipalityCode: string;
  destMunicipalityCode: string;
  scheme: 'SCHEME_A' | 'SCHEME_B' | 'SCHEME_C' | 'SCHEME_D';
  parcel: { actualWeightKg: number; lengthCm: number; widthCm: number; heightCm: number };
  itemCategory: string;
  isFragile: boolean;
  isHeavyBulk: boolean;
  declaredValueUsd?: string;
  insure: boolean;
}

export interface TrackStep {
  status: string;
  reachedAt: string | null;
  current: boolean;
}
export interface TrackResult {
  waybill: string;
  status: string;
  origin: string;
  destination: string;
  sender: string;
  recipient: string;
  scheme: string;
  canal: TransportCanal;
  steps: TrackStep[];
  exception: 'ON_HOLD_ISSUE' | 'RETURN_TO_SENDER' | null;
  kiosk: { name: string; address: string; openingHours: string | null; lat: number | null; lng: number | null } | null;
  lastUpdate: string;
}

export interface BookingRequest {
  senderName: string;
  senderPhone: string;
  preferredLang: Locale;
  scheme: 'SCHEME_B' | 'SCHEME_D';
  destMunicipalityCode?: string;
  parcelCount: number;
  estimatedWeightKg?: number;
  pickupAddress: string;
  lat?: number;
  lng?: number;
  notes?: string;
}
export interface BookingResult {
  batchCode: string;
  status: string;
  parcelCount: number;
  phone: string;
}

async function request<T>(path: string, locale: Locale, init: { method?: 'GET' | 'POST'; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/v1${path}`, {
      method: init.method ?? 'GET',
      headers: { Accept: 'application/json', 'X-Lang': locale, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: init.signal,
      cache: 'no-store',
    });
  } catch (err) {
    if ((err as { name?: string }).name === 'AbortError') throw err;
    throw new ApiRequestError(0, 'network', 'network');
  }
  if (!res.ok) {
    let body: Partial<ApiErrorBody> = {};
    try {
      body = (await res.json()) as Partial<ApiErrorBody>;
    } catch {
      /* not JSON (proxy error page): fall through to the generic message */
    }
    throw new ApiRequestError(res.status, body.code ?? 'generic', body.message ?? '', body.details);
  }
  return (await res.json()) as T;
}

export const publicApi = {
  quote: (body: QuoteRequest, locale: Locale, signal?: AbortSignal) => request<Quote>('/public/quote', locale, { method: 'POST', body, signal }),
  track: (waybill: string, locale: Locale, signal?: AbortSignal) => request<TrackResult>(`/public/track/${encodeURIComponent(waybill)}`, locale, { signal }),
  createBooking: (body: BookingRequest, locale: Locale) => request<BookingResult>('/public/pickup-bookings', locale, { method: 'POST', body }),
};
