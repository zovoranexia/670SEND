import { Injectable } from '@nestjs/common';
import type { Prisma, Shipment, ShipmentStatus } from '@prisma/client';
import { AppException, Err } from '../common/errors';

/**
 * Allowed tracking transitions (SOP §1.5). Anything else is refused — a parcel cannot be
 * "delivered" from IN_TRANSIT, nor leave DELIVERED / RETURN_TO_SENDER.
 */
export const ALLOWED_TRANSITIONS: Record<ShipmentStatus, readonly ShipmentStatus[]> = {
  PICKUP_ASSIGNED: ['DROPPED_AT_ORIGIN'],
  DROPPED_AT_ORIGIN: ['CONSOLIDATED_AT_HUB', 'ON_HOLD_ISSUE'],
  CONSOLIDATED_AT_HUB: ['IN_TRANSIT', 'ON_HOLD_ISSUE'],
  IN_TRANSIT: ['ARRIVED_AT_DEST_AGENT', 'ON_HOLD_ISSUE'],
  ARRIVED_AT_DEST_AGENT: ['OUT_FOR_DELIVERY', 'DELIVERED', 'ON_HOLD_ISSUE', 'RETURN_TO_SENDER'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'ARRIVED_AT_DEST_AGENT', 'ON_HOLD_ISSUE'],
  // A held parcel resumes where it was, or is sent back.
  ON_HOLD_ISSUE: ['CONSOLIDATED_AT_HUB', 'IN_TRANSIT', 'ARRIVED_AT_DEST_AGENT', 'RETURN_TO_SENDER'],
  DELIVERED: [],
  RETURN_TO_SENDER: [],
};

export interface TransitionOptions {
  /** Extra guard: the current status must be one of these (in addition to the state machine). */
  from?: ShipmentStatus[];
  actorId?: string | null;
  notes?: string;
  meta?: Record<string, unknown>;
  locationLabel?: string;
  lat?: number;
  lng?: number;
  /** Additional columns to set atomically with the status change. */
  data?: Prisma.ShipmentUncheckedUpdateManyInput;
}

@Injectable()
export class ShipmentStateService {
  /**
   * Move a shipment to a new status inside the caller's transaction:
   *  1. validates the transition against the state machine;
   *  2. updates with an optimistic-lock (`version`) so two concurrent scans cannot both win;
   *  3. appends one immutable shipment_events row.
   */
  async transition(
    tx: Prisma.TransactionClient,
    shipmentId: string,
    to: ShipmentStatus,
    opts: TransitionOptions = {},
  ): Promise<Shipment> {
    const current = await tx.shipment.findUnique({ where: { id: shipmentId } });
    if (!current) throw Err.notFound();
    if (!ALLOWED_TRANSITIONS[current.status].includes(to) || (opts.from && !opts.from.includes(current.status))) {
      throw new AppException('shipment_wrong_state', 409);
    }

    const leavingHold = current.status === 'ON_HOLD_ISSUE';
    const result = await tx.shipment.updateMany({
      where: { id: shipmentId, status: current.status, version: current.version },
      data: {
        ...(opts.data ?? {}),
        status: to,
        version: { increment: 1 },
        ...(to === 'ON_HOLD_ISSUE' ? { statusBeforeHold: current.status } : {}),
        ...(leavingHold ? { statusBeforeHold: null, holdReason: null } : {}),
      },
    });
    if (result.count !== 1) throw new AppException('shipment_wrong_state', 409);

    await tx.shipmentEvent.create({
      data: {
        shipmentId,
        fromStatus: current.status,
        status: to,
        actorId: opts.actorId ?? null,
        notes: opts.notes,
        locationLabel: opts.locationLabel,
        lat: opts.lat,
        lng: opts.lng,
        meta: (opts.meta ?? undefined) as Prisma.InputJsonObject | undefined,
      },
    });
    return tx.shipment.findUniqueOrThrow({ where: { id: shipmentId } });
  }

  /** Append an informational event without changing status (failed delivery attempt, OTP re-sent…). */
  async note(
    tx: Prisma.TransactionClient,
    shipmentId: string,
    status: ShipmentStatus,
    opts: { actorId?: string | null; notes?: string; meta?: Record<string, unknown>; locationLabel?: string },
  ): Promise<void> {
    await tx.shipmentEvent.create({
      data: {
        shipmentId,
        fromStatus: status,
        status,
        actorId: opts.actorId ?? null,
        notes: opts.notes,
        locationLabel: opts.locationLabel,
        meta: (opts.meta ?? undefined) as Prisma.InputJsonObject | undefined,
      },
    });
  }
}
