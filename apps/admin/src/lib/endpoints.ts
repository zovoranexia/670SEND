import { download, enc, q, request } from './api';
import type {
  AddonDto,
  AddonService,
  AdminWallet,
  AgentRow,
  AuditLogRow,
  BagDetail,
  BagRow,
  BankDetails,
  BookingRow,
  ClaimDto,
  ClaimEvidence,
  ComplianceAlert,
  CourierRow,
  DepositDto,
  DriverRow,
  Executive,
  FleetPartnerRow,
  IncidentDto,
  LedgerRow,
  LiabilityPreview,
  LiableParty,
  ManifestCreate,
  ManifestDetail,
  ManifestRow,
  MunicipalityTariff,
  NotificationLogRow,
  PayoutDto,
  PayoutStatement,
  PermissionGroup,
  Reconciliation,
  ReceiveResult,
  RoleDto,
  RtsRow,
  SettingRow,
  ShipmentEvent,
  ShipmentPage,
  ShipmentRow,
  SignedUrl,
  Tariffs,
  TemplateDto,
  TemplatePreview,
  UserDto,
  VehicleRow,
  WalletStatement,
  ZoneDto,
} from './types';

/** Endpoints grouped by area. Each screen imports only what it needs; unit tests stub `fetch`, not these. */

export { enc, q };
type S = AbortSignal | undefined;
const post = <T>(path: string, body: unknown = {}, o: { key?: string; reason?: string } = {}) => request<T>(path, { body, ...o });

export const analyticsApi = {
  executive: (signal?: S) => request<Executive>('/analytics/executive', { signal }),
};

/* ------------------------------------------------------------------------------------------- shipments */
export const shipmentsApi = {
  list: (p: { status?: string; q?: string; before?: string; limit?: number }, signal?: S) => request<ShipmentPage>(`/shipments${q(p)}`, { signal }),
  get: (ref: string, signal?: S) => request<ShipmentRow>(`/shipments/${enc(ref)}`, { signal }),
  events: (ref: string, signal?: S) => request<ShipmentEvent[]>(`/shipments/${enc(ref)}/events`, { signal }),
  override: (waybill: string, status: string, reason: string, notes?: string) => post<{ waybill: string; status: string }>(`/admin/shipments/${enc(waybill)}/override-status`, { status, reason, ...(notes ? { notes } : {}) }, { reason }),
  reminder: (waybill: string, kind: 'DAY3' | 'DAY5') => post<{ waybill: string; sent: true; storageDay: number }>(`/shipments/${enc(waybill)}/reminders`, { kind }),
};

/* ---------------------------------------------------------------------------------------------- hubs */
export const hubsApi = {
  receive: (hubCode: string, waybills: string[]) => post<ReceiveResult>('/hub/receive', { hubCode, waybills }),
  bags: (p: { hubCode?: string; status?: string }, signal?: S) => request<BagRow[]>(`/master-bags${q(p)}`, { signal }),
  bag: (code: string, signal?: S) => request<BagDetail>(`/master-bags/${enc(code)}`, { signal }),
  createBag: (hubCode: string, destMunicipalityCode: string) => post<BagDetail>('/master-bags', { hubCode, destMunicipalityCode }),
  addToBag: (code: string, waybill: string) => post<BagDetail>(`/master-bags/${enc(code)}/items`, { waybill }),
  removeFromBag: (code: string, waybill: string) => request<BagDetail>(`/master-bags/${enc(code)}/items/${enc(waybill)}`, { method: 'DELETE' }),
  seal: (code: string, plasticSealNumber: string) => post<BagDetail>(`/master-bags/${enc(code)}/seal`, { plasticSealNumber }),

  manifests: (p: { status?: string; limit?: number }, signal?: S) => request<ManifestRow[]>(`/manifests${q(p)}`, { signal }),
  manifest: (code: string, signal?: S) => request<ManifestDetail>(`/manifests/${enc(code)}`, { signal }),
  createManifest: (b: ManifestCreate) => post<ManifestDetail>('/manifests', b),
  readyManifest: (code: string, portManifestNo?: string) => post<ManifestDetail>(`/manifests/${enc(code)}/ready`, portManifestNo ? { portManifestNo } : {}),
  cancelManifest: (code: string) => post<ManifestDetail>(`/manifests/${enc(code)}/cancel`),

  bookings: (p: { status?: string; limit?: number }, signal?: S) => request<BookingRow[]>(`/pickup-bookings${q(p)}`, { signal }),
  confirmBooking: (id: string) => post<unknown>(`/pickup-bookings/${enc(id)}/confirm`),
  assignBooking: (id: string, courierId: string) => post<unknown>(`/pickup-bookings/${enc(id)}/assign`, { courierId }),
  cancelBooking: (id: string, reason: string) => post<unknown>(`/pickup-bookings/${enc(id)}/cancel`, { reason }),
};

