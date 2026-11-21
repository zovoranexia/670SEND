/**
 * Domain enums shared by every app. These mirror the Prisma enums in
 * apps/api/prisma/schema.prisma (the DB is the source of truth for storage;
 * this file lets web/pwa/admin use the same values without importing Prisma).
 */

export const SERVICE_SCHEMES = ['SCHEME_A', 'SCHEME_B', 'SCHEME_C', 'SCHEME_D'] as const;
export type ServiceScheme = (typeof SERVICE_SCHEMES)[number];

/** Human code → SOP name. */
export const SERVICE_SCHEME_META: Record<
  ServiceScheme,
  { code: string; pickup: boolean; delivery: boolean }
> = {
  SCHEME_A: { code: 'AGENT_TO_AGENT', pickup: false, delivery: false },
  SCHEME_B: { code: 'PICKUP_TO_AGENT', pickup: true, delivery: false },
  SCHEME_C: { code: 'AGENT_TO_DOOR', pickup: false, delivery: true },
  SCHEME_D: { code: 'DOOR_TO_DOOR', pickup: true, delivery: true },
};

export const TRANSPORT_CANALS = ['BUS_BAGGAGE', 'CARGO_TRUCK_PICKUP', 'SEA_FERRY_CARGO'] as const;
export type TransportCanal = (typeof TRANSPORT_CANALS)[number];

/** The 9-state tracking lifecycle (SOP §1.5). Order = public stepper order. */
export const SHIPMENT_STATUSES = [
  'PICKUP_ASSIGNED',
  'DROPPED_AT_ORIGIN',
  'CONSOLIDATED_AT_HUB',
  'IN_TRANSIT',
  'ARRIVED_AT_DEST_AGENT',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'ON_HOLD_ISSUE',
  'RETURN_TO_SENDER',
] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

/** Happy-path steps rendered by the public tracker (exception states are shown as banners). */
export const TRACKER_HAPPY_PATH: readonly ShipmentStatus[] = [
  'PICKUP_ASSIGNED',
  'DROPPED_AT_ORIGIN',
  'CONSOLIDATED_AT_HUB',
  'IN_TRANSIT',
  'ARRIVED_AT_DEST_AGENT',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
];

export const ID_TYPES = ['BI', 'KARTAUN_ELEITORAL', 'PASSPORT'] as const;
export type IdType = (typeof ID_TYPES)[number];

export const PHOTO_TYPES = [
  'OPEN_BOX_CONTENT',
  'SEALED_PARCEL',
  'BAGGAGE_PLACEMENT',
  'INBOUND_INCIDENT',
  'PROOF_OF_DELIVERY',
  'DEPOSIT_PROOF',
  'CLAIM_EVIDENCE',
] as const;
export type PhotoType = (typeof PHOTO_TYPES)[number];

/** Photos that MUST exist before a waybill can be generated (SOP §2.1). */
export const INTAKE_REQUIRED_PHOTOS: readonly PhotoType[] = ['OPEN_BOX_CONTENT', 'SEALED_PARCEL'];

export const ITEM_CATEGORIES = [
  'DOCUMENT',
  'GENERAL',
  'CLOTHING',
  'ELECTRONICS',
  'LIQUID',
  'FOOD',
  'OTHER',
] as const;
export type ItemCategory = (typeof ITEM_CATEGORIES)[number];

/** WhatsApp / notification event codes: the 9 statuses + storage reminders. */
export const NOTIFICATION_EVENT_CODES = [
  ...SHIPMENT_STATUSES,
  'STORAGE_REMINDER_DAY3',
  'STORAGE_REMINDER_DAY5',
] as const;
export type NotificationEventCode = (typeof NOTIFICATION_EVENT_CODES)[number];

