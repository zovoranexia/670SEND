import { useTranslations } from 'use-intl';
import { Badge, type Tone } from './ui';

const SHIPMENT_TONE: Record<string, Tone> = {
  PICKUP_ASSIGNED: 'slate',
  DROPPED_AT_ORIGIN: 'slate',
  CONSOLIDATED_AT_HUB: 'brand',
  IN_TRANSIT: 'brand',
  ARRIVED_AT_DEST_AGENT: 'accent',
  OUT_FOR_DELIVERY: 'accent',
  DELIVERED: 'green',
  ON_HOLD_ISSUE: 'red',
  RETURN_TO_SENDER: 'amber',
};

/** The 9 tracking states in the viewer's language. */
export function ShipmentStatus({ status }: { status: string }) {
  const t = useTranslations();
  return <Badge tone={SHIPMENT_TONE[status] ?? 'slate'}>{status in SHIPMENT_TONE ? t(`status.${status}.label` as 'status.IN_TRANSIT.label') : status}</Badge>;
}

const GENERIC_TONE: Record<string, Tone> = {
  ACTIVE: 'green',
  APPROVED: 'green',
  PAID: 'green',
  RESOLVED: 'green',
  COMPLETED: 'green',
  DELIVERED: 'green',
  SENT: 'brand',
  READ: 'green',
  RECEIVED: 'green',
  PENDING: 'amber',
  PENDING_APPROVAL: 'amber',
  DRAFT: 'slate',
  OPEN: 'amber',
  REQUESTED: 'amber',
  INVESTIGATING: 'amber',
  UNDER_REVIEW: 'amber',
  QUEUED: 'slate',
  READY: 'brand',
  SEALED: 'brand',
  ASSIGNED: 'brand',
  IN_TRANSIT: 'brand',
  ARRIVED: 'brand',
  DISPATCHED: 'brand',
  HANDED_OVER: 'brand',
  REJECTED: 'red',
  FAILED: 'red',
  SUSPENDED: 'red',
  TERMINATED: 'red',
  DISCREPANCY: 'red',
  CANCELLED: 'slate',
  EXPIRED: 'slate',
};

/** A status word from an admin domain (payout, manifest, claim…): label from `admin.state.<CODE>`, colour by meaning. */
export function StateBadge({ state }: { state: string }) {
  const t = useTranslations();
  return <Badge tone={GENERIC_TONE[state] ?? 'slate'}>{t(`admin.state.${state}` as 'admin.state.ACTIVE')}</Badge>;
}