/* ----------------------------------------------------------------------------------------- partners */
export interface AgentCreate {
  fullName: string;
  phone: string;
  email?: string;
  pin: string;
  preferredLang: string;
  municipalityCode: string;
  kioskName: string;
  address: string;
  openingHours?: string;
  hasDigitalScale: boolean;
  hasSecureStorage: boolean;
  external670LinkAgentId?: string;
}
export interface CourierCreate {
  fullName: string;
  phone: string;
  email?: string;
  pin: string;
  preferredLang: string;
  municipalityCode: string;
  hubCode?: string;
  vehicleType: 'MOTORBIKE' | 'PICKUP';
  plateNumber?: string;
}
export interface PartnerCreate {
  fullName: string;
  phone: string;
  email?: string;
  pin: string;
  preferredLang: string;
  password?: string;
  companyName: string;
  serveRegNo?: string;
  mouNumber?: string;
  mouSignedAt?: string;
  mouValidUntil?: string;
  payoutCycle: 'DAILY' | 'WEEKLY';
  payoutChannel: string;
  bank?: { bank: string; accountName: string; accountNo: string };
}
export const partnersApi = {
  agents: (p: { status?: string; municipalityCode?: string; limit?: number }, signal?: S) => request<AgentRow[]>(`/admin/agents${q(p)}`, { signal }),
  createAgent: (b: AgentCreate) => post<AgentRow>('/admin/agents', b),
  signAdendum: (id: string) => post<AgentRow>(`/admin/agents/${enc(id)}/adendum`),
  setAgentStatus: (id: string, status: string, reason?: string) => post<AgentRow>(`/admin/agents/${enc(id)}/status`, { status, ...(reason ? { reason } : {}) }),

  couriers: (p: { municipalityCode?: string; limit?: number }, signal?: S) => request<CourierRow[]>(`/admin/couriers${q(p)}`, { signal }),
  createCourier: (b: CourierCreate) => post<CourierRow>('/admin/couriers', b),
  updateCourier: (id: string, b: { status?: string; isAvailable?: boolean }) => request<CourierRow>(`/admin/couriers/${enc(id)}`, { method: 'PATCH', body: b }),

  fleetPartners: (p: { status?: string; limit?: number }, signal?: S) => request<FleetPartnerRow[]>(`/admin/fleet-partners${q(p)}`, { signal }),
  createPartner: (b: PartnerCreate) => post<FleetPartnerRow>('/admin/fleet-partners', b),
  renewMou: (id: string, b: { mouNumber?: string; mouSignedAt?: string; mouValidUntil: string }) => post<FleetPartnerRow>(`/admin/fleet-partners/${enc(id)}/mou`, b),
  setBank: (id: string, b: { bank: string; accountName: string; accountNo: string }) => request<FleetPartnerRow>(`/admin/fleet-partners/${enc(id)}/bank`, { method: 'PUT', body: b }),
  setPartnerStatus: (id: string, status: string, reason?: string) => post<FleetPartnerRow>(`/admin/fleet-partners/${enc(id)}/status`, { status, ...(reason ? { reason } : {}) }),

  vehicles: (p: { fleetPartnerId?: string }, signal?: S) => request<VehicleRow[]>(`/fleet/vehicles${q(p)}`, { signal }),
  verifyVehicle: (id: string) => post<VehicleRow>(`/admin/vehicles/${enc(id)}/verify`),
  deactivateVehicle: (id: string) => post<VehicleRow>(`/admin/vehicles/${enc(id)}/deactivate`),
  drivers: (p: { fleetPartnerId?: string }, signal?: S) => request<DriverRow[]>(`/fleet/drivers${q(p)}`, { signal }),
  verifyDriver: (id: string) => post<DriverRow>(`/admin/drivers/${enc(id)}/verify`),
  deactivateDriver: (id: string) => post<DriverRow>(`/admin/drivers/${enc(id)}/deactivate`),

  alerts: (days: number, signal?: S) => request<ComplianceAlert[]>(`/admin/compliance/alerts${q({ days })}`, { signal }),
};

