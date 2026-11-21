/**
 * RBAC catalog — single source of truth for permission keys and the default
 * role → permission matrix. The API seeds these into
 * roles / permissions / role_permissions; web/pwa/admin use the same keys for
 * route guards and conditional UI. Format: `module:action`.
 *
 * Wildcards: `*:*` (everything) and `module:*` are honoured by the guard.
 * Scope suffixes: `_own` permissions are additionally restricted by the
 * resource-ownership check (agent_id / courier_id / fleet_partner_id).
 */

export const PERMISSION_CATALOG = [
  // Dashboard & reporting
  ['dashboard:view', 'View executive KPI dashboard'],
  ['reports:export', 'Export CSV / Excel reports'],

  // Shipments
  ['shipments:create', 'Create shipments (drop-off / on-site courier intake)'],
  ['shipments:read_own', 'Read shipments handled by own agent / courier'],
  ['shipments:read_all', 'Read every shipment'],
  ['shipments:print_label', 'Print waybill labels and receipts'],
  ['shipments:override_status', 'Force-override a tracking status (audit reason required)'],
  ['inbound:scan', 'Perform destination inbound scan'],
  ['inbound:report_incident', 'File an inbound incident report'],
  ['pod:verify', 'Verify pickup OTP and record proof of delivery'],
  ['evidence:read', 'View shipment photo evidence'],

  // Pickup & courier work
  ['pickups:read', 'View pickup bookings'],
  ['pickups:assign', 'Assign couriers to pickup bookings'],
  ['courier_jobs:read_own', 'View own assigned pickup / delivery jobs'],
  ['courier_jobs:execute', 'Execute pickup, handover and last-mile delivery'],
  ['hub_handover:execute', 'Hand parcels to a consolidation hub'],

  // Hub operations
  ['hubs:read', 'View hubs'],
  ['hubs:manage', 'Manage hubs'],
  ['master_bags:read', 'View master bags'],
  ['master_bags:manage', 'Create and seal master bags'],
  ['manifests:read', 'View all manifests'],
  ['manifests:create', 'Build fleet manifests'],
  ['manifests:dispatch', 'Dispatch manifests to fleet'],
  ['manifests:receive', 'Mark manifests received at destination'],
  ['manifests:read_own_fleet', 'View manifests carried by own fleet'],
  ['manifests:read_assigned', 'View manifests assigned to the driver'],
  ['manifests:handover', 'Scan handover QR and upload baggage placement photo'],
  ['manifests:update_trip', 'Mark trip departed / arrived'],
  ['rts:manage', 'Manage return-to-sender queue'],
  ['incidents:read', 'View ON_HOLD incidents'],
  ['incidents:manage', 'Resolve ON_HOLD incidents'],

  // Partners
  ['agents:read', 'View agents'],
  ['agents:manage', 'Manage agents and 670Link sync'],
  ['couriers:read', 'View couriers'],
  ['couriers:manage', 'Manage couriers'],
  ['fleet_partners:read', 'View fleet partners and MoU registry'],
  ['fleet_partners:manage', 'Manage fleet partners and MoUs'],
  ['fleet_partners:read_own', 'View own fleet partner profile and MoU terms'],
  ['vehicles:read', 'View vehicles'],
  ['vehicles:manage', 'Verify / manage any vehicle'],
  ['vehicles:manage_own', 'Manage own fleet vehicles'],
  ['drivers:read', 'View drivers'],
  ['drivers:manage', 'Verify / manage any driver'],
  ['drivers:manage_own', 'Manage own fleet drivers'],

  // Finance
  ['wallets:read_own', 'View own wallets'],
  ['wallets:read_all', 'View all wallets'],
  ['deposits:request', 'Submit deposit top-up proofs'],
  ['deposits:read', 'View deposit requests'],
  ['deposits:approve', 'Approve / reject deposit top-ups'],
  ['ledger:read', 'View the double-entry ledger'],
  ['reconciliation:run', 'Run balance reconciliation'],
  ['payouts:read', 'View fleet payouts'],
  ['payouts:read_own', 'View own settlement statements and payouts'],
  ['payouts:create', 'Generate fleet payout batches'],
  ['payouts:approve', 'Approve and disburse payout batches'],
  ['refunds:issue', 'Refund the unused door-delivery add-on to a customer'],
  ['tariffs:read', 'View tariff matrix'],
  ['tariffs:manage', 'Edit zone and add-on tariffs'],

  // Claims & customer service
  ['claims:read', 'View claims'],
  ['claims:file', 'File a claim'],
  ['claims:review', 'Review claim evidence'],
  ['claims:approve', 'Approve / reject claims up to the CS threshold'],
  ['claims:finance_approve', 'Co-approve claims above the CS threshold'],
  ['claims:pay', 'Pay out approved claims from the escrow reserve'],
  ['notifications:send_reminder', 'Trigger localized WhatsApp reminders'],
  ['notification_logs:read', 'View WhatsApp delivery logs'],

  // Platform administration
  ['templates:manage', 'Edit WhatsApp notification templates (4 languages)'],
  ['users:manage', 'Manage user accounts'],
  ['rbac:manage', 'Edit roles and permission matrix'],
  ['audit:read', 'Inspect immutable audit logs'],
  ['settings:manage', 'Edit system settings'],
] as const;

