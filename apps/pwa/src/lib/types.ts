import type { Locale } from '@670send/types';

/** Shapes of the API responses this app uses (only the fields the screens read). */

export interface Money {
  usd: string;
  display: string;
}

export interface PublicUser {
  id: string;
  fullName: string;
  phone: string;
  email: string | null;
  lang: Locale;
  roles: string[];
  permissions: string[];
  scope: { agentId?: string; courierId?: string; driverId?: string; fleetPartnerId?: string };
  mustChangePassword: boolean;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}
export interface SessionResult extends TokenPair {
  user: PublicUser;
}

export type FieldProfile =
  | { kind: 'AGENT'; agentId: string; agentCode: string; kioskName: string; address: string; openingHours: string | null; municipality: { code: string; name: string } }
  | { kind: 'COURIER'; courierId: string; isAvailable: boolean; vehicleType: string; municipality: { code: string; name: string }; hub: { code: string; name: string } | null }
  | { kind: 'DRIVER'; driverId: string; fleetPartner: { id: string; companyName: string } }
  | { kind: 'FLEET_OWNER'; fleetPartnerId: string; companyName: string };

export interface Kiosk {
  id: string;
  agentCode: string;
  kioskName: string;
  address: string;
  openingHours: string | null;
}

export type Scheme = 'SCHEME_A' | 'SCHEME_B' | 'SCHEME_C' | 'SCHEME_D';
export type TransportCanal = 'BUS_BAGGAGE' | 'CARGO_TRUCK_PICKUP' | 'SEA_FERRY_CARGO';

export interface QuoteRequest {
  originMunicipalityCode: string;
  destMunicipalityCode: string;
  scheme: Scheme;
  parcel: { actualWeightKg: number; lengthCm: number; widthCm: number; heightCm: number };
  itemCategory: string;
  isFragile: boolean;
  isHeavyBulk: boolean;
  declaredValueUsd?: string;
  insure: boolean;
}
export interface Quote {
  canal: TransportCanal;
  isSeaRoute: boolean;
  eta: Record<Locale, string>;
  chargeableWeightKg: number;
  baseShippingFee: Money;
  pickupAddon: { fee: Money } | null;
  deliveryAddon: { fee: Money } | null;
  insurance: { premium: Money; insuredAmount: Money } | null;
  total: Money;
}

export interface IntakeBody {
  scheme: Scheme;
  destMunicipalityCode: string;
  destAgentId?: string;
  pickupBookingId?: string;
  sender: { name: string; idType: string; idNumber: string; phone: string; lang: Locale; address?: string };
  recipient: { name: string; phone: string; lang: Locale; address?: string };
  item: { description: string; category: string; isFragile: boolean; isHeavyBulk: boolean; declaredValueUsd?: string };
  parcel: { actualWeightKg: number; lengthCm: number; widthCm: number; heightCm: number };
  insure: boolean;
  prohibitedChecklist: Record<string, true>;
  checklistLang: Locale;
  photoUploadIds: string[];
  pin: string;
}

export interface Shipment {
  id: string;
  waybillNumber: string;
  status: string;
  serviceScheme: Scheme;
  transportCanal: TransportCanal;
  origin: { code: string; name: string };
  destination: { code: string; name: string };
  destAgent: { id: string; kioskName: string; address: string; openingHours: string | null } | null;
  sender: { name: string; phone: string; lang: string };
  recipient: { name: string; phone: string; lang: string; address: string | null };
  fees: { total: Money };
  arrivedDestAt: string | null;
  createdAt: string;
}
export interface IntakeResult {
  shipment: Shipment;
  quote: Quote;
}
export interface ShipmentPage {
  items: Shipment[];
  nextBefore: string | null;
}

export interface PrintJob {
  lang: Locale;
  kind: 'receipt' | 'label';
  text: string;
  escposBase64: string;
}

export interface InboundResult {
  processed: Array<{ waybill: string; status: string }>;
  incidents: Array<{ id: string; waybill: string; condition: string }>;
  driverConfirmationRequired: boolean;
  manifest: { status: string; manifestCode: string };
}

export interface PodRequest {
  waybill: string;
  otp: string;
  collector: { name: string; idType: string; idNumber: string; isRepresentative: boolean };
  photoUploadId: string;
  storagePenaltyCollected: boolean;
}

/** Wallet and deposit amounts are plain decimal strings ("100.0000"), unlike quotes which carry {usd, display}. */
export interface Wallet {
  id: string;
  type: string;
  balance: string;
  locked: string;
  available: string;
}
export interface DepositRequestRow {
  id: string;
  amount: string;
  channel: string;
  referenceNo: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  hasProof: boolean;
  createdAt?: string;
}

export interface CourierJobs {
  pickups: Array<{ id: string; batchCode: string; senderName: string; senderPhone: string; pickupAddress: string; lat: number | null; lng: number | null; parcelCount: number; scheme: Scheme }>;
  readyForDelivery: CourierStop[];
  outForDelivery: CourierStop[];
}
export interface CourierStop {
  waybill: string;
  recipientName: string;
  recipientPhone: string;
  recipientAddress: string | null;
  attempts: number;
}

export interface ManifestSummary {
  manifestCode: string;
  status: string;
  canal: TransportCanal;
  destination: { code: string; name: string };
  vehicle: string;
  parcelCount: number;
  masterBagCount: number;
  scheduledDepartureAt: string | null;
}
export interface ManifestDetail {
  manifestCode: string;
  status: string;
  canal: TransportCanal;
  hub: { code: string; name: string };
  destination: { code: string; name: string };
  vehicle: { plateNumber: string; vehicleType: string };
  portManifestNo: string | null;
  parcelCount: number;
  masterBagCount: number;
  hasBaggagePhoto: boolean;
  incidents: Array<{ id: string; waybill: string; condition: string; status: string; notes: string | null; driverConfirmed: boolean }>;
  items: Array<{ type: 'MASTER_BAG' | 'PARCEL'; code: string; parcelCount: number; inboundCondition: string | null }>;
}

export interface UploadedPhoto {
  id: string;
}