/** Template variables each event may use (validated by the admin template editor). */
export const NOTIFICATION_VARIABLES: Record<NotificationEventCode, readonly string[]> = {
  PICKUP_ASSIGNED: ['courierName', 'courierPhone', 'waybill'],
  DROPPED_AT_ORIGIN: ['waybill', 'trackUrl'],
  CONSOLIDATED_AT_HUB: ['waybill', 'hubName'],
  IN_TRANSIT: ['waybill', 'originName', 'destName'],
  ARRIVED_AT_DEST_AGENT: ['waybill', 'kioskName', 'kioskLocation', 'otp', 'openingHours'],
  OUT_FOR_DELIVERY: ['waybill', 'courierName'],
  DELIVERED: ['waybill', 'collectorName', 'time'],
  ON_HOLD_ISSUE: ['waybill'],
  RETURN_TO_SENDER: ['waybill'],
  STORAGE_REMINDER_DAY3: ['waybill', 'kioskName', 'kioskLocation', 'daysLeft'],
  STORAGE_REMINDER_DAY5: ['waybill', 'kioskName', 'kioskLocation', 'dailyFee'],
};

export const NOTIFICATION_AUDIENCES = ['SENDER', 'RECIPIENT'] as const;
export type NotificationAudience = (typeof NOTIFICATION_AUDIENCES)[number];

export const WALLET_TYPES = [
  'DEPOSIT',
  'COMMISSION',
  'FLEET_PAYABLE',
  'COURIER_EARNINGS',
  'PLATFORM_REVENUE',
  'PLATFORM_HUB_OPS',
  'CLAIM_ESCROW_RESERVE',
  'INSURANCE_POOL',
  // Added to the spec list so the ledger can balance (see ARCHITECTURE.md §6):
  'PENDING_SETTLEMENT',
  'EXTERNAL_CLEARING',
] as const;
export type WalletType = (typeof WALLET_TYPES)[number];

export const LEDGER_REFERENCE_TYPES = [
  'SHIPMENT_INTAKE',
  'ORIGIN_COMMISSION',
  'DEST_COMMISSION',
  'FLEET_SHARE',
  'COURIER_ADDON_SHARE',
  'ESCROW_ALLOCATION',
  'INSURANCE_PREMIUM',
  'STORAGE_PENALTY',
  'CLAIM_PAYOUT',
  'FLEET_PAYOUT',
  'DEPOSIT_TOPUP',
  'ADJUSTMENT',
] as const;
export type LedgerReferenceType = (typeof LEDGER_REFERENCE_TYPES)[number];

export const PAYMENT_CHANNELS = ['BNCTL', 'BNU', 'MANDIRI', 'BRI', 'MOSAN', 'TPAY', 'CASH'] as const;
export type PaymentChannel = (typeof PAYMENT_CHANNELS)[number];

/** Channels a fleet owner can be paid through (never CASH-to-driver; MoU Art. 4). */
export const FLEET_PAYOUT_CHANNELS = ['BNCTL', 'BNU', 'MANDIRI', 'BRI', 'MOSAN', 'TPAY'] as const;
export type FleetPayoutChannel = (typeof FLEET_PAYOUT_CHANNELS)[number];

export const CLAIM_TYPES = ['LOST', 'DAMAGED', 'SEAL_TAMPERED'] as const;
export type ClaimType = (typeof CLAIM_TYPES)[number];

export const LIABLE_PARTIES = [
  'FLEET_PARTNER',
  'ORIGIN_AGENT',
  'DEST_AGENT',
  'COURIER',
  'PLATFORM_ESCROW',
] as const;
export type LiableParty = (typeof LIABLE_PARTIES)[number];

export const INBOUND_CONDITIONS = ['INTACT', 'DAMAGED_SEAL', 'WET', 'MISSING'] as const;
export type InboundCondition = (typeof INBOUND_CONDITIONS)[number];

export const ROUTE_CORRIDORS = ['LOCAL', 'EAST', 'SOUTH', 'WEST', 'SEA'] as const;
export type RouteCorridor = (typeof ROUTE_CORRIDORS)[number];