export type PermissionKey = (typeof PERMISSION_CATALOG)[number][0];
export type WildcardPermission = '*:*';
export type PermissionGrant = PermissionKey | WildcardPermission;

export const ALL_PERMISSION_KEYS = PERMISSION_CATALOG.map(([key]) => key) as PermissionKey[];

export const ROLE_KEYS = [
  'SUPER_ADMIN',
  'OPS_HUB_ADMIN',
  'FINANCE_ADMIN',
  'CS_CLAIMS_ADMIN',
  'AGENT',
  'COURIER',
  'FLEET_OWNER',
  'DRIVER',
] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

export const ROLE_META: Record<RoleKey, { name: string; description: string }> = {
  SUPER_ADMIN: {
    name: 'Super Admin',
    description: 'Unrestricted access, RBAC editor, system settings, template editor, audited force-override.',
  },
  OPS_HUB_ADMIN: {
    name: 'Ops / Hub Admin',
    description: 'Hubs, master bags, manifests, fleet/MoU registry, courier dispatch, RTS. No deposits or payouts.',
  },
  FINANCE_ADMIN: {
    name: 'Finance Admin',
    description: 'Deposit approvals, fleet payouts, tariffs, ledger, reconciliation, exports. No status overrides.',
  },
  CS_CLAIMS_ADMIN: {
    name: 'CS & Claims Admin',
    description: 'Incidents, evidence review, claims up to threshold, reminders, RTS.',
  },
  AGENT: {
    name: '670Link Agent',
    description: 'Drop-off / pick-up kiosk. Scoped to own agent_id.',
  },
  COURIER: {
    name: 'Courier',
    description: 'First-mile pickup and last-mile delivery. Scoped to own courier_id.',
  },
  FLEET_OWNER: {
    name: 'Fleet Owner',
    description: 'Bus / cargo company under MoU. Scoped to own fleet_partner_id.',
  },
  DRIVER: {
    name: 'Driver',
    description: 'Bus / truck crew: handover scan, baggage photo, trip status. No financial data.',
  },
};

export const ROLE_PERMISSIONS: Record<RoleKey, readonly PermissionGrant[]> = {
  SUPER_ADMIN: ['*:*'],

  OPS_HUB_ADMIN: [
    'dashboard:view',
    'shipments:read_all',
    'shipments:print_label',
    'evidence:read',
    'pickups:read',
    'pickups:assign',
    'hubs:read',
    'hubs:manage',
    'master_bags:read',
    'master_bags:manage',
    'manifests:read',
    'manifests:create',
    'manifests:dispatch',
    'manifests:receive',
    'rts:manage',
    'incidents:read',
    'incidents:manage',
    'agents:read',
    'couriers:read',
    'couriers:manage',
    'fleet_partners:read',
    'fleet_partners:manage',
    'vehicles:read',
    'vehicles:manage',
    'drivers:read',
    'drivers:manage',
    'tariffs:read',
    'notification_logs:read',
  ],

  FINANCE_ADMIN: [
    'dashboard:view',
    'reports:export',
    'shipments:read_all',
    'agents:read',
    'couriers:read',
    'fleet_partners:read',
    'wallets:read_all',
    'deposits:read',
    'deposits:approve',
    'ledger:read',
    'reconciliation:run',
    'payouts:read',
    'payouts:create',
    'payouts:approve',
    'tariffs:read',
    'tariffs:manage',
    'claims:read',
    'claims:finance_approve',
    'claims:pay',
    'refunds:issue',
  ],

  CS_CLAIMS_ADMIN: [
    'dashboard:view',
    'shipments:read_all',
    'evidence:read',
    'incidents:read',
    'incidents:manage',
    'rts:manage',
    'claims:read',
    'claims:review',
    'claims:approve',
    'notifications:send_reminder',
    'notification_logs:read',
    'agents:read',
    'claims:file',
  ],

  AGENT: [
    'shipments:create',
    'shipments:read_own',
    'shipments:print_label',
    'inbound:scan',
    'inbound:report_incident',
    'pod:verify',
    'wallets:read_own',
    'deposits:request',
    'tariffs:read',
    'claims:file',
  ],

  COURIER: [
    'shipments:create',
    'shipments:read_own',
    'shipments:print_label',
    'courier_jobs:read_own',
    'courier_jobs:execute',
    'hub_handover:execute',
    'pod:verify',
    'wallets:read_own',
    'tariffs:read',
    'claims:file',
    'deposits:request',
  ],

  FLEET_OWNER: [
    'fleet_partners:read_own',
    'vehicles:manage_own',
    'drivers:manage_own',
    'manifests:read_own_fleet',
    'payouts:read_own',
    'wallets:read_own',
  ],

  DRIVER: ['manifests:read_assigned', 'manifests:handover', 'manifests:update_trip'],
};

/** Match a granted permission (possibly wildcard) against a required key. */
export function permissionMatches(grant: string, required: string): boolean {
  if (grant === '*:*' || grant === required) return true;
  const [gModule, gAction] = grant.split(':');
  const [rModule] = required.split(':');
  return gAction === '*' && gModule === rModule;
}

export function hasPermission(grants: readonly string[], required: string): boolean {
  return grants.some((g) => permissionMatches(g, required));
}
