import type { Locale } from '@670send/types';

/** Shapes of the API responses the console uses (only the fields the screens read). Money is a 4-decimal string. */

export interface PublicUser {
  id: string;
  fullName: string;
  phone: string | null;
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

/* ------------------------------------------------------------------------------------------- dashboard */

export interface Executive {
  asOf: string;
  gmv: { today: string; month: string };
  platformRevenue: { month: string; walletBalance: string };
  reserves: { claimEscrow: string; insurancePool: string; hubOps: string; pendingSettlement: string };
  shipments: {
    byStatus: Record<string, number>;
    inTransit: number;
    atHub: number;
    atKiosk: number;
    onHold: number;
    unclaimedOver5Days: number;
    returnToSenderPending: number;
  };
  queues: {
    openClaims: number;
    openIncidents: number;
    pendingDeposits: { count: number; amount: string };
    payoutsAwaitingApproval: number;
  };
  byCorridor: Array<{ corridor: string; parcels: number; gmv: string }>;
  last14Days: Array<{ date: string; parcels: number; gmv: string }>;
}

export type ReportName = 'shipments' | 'ledger' | 'claims' | 'deposits';

/* -------------------------------------------------------------------------------------------- shared */

export interface Money {
  usd: string;
  display: string;
}
export interface Place {
  code: string;
  name: string;
}
export type PartnerStatus = 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'TERMINATED';

/* ----------------------------------------------------------------------------------------- shipments */

export interface ShipmentRow {
  id: string;
  waybillNumber: string;
  status: string;
  serviceScheme: string;
  transportCanal: string;
  intakeChannel: string;
  origin: Place | null;
  destination: Place | null;
  destAgent: { id: string; kioskName: string; address: string; openingHours: string | null } | null;
  sender: { name: string; phone: string; idType?: string; idNumber?: string; lang: string; address?: string | null };
  recipient: { name: string; phone: string; lang: string; address: string | null };
  item: { description: string; category: string; isFragile: boolean; isHeavyBulk: boolean; isShortShelfLife: boolean; declaredValue: Money | null };
  parcel: { actualWeightKg: number; volumetricWeightKg: number; chargeableWeightKg: number; lengthCm: number; widthCm: number; heightCm: number; isDocumentTier: boolean };
  insurance: { isInsured: boolean; premium: Money | null; insuredAmount: Money | null };
  fees: { base: Money | null; pickupAddon: Money | null; deliveryAddon: Money | null; storagePenalty: Money | null; total: Money | null };
  sealCode: string | null;
  otpIssued: boolean;
  holdReason: string | null;
  arrivedDestAt: string | null;
  deliveredAt: string | null;
  collectorName: string | null;
  createdAt: string;
}
export interface ShipmentPage {
  items: ShipmentRow[];
  nextBefore: string | null;
}
export interface ShipmentEvent {
  status: string;
  fromStatus: string | null;
  at: string;
  location: string | null;
  notes: string | null;
  actor: string | null;
}

/* ------------------------------------------------------------------------------------------- hubs ops */

export type BagStatus = 'OPEN' | 'SEALED' | 'DISPATCHED' | 'RECEIVED' | 'DISCREPANCY';
export interface BagRow {
  bagCode: string;
  status: BagStatus;
  hub: string;
  destination: string;
  parcelCount: number;
  sealedAt: string | null;
}
export interface BagDetail {
  id: string;
  bagCode: string;
  status: BagStatus;
  plasticSealNumber: string | null;
  hub: Place;
  destination: Place;
  parcelCount: number;
  parcels: Array<{ waybillNumber: string; transportCanal: string; chargeableWeightKg: number; status: string }>;
  sealedAt: string | null;
}
export interface ReceiveResult {
  received: string[];
  failed: Array<{ waybill: string; code: string }>;
}

export type ManifestStatus = 'DRAFT' | 'READY' | 'HANDED_OVER' | 'IN_TRANSIT' | 'ARRIVED' | 'COMPLETED' | 'DISCREPANCY' | 'CANCELLED';
export interface ManifestRow {
  manifestCode: string;
  status: ManifestStatus;
  canal: string;
  destination: Place;
  vehicle: string;
  parcelCount: number;
  masterBagCount: number;
  scheduledDepartureAt: string | null;
}
export interface ManifestDetail {
  manifestCode: string;
  status: ManifestStatus;
  canal: string;
  incidents: Array<{ id: string; waybill: string; condition: string; status: string; notes: string | null; driverConfirmed: boolean }>;
  hub: Place;
  destination: Place;
  fleetPartner: { id: string; companyName: string };
  vehicle: { plateNumber: string; vehicleType: string };
  driver: { id: string; name: string; licenseNumber: string };
  portManifestNo: string | null;
  parcelCount: number;
  masterBagCount: number;
  scheduledDepartureAt: string | null;
  dispatchedAt: string | null;
  arrivedAt: string | null;
  hasBaggagePhoto: boolean;
  items: Array<{ type: 'MASTER_BAG' | 'PARCEL'; code: string; parcelCount: number; inboundCondition: string | null }>;
}
export interface ManifestCreate {
  hubCode: string;
  destMunicipalityCode: string;
  canal: string;
  fleetPartnerId: string;
  vehicleId: string;
  driverId: string;
  masterBagCodes: string[];
  waybills: string[];
  scheduledDepartureAt?: string;
  portManifestNo?: string;
}

export type BookingStatus = 'REQUESTED' | 'ASSIGNED' | 'PICKED_UP' | 'CANCELLED' | 'EXPIRED';
export interface BookingRow {
  id: string;
  batchCode: string;
  status: BookingStatus;
  scheme: string;
  sender: { name: string; phone: string; lang: string };
  parcelCount: number;
  pickupAddress: string;
  lat: number | null;
  lng: number | null;
  destination: string | null;
  confirmed: boolean;
  courier: { id: string; name: string } | null;
  createdAt: string;
}

/* ------------------------------------------------------------------------------------------ partners */

export interface AgentRow {
  id: string;
  agentCode: string;
  kioskName: string;
  status: PartnerStatus;
  statusReason: string | null;
  municipality: Place;
  address: string;
  lat: number | null;
  lng: number | null;
  openingHours: string | null;
  hasDigitalScale: boolean;
  hasSecureStorage: boolean;
  adendumSignedAt: string | null;
  external670LinkAgentId: string | null;
  operator: { fullName: string; phone: string | null };
  depositBalance: string;
  createdAt: string;
}
export interface CourierRow {
  id: string;
  name: string;
  phone: string | null;
  status: PartnerStatus;
  isAvailable: boolean;
  vehicleType: string;
  plateNumber: string | null;
  municipality: Place;
  hub: string | null;
  depositBalance: string;
  earningsBalance: string;
}
export interface FleetPartnerRow {
  id: string;
  companyName: string;
  status: PartnerStatus;
  statusReason: string | null;
  serveRegNo: string | null;
  mou: { number: string | null; signedAt: string | null; validUntil: string | null; autoRenew: boolean; expired: boolean };
  payoutCycle: 'DAILY' | 'WEEKLY';
  payoutChannel: string;
  bank: { bank: string; accountNoLast4: string } | null;
  owner: { fullName: string; phone: string | null; email: string | null };
  vehicleCount: number;
  driverCount: number;
}
export interface VehicleRow {
  id: string;
  plateNumber: string;
  type: string;
  corridor: string;
  maxParcelSlots: number;
  dnttPermitNo: string | null;
  dnttPermitExpiry: string | null;
  kirExpiry: string | null;
  permitsValid: boolean;
  isActive: boolean;
  fleetPartner: { id: string; companyName: string };
}
export interface DriverRow {
  id: string;
  name: string;
  phone: string | null;
  licenseNumber: string;
  licenseExpiry: string | null;
  licenseValid: boolean;
  isActive: boolean;
  fleetPartner: { id: string; companyName: string };
}
export interface ComplianceAlert {
  type: string;
  severity: 'EXPIRED' | 'EXPIRING' | 'MISSING' | 'INFO';
  subject: string;
  subjectId: string;
  dueDate: string | null;
  daysLeft: number | null;
}

export * from "./types-back";
