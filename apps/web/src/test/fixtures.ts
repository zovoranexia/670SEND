import type { Quote, TrackResult } from '@/lib/api';

const money = (usd: string) => ({ usd: Number(usd).toFixed(4), display: `$${Number(usd).toFixed(2)}` });

export function quoteFixture(over: Partial<Quote> = {}): Quote {
  return {
    origin: 'DIL',
    destination: 'BCU',
    scheme: 'SCHEME_A',
    canal: 'BUS_BAGGAGE',
    tariffTier: 'SMALL',
    isSeaRoute: false,
    zone: 'ZONE_2',
    eta: { tet: '1 loron', pt: '1 dia', en: '1 day', id: '1 hari' },
    volumetricWeightKg: 1,
    chargeableWeightKg: 2,
    baseShippingFee: money('4'),
    pickupAddon: null,
    deliveryAddon: null,
    insurance: null,
    total: money('4'),
    currency: 'USD',
    ...over,
  };
}

export const seaQuote = () => quoteFixture({ destination: 'OEC', canal: 'SEA_FERRY_CARGO', isSeaRoute: true, zone: 'ZONE_4', baseShippingFee: money('8'), total: money('8') });

const T = (h: number) => `2026-11-21T0${h}:00:00.000Z`;

export function trackFixture(over: Partial<TrackResult> = {}): TrackResult {
  return {
    waybill: '670S-DIL-BCU-261121-0001',
    status: 'IN_TRANSIT',
    origin: 'Díli',
    destination: 'Baucau',
    sender: 'M**** d* C****',
    recipient: 'J*** G*****',
    scheme: 'SCHEME_A',
    canal: 'BUS_BAGGAGE',
    steps: [
      { status: 'DROPPED_AT_ORIGIN', reachedAt: T(1), current: false },
      { status: 'CONSOLIDATED_AT_HUB', reachedAt: T(2), current: false },
      { status: 'IN_TRANSIT', reachedAt: T(3), current: true },
      { status: 'ARRIVED_AT_DEST_AGENT', reachedAt: null, current: false },
      { status: 'OUT_FOR_DELIVERY', reachedAt: null, current: false },
      { status: 'DELIVERED', reachedAt: null, current: false },
    ],
    exception: null,
    kiosk: null,
    lastUpdate: T(3),
    ...over,
  };
}

export const apiError = (statusCode: number, code: string, message: string, details?: Array<{ path: string; message: string }>) => ({ statusCode, code, message, ...(details ? { details } : {}) });