/* ------------------------------------------------------------------------------------------ finance */
export const financeApi = {
  deposits: (p: { status?: string; ownerType?: string; limit?: number; before?: string }, signal?: S) => request<DepositDto[]>(`/deposits/requests${q(p)}`, { signal }),
  depositProof: (id: string) => request<SignedUrl>(`/finance/deposits/${enc(id)}/proof`),
  approveDeposit: (id: string, key: string) => post<DepositDto>(`/finance/deposits/${enc(id)}/approve`, undefined, { key }),
  rejectDeposit: (id: string, reason: string) => post<DepositDto>(`/finance/deposits/${enc(id)}/reject`, { reason }),

  wallets: (p: { ownerType?: string; ownerId?: string; walletType?: string; limit?: number }, signal?: S) => request<AdminWallet[]>(`/finance/wallets${q(p)}`, { signal }),
  statement: (id: string, p: { before?: string; limit?: number }, signal?: S) => request<WalletStatement>(`/wallets/${enc(id)}/statement${q(p)}`, { signal }),
  ledger: (p: { walletId?: string; referenceType?: string; referenceId?: string; from?: string; to?: string; before?: string; limit?: number }, signal?: S) => request<LedgerRow[]>(`/finance/ledger${q(p)}`, { signal }),
  reconciliation: (signal?: S) => request<Reconciliation>('/finance/reconciliation', { signal }),
  refund: (b: { waybill: string; reason: string; reference?: string }, key: string) => post<{ waybill: string; refunded: { usd: string } }>('/finance/refunds', b, { key }),

  payouts: (p: { status?: string; fleetPartnerId?: string; limit?: number }, signal?: S) => request<PayoutDto[]>(`/finance/payouts${q(p)}`, { signal }),
  payoutStatement: (id: string, signal?: S) => request<PayoutStatement>(`/finance/payouts/${enc(id)}/statement`, { signal }),
  payoutStatementCsv: (id: string) => download(`/finance/payouts/${enc(id)}/statement?format=csv`),
  generatePayouts: (b: { fleetPartnerId?: string; cycle?: 'DAILY' | 'WEEKLY' }, key: string) => post<PayoutDto[]>('/finance/payouts/generate', b, { key }),
  submitPayout: (id: string) => post<PayoutDto>(`/finance/payouts/${enc(id)}/submit`),
  approvePayout: (id: string) => post<PayoutDto>(`/finance/payouts/${enc(id)}/approve`),
  payPayout: (id: string, bankReference: string, key: string) => post<PayoutDto>(`/finance/payouts/${enc(id)}/pay`, { bankReference }, { key }),
  failPayout: (id: string, reason: string) => post<PayoutDto>(`/finance/payouts/${enc(id)}/fail`, { reason }),
  cancelPayout: (id: string) => post<PayoutDto>(`/finance/payouts/${enc(id)}/cancel`),
  bankDetails: (fleetPartnerId: string) => request<BankDetails>(`/finance/fleet-partners/${enc(fleetPartnerId)}/bank-details`),
};

/* ------------------------------------------------------------------------------------------- claims */
export const claimsApi = {
  list: (p: { status?: string; waybill?: string; limit?: number; before?: string }, signal?: S) => request<ClaimDto[]>(`/claims${q(p)}`, { signal }),
  evidence: (id: string, signal?: S) => request<ClaimEvidence>(`/claims/${enc(id)}/evidence`, { signal }),
  liability: (waybill: string, signal?: S) => request<LiabilityPreview>(`/claims/liability/${enc(waybill)}`, { signal }),
  review: (id: string) => post<ClaimDto>(`/claims/${enc(id)}/review`),
  decide: (id: string, b: { decision: 'APPROVE' | 'REJECT'; approvedAmountUsd?: string; liableParty?: LiableParty; notes?: string; reason?: string }) => post<ClaimDto>(`/claims/${enc(id)}/decision`, b),
  financeApprove: (id: string) => post<ClaimDto>(`/claims/${enc(id)}/finance-approve`),
  pay: (id: string, b: { channel?: string; reference: string }, key: string) => post<ClaimDto>(`/claims/${enc(id)}/pay`, b, { key }),
  recover: (id: string) => post<ClaimDto>(`/claims/${enc(id)}/recover`),

  incidents: (p: { status?: string }, signal?: S) => request<IncidentDto[]>(`/incidents${q(p)}`, { signal }),
  resolveIncident: (id: string, b: { resolution: 'RELEASE_TO_RECIPIENT' | 'RETURN_TO_SENDER'; notes: string; fleetLiable: boolean }) => post<IncidentDto>(`/incidents/${enc(id)}/resolve`, b),

  rts: (p: { stage?: string }, signal?: S) => request<RtsRow[]>(`/rts${q(p)}`, { signal }),
  rtsReceived: (waybill: string) => post<{ waybill: string; stage: string }>(`/rts/${enc(waybill)}/received`),
  rtsHandBack: (waybill: string, b: { collectorName: string; idType: string; idNumber: string; isRepresentative: boolean }) => post<{ waybill: string; stage: string }>(`/rts/${enc(waybill)}/hand-back`, b),
};

