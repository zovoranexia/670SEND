import type { ComponentType, SVGProps } from 'react';
import { hasPermission } from '@670send/types';
import { IconAccess, IconAudit, IconClaims, IconDashboard, IconHub, IconPartners, IconTariff, IconTemplate, IconTruck, IconWallet } from '@/components/icons';

export type NavKey = 'dashboard' | 'shipments' | 'hubs' | 'partners' | 'finance' | 'claims' | 'tariffs' | 'templates' | 'rbac' | 'audit';

export interface NavItem {
  key: NavKey;
  to: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** The screen opens when the user holds ANY of these permissions; inside, each tab/button checks its own. */
  anyOf: readonly string[];
}

/** One entry per back-office area. The order is the order of the sidebar. */
export const NAV: readonly NavItem[] = [
  { key: 'dashboard', to: '/', Icon: IconDashboard, anyOf: ['dashboard:view'] },
  { key: 'shipments', to: '/shipments', Icon: IconTruck, anyOf: ['shipments:read_all'] },
  { key: 'hubs', to: '/hubs', Icon: IconHub, anyOf: ['hubs:read', 'master_bags:read', 'manifests:read', 'pickups:read'] },
  { key: 'partners', to: '/partners', Icon: IconPartners, anyOf: ['agents:read', 'couriers:read', 'fleet_partners:read', 'vehicles:read', 'drivers:read'] },
  { key: 'finance', to: '/finance', Icon: IconWallet, anyOf: ['deposits:read', 'wallets:read_all', 'ledger:read', 'payouts:read', 'reconciliation:run'] },
  { key: 'claims', to: '/claims', Icon: IconClaims, anyOf: ['claims:read', 'incidents:read', 'rts:manage'] },
  { key: 'tariffs', to: '/tariffs', Icon: IconTariff, anyOf: ['tariffs:read'] },
  { key: 'templates', to: '/templates', Icon: IconTemplate, anyOf: ['templates:manage', 'notification_logs:read'] },
  { key: 'rbac', to: '/access', Icon: IconAccess, anyOf: ['rbac:manage', 'users:manage'] },
  { key: 'audit', to: '/audit', Icon: IconAudit, anyOf: ['audit:read'] },
];

export const canOpen = (permissions: readonly string[], item: NavItem) => item.anyOf.some((p) => hasPermission(permissions, p));

/** The areas this user may open (a Super Admin's `*:*` opens all of them). */
export const navFor = (permissions: readonly string[]) => NAV.filter((i) => canOpen(permissions, i));
