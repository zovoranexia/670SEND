import { Injectable } from '@nestjs/common';
import { Prisma, type IdType, type ShipmentStatus } from '@prisma/client';
import { SHIPMENT_STATUSES } from '@670send/types';
import { AuditService } from '../audit/audit.service';
import { AppException, Err } from '../common/errors';
import { SettlementService } from '../logistics/settlement.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import type { Actor } from '../rbac/actor';
import { storageDay } from '@670send/pricing';

/**
 * Customer-service / hub-ops tools around exceptions:
 *  • return-to-sender handling (parcel back at the Dili hub → handed to the sender), with the economics settled;
 *  • audited force-override of a tracking status (reason mandatory, never to / from DELIVERED);
 *  • manual storage reminders.
 */
@Injectable()
export class CsOpsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settlement: SettlementService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  /* ===================================== RTS queue ===================================== */

  async rtsQueue(q: { stage?: 'TO_RECEIVE' | 'AT_HUB' | 'DONE'; limit: number }) {
    const where: Prisma.ShipmentWhereInput = { status: 'RETURN_TO_SENDER' };
    if (q.stage === 'TO_RECEIVE') where.rtsReceivedAt = null;
    else if (q.stage === 'AT_HUB') Object.assign(where, { rtsReceivedAt: { not: null }, rtsHandedBackAt: null });
    else if (q.stage === 'DONE') where.rtsHandedBackAt = { not: null };
    const rows = await this.prisma.shipment.findMany({
      where,
      orderBy: { rtsFlaggedAt: 'asc' },
      take: q.limit,
      include: { destAgent: { select: { kioskName: true } }, destMunicipality: { select: { name: true } } },
    });
    return rows.map((s) => ({
      waybill: s.waybillNumber,
      flaggedAt: s.rtsFlaggedAt,
      stage: s.rtsHandedBackAt ? 'DONE' : s.rtsReceivedAt ? 'AT_HUB' : 'TO_RECEIVE',
      kiosk: s.destAgent?.kioskName ?? null,
      destination: s.destMunicipality.name,
      sender: { name: s.senderName, phone: s.senderPhone },
      unpaidStoragePenalty: s.storagePenaltyUsd.toFixed(4),
    }));
  }

  /**
   * The parcel is physically back at the Dili hub. Settlement of the failed delivery:
   *  – the fleet was already paid on arrival (it did its job);
   *  – the destination agent's 15 % is released: they received and stored the parcel for 14 days;
   *  – any accrued storage penalty is WRITTEN OFF (nobody collected it) — the platform bears it;
   *  – an unused door-delivery add-on becomes refundable by Finance.
   */
  async receiveAtHub(actor: Actor, waybill: string) {
    const s = await this.prisma.shipment.findUnique({ where: { waybillNumber: waybill.toUpperCase() } });
    if (!s) throw Err.notFound();
    if (s.status !== 'RETURN_TO_SENDER' || s.rtsReceivedAt) throw new AppException('rts_invalid', 409);
    await this.prisma.$transaction(async (tx) => {
      await tx.shipment.update({ where: { id: s.id }, data: { rtsReceivedAt: new Date(), version: { increment: 1 } } });
      await tx.shipmentEvent.create({
        data: { shipmentId: s.id, fromStatus: 'RETURN_TO_SENDER', status: 'RETURN_TO_SENDER', actorId: actor.id, locationLabel: 'Hub Dili', notes: 'Returned parcel received at the Dili hub', meta: { kind: 'RTS_RECEIVED_AT_HUB' } },
      });
      await this.settlement.releaseDestinationShares(tx, { id: s.id, destAgentId: s.destAgentId, deliveryCourierId: s.deliveryCourierId }, actor.id);
      await this.audit.writeInTx(tx, { action: 'RTS_RECEIVED_AT_HUB', entityType: 'shipment', entityId: s.id, after: { writtenOffStoragePenalty: s.storagePenaltyUsd.toFixed(4) } });
    });
    return { waybill: s.waybillNumber, stage: 'AT_HUB' as const };
  }

  /** Handed back to the sender: the collector must present the sender's ID (or be recorded as a representative). */
  async handBack(actor: Actor, waybill: string, input: { collectorName: string; idType: IdType; idNumber: string; isRepresentative: boolean }) {
    const s = await this.prisma.shipment.findUnique({ where: { waybillNumber: waybill.toUpperCase() } });
    if (!s) throw Err.notFound();
    if (s.status !== 'RETURN_TO_SENDER' || !s.rtsReceivedAt || s.rtsHandedBackAt) throw new AppException('rts_invalid', 409);
    const norm = (v: string) => v.replace(/\s+/g, '').toUpperCase();
    if (!input.isRepresentative && norm(input.idNumber) !== norm(s.senderIdNumber)) throw new AppException('invalid_otp', 422);
    await this.prisma.$transaction(async (tx) => {
      await tx.shipment.update({ where: { id: s.id }, data: { rtsHandedBackAt: new Date(), rtsCollectorName: input.collectorName, rtsCollectorIdNumber: input.idNumber, version: { increment: 1 } } });
      await tx.shipmentEvent.create({
        data: { shipmentId: s.id, fromStatus: 'RETURN_TO_SENDER', status: 'RETURN_TO_SENDER', actorId: actor.id, locationLabel: 'Hub Dili', notes: `Returned to ${input.collectorName}`, meta: { kind: 'RTS_HANDED_BACK', representative: input.isRepresentative } },
      });
      await this.audit.writeInTx(tx, { action: 'RTS_HANDED_BACK', entityType: 'shipment', entityId: s.id, after: { collector: input.collectorName, idType: input.idType, representative: input.isRepresentative } });
    });
    return { waybill: s.waybillNumber, stage: 'DONE' as const };
  }

  /* ================================ status force-override ================================ */

  /**
   * Last-resort correction by a Super Admin (route is @AuditReasonRequired — the reason lands in the audit
   * row). It changes the tracking status only; it never moves money, and DELIVERED (money released) is out
   * of bounds in both directions.
   */
  async overrideStatus(actor: Actor, waybill: string, to: ShipmentStatus, notes?: string) {
    if (!SHIPMENT_STATUSES.includes(to)) throw Err.validation([{ path: 'status', message: 'errors.validation_failed' }]);
    const s = await this.prisma.shipment.findUnique({ where: { waybillNumber: waybill.toUpperCase() } });
    if (!s) throw Err.notFound();
    if (s.status === to) throw new AppException('shipment_wrong_state', 409);
    if (s.status === 'DELIVERED' || to === 'DELIVERED') throw new AppException('override_not_allowed', 422);

    await this.prisma.$transaction(async (tx) => {
      await tx.shipment.update({
        where: { id: s.id },
        data: {
          status: to,
          version: { increment: 1 },
          statusBeforeHold: to === 'ON_HOLD_ISSUE' ? s.status : null,
          holdReason: to === 'ON_HOLD_ISSUE' ? 'ADMIN_OVERRIDE' : null,
        },
      });
      await tx.shipmentEvent.create({
        data: { shipmentId: s.id, fromStatus: s.status, status: to, actorId: actor.id, notes: notes ?? 'Status overridden by administrator', meta: { override: true } },
      });
      await this.audit.writeInTx(tx, { action: 'SHIPMENT_STATUS_OVERRIDDEN', entityType: 'shipment', entityId: s.id, before: { status: s.status }, after: { status: to } });
    });
    return { waybill: s.waybillNumber, status: to };
  }

  /* ================================== manual reminders ================================== */

  /** CS nudges a recipient (and sender) about a parcel waiting at the kiosk — localized, deduplicated per click. */
  async sendStorageReminder(actor: Actor, waybill: string, kind: 'DAY3' | 'DAY5') {
    const s = await this.prisma.shipment.findUnique({ where: { waybillNumber: waybill.toUpperCase() } });
    if (!s) throw Err.notFound();
    if (s.status !== 'ARRIVED_AT_DEST_AGENT' || !s.arrivedDestAt) throw new AppException('shipment_wrong_state', 409);
    const day = storageDay(s.arrivedDestAt, new Date());
    await this.notifications.notifyShipment(
      s.id,
      kind === 'DAY3' ? 'STORAGE_REMINDER_DAY3' : 'STORAGE_REMINDER_DAY5',
      ['RECIPIENT', 'SENDER'],
      { daysLeft: Math.max(0, 6 - day), dailyFee: '0.50' },
      `:manual:${Date.now()}`,
    );
    await this.audit.write({ action: 'STORAGE_REMINDER_SENT', entityType: 'shipment', entityId: s.id, actorId: actor.id, after: { kind } });
    return { waybill: s.waybillNumber, sent: true, storageDay: day };
  }
}