/* ------------------------------------------------------------------------------ content, tariffs, settings */
export const contentApi = {
  templates: (signal?: S) => request<TemplateDto[]>('/admin/templates', { signal }),
  saveTemplate: (event: string, lang: string, b: { bodyTemplate?: string; isActive?: boolean }) => request<TemplateDto>(`/admin/templates/${enc(event)}/${enc(lang)}`, { method: 'PUT', body: b }),
  previewTemplate: (event: string, lang: string, bodyTemplate: string) => post<TemplatePreview>(`/admin/templates/${enc(event)}/${enc(lang)}/preview`, { bodyTemplate }),
  resetTemplate: (event: string, lang: string) => post<TemplateDto>(`/admin/templates/${enc(event)}/${enc(lang)}/reset`),
  logs: (p: { phone?: string; status?: string; eventCode?: string; limit?: number; before?: string }, signal?: S) => request<NotificationLogRow[]>(`/admin/notification-logs${q(p)}`, { signal }),

  tariffs: (signal?: S) => request<Tariffs>('/admin/tariffs', { signal }),
  saveZone: (code: string, b: Partial<Pick<ZoneDto, 'docRate' | 'smallBase2kg' | 'extraPerKg' | 'cargoBase10kg' | 'cargoExtraPerKg'>> & { names?: Partial<ZoneDto['names']>; eta?: Partial<ZoneDto['eta']> }) => request<ZoneDto>(`/admin/tariffs/zones/${enc(code)}`, { method: 'PUT', body: b }),
  saveAddon: (service: AddonService, b: { fee?: string; courierSplitPct?: string; wholesaleMinParcels?: number; wholesaleFreePickup?: boolean; isActive?: boolean }) => request<AddonDto>(`/admin/tariffs/addons/${enc(service)}`, { method: 'PUT', body: b }),
  saveSurcharge: (code: string, surcharge: string) => request<Pick<MunicipalityTariff, 'code' | 'surcharge'>>(`/admin/tariffs/municipalities/${enc(code)}/surcharge`, { method: 'PUT', body: { surcharge } }),

  settings: (signal?: S) => request<SettingRow[]>('/admin/settings', { signal }),
  saveSetting: (key: string, value: unknown) => request<{ key: string; value: unknown }>(`/admin/settings/${enc(key)}`, { method: 'PUT', body: { value } }),
};

/* ----------------------------------------------------------------------------------------- access */
export interface UserCreate {
  fullName: string;
  phone: string;
  email: string;
  preferredLang: string;
  roles: string[];
  password: string;
}
export const accessApi = {
  roles: (signal?: S) => request<RoleDto[]>('/admin/roles', { signal }),
  permissions: (signal?: S) => request<PermissionGroup[]>('/admin/permissions', { signal }),
  createRole: (b: { key: string; name: string; description?: string; permissions: string[] }) => post<RoleDto>('/admin/roles', b),
  updateRole: (id: string, b: { name?: string; description?: string }) => request<RoleDto>(`/admin/roles/${enc(id)}`, { method: 'PATCH', body: b }),
  setRolePermissions: (id: string, permissions: string[]) => request<RoleDto>(`/admin/roles/${enc(id)}/permissions`, { method: 'PUT', body: { permissions } }),
  deleteRole: (id: string) => request<void>(`/admin/roles/${enc(id)}`, { method: 'DELETE' }),

  users: (p: { q?: string; role?: string; active?: 'true' | 'false'; limit?: number; before?: string }, signal?: S) => request<UserDto[]>(`/admin/users${q(p)}`, { signal }),
  createUser: (b: UserCreate) => post<UserDto>('/admin/users', b),
  setUserRoles: (id: string, roles: string[]) => request<UserDto>(`/admin/users/${enc(id)}/roles`, { method: 'PUT', body: { roles } }),
  deactivateUser: (id: string, reason?: string) => post<UserDto>(`/admin/users/${enc(id)}/deactivate`, reason ? { reason } : {}),
  activateUser: (id: string) => post<UserDto>(`/admin/users/${enc(id)}/activate`),
  resetCredentials: (id: string, b: { password?: string; pin?: string }) => post<UserDto>(`/admin/users/${enc(id)}/reset-credentials`, b),
  unlockUser: (id: string) => post<UserDto>(`/admin/users/${enc(id)}/unlock`),

  audit: (p: { entityType?: string; entityId?: string; action?: string; from?: string; to?: string; before?: string; limit?: number }, signal?: S) => request<AuditLogRow[]>(`/admin/audit-logs${q(p)}`, { signal }),
};
