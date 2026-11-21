import { Injectable } from '@nestjs/common';
import type { IdType } from '@prisma/client';
import { SERVICE_SCHEME_META } from '@670send/types';
import { WAYBILL_REGEX } from '@670send/validation';
import { formatMoneyDb, parseMoney, storageDay, storagePenaltyForDay } from '@670send/pricing';
import { AuditService } from '../audit/audit.service';
import { AppException, Err } from '../common/errors';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import type { Actor } from '../rbac/actor';
import type { WalletRef } from '../ledger/ledger.service';
import { OtpService } from './otp.service';
import { SettlementService } from './settlement.service';
import { ShipmentStateService } from './shipment-state.service';
import { UploadsService } from '../storage/uploads.service';

export interface PodInput {
  waybill: string;
  otp: string;
  collector: { name: string; idType: IdType; idNumber: string; isRepresentative: boolean };
  /** PROOF_OF_DELIVERY staged photo: recipient holding the parcel with the QR label visible. */
  photoUploadId: string;
  /** The handing-over person confirms they collected the storage fee shown by /storage-fee. */
  storagePenaltyCollected: boolean;
}

@Injectable()
export class DeliveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly state: ShipmentStateService,
    private readonly otp: OtpService,
    private readonly settlement: SettlementService,
    private readonly uploads: UploadsService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  /** The hand-over actor for this shipment: destination agent (kiosk pick-up) or the delivery courier (door). */
  private async loadForHandover(actor: Actor, ref: string) {
    const waybill = ref.toUpperCase();
    if (!WAYBILL_REGEX.test(waybill)) throw Err.notFound();
    const s = await this.prisma.shipment.findUnique({ where: { waybillNumber: waybill } });
    if (!s) throw Err.notFound();
    const asAgent = actor.agentId && s.destAgentId === actor.agentId && s.status === 'ARRIVED_AT_DEST_AGENT';
    const asCourier = actor.courierId && s.deliveryCourierId === actor.courierId && s.status === 'OUT_FOR_DELIVERY';
    if (!asAgent && !asCourier) {
      // Right person but wrong moment (e.g. parcel not arrived yet) is a state error; a stranger gets 404.
      const related = (actor.agentId && s.destAgentId === actor.agentId) || (actor.courierId && s.deliveryCourierId === actor.courierId);
      throw related ? new AppException('shipment_wrong_state', 409) : Err.notFound();
    }
    const collector: WalletRef = asAgent
      ? { ownerType: 'AGENT', ownerId: actor.agentId!, walletType: 'DEPOSIT' }
      : { ownerType: 'COURIER', ownerId: actor.courierId!, walletType: 'DEPOSIT' };
    return { s, collector, mode: asAgent ? ('KIOSK' as const) : ('DOOR' as const) };
  }

  /** What the recipient owes for storage today (free for 5 days, then USD 0.50 / day up to Day 14). */
  async storageFee(actor: Actor, ref: string, now = new Date()) {
    const { s } = await this.loadForHandover(actor, ref);
    const day = s.arrivedDestAt ? storageDay(s.arrivedDestAt, now) : 1;
    const due = storagePenaltyForDay(day);
    return { waybill: s.waybillNumber, storageDay: day, freeDays: 5, penalty: { usd: formatMoneyDb(due) }, currency: 'USD' };
  }

  /**
   * Proof of delivery: recipient (or an authorised representative) presents ID + reads the 6-digit OTP.
   * Verified OTP + collector identity + PoD photo → DELIVERED, and the money is released:
   * destination agent 15 % (and delivery courier's add-on share), storage penalty collected and split 70/30.
   */
  async verifyPod(actor: Actor, input: PodInput, now = new Date()) {
    const { s, collector, mode } = await this.loadForHandover(actor, input.waybill);

    await this.otp.verify(s.id, input.otp, now); // counts wrong guesses even if we abort below

    const day = s.arrivedDestAt ? storageDay(s.arrivedDestAt, now) : 1;
    const penalty = storagePenaltyForDay(day);
    if (penalty > 0n && !input.storagePenaltyCollected) throw new AppException('storage_fee_unpaid', 422);

    await this.prisma.$transaction(async (tx) => {
      await this.uploads.consumeForShipment(tx, {
        uploadIds: [input.photoUploadId],
        shipmentId: s.id,
        actorId: actor.id,
        required: ['PROOF_OF_DELIVERY'],
      });
      const total = parseMoney(s.totalFeeUsd.toFixed(4)) + penalty;
      await this.state.transition(tx, s.id, 'DELIVERED', {
        from: [mode === 'KIOSK' ? 'ARRIVED_AT_DEST_AGENT' : 'OUT_FOR_DELIVERY'],
        actorId: actor.id,
        locationLabel: mode === 'KIOSK' ? 'Destination kiosk' : 'Recipient address',
        meta: { mode, storageDay: day, representative: input.collector.isRepresentative },
        data: {
          deliveredAt: now,
          collectorName: input.collector.name,
          collectorIdType: input.collector.idType,
          collectorIdNumber: input.collector.idNumber,
          collectedByRepresentative: input.collector.isRepresentative,
          storagePenaltyUsd: formatMoneyDb(penalty),
          totalFeeUsd: formatMoneyDb(total),
          pickupOtpHash: null,
          pickupOtpExpiresAt: null,
          pickupOtpAttempts: 0,
          pickupOtpLockedUntil: null,
        },
      });
      if (penalty > 0n) await this.settlement.collectStoragePenalty(tx, { shipmentId: s.id, amount: penalty, collector, actorId: actor.id });
      await this.settlement.releaseDestinationShares(tx, { id: s.id, destAgentId: s.destAgentId, deliveryCourierId: s.deliveryCourierId }, actor.id);
      await this.audit.writeInTx(tx, {
        action: 'SHIPMENT_DELIVERED',
        entityType: 'shipment',
        entityId: s.id,
        after: { mode, collector: input.collector.name, idType: input.collector.idType, penalty: formatMoneyDb(penalty) },
      });
    });

    await this.notifications.notifyShipment(s.id, 'DELIVERED', ['SENDER', 'RECIPIENT']);
    return { waybill: s.waybillNumber, status: 'DELIVERED' as const, deliveredAt: now, storagePenalty: { usd: formatMoneyDb(penalty) } };
  }

  /** Re-issue the pickup code (the old one is invalidated; we only store a hash, so it cannot be "re-read"). */
  async resendOtp(actor: Actor, ref: string) {
    const { s } = await this.loadForHandover(actor, ref);
    const otp = await this.prisma.$transaction(async (tx) => {
      const code = await this.otp.issue(tx, s.id);
      await this.state.note(tx, s.id, s.status, { actorId: actor.id, notes: 'Pickup OTP re-sent', meta: { kind: 'OTP_RESENT' } });
      await this.audit.writeInTx(tx, { action: 'OTP_RESENT', entityType: 'shipment', entityId: s.id });
      return code;
    });
    await this.notifications.notifyShipment(s.id, 'ARRIVED_AT_DEST_AGENT', ['RECIPIENT'], { otp }, `:resend:${Date.now()}`);
    return { sent: true };
  }

  /* ----------------------------- last-mile (Schemes C / D) ----------------------------- */

  /** A local courier takes a parcel out for delivery to the recipient's address (radius ≤ 5 km from the kiosk). */
  async startDelivery(actor: Actor, ref: string) {
    if (!actor.courierId) throw Err.forbidden();
    const waybill = ref.toUpperCase();
    const s = await this.prisma.shipment.findUnique({ where: { waybillNumber: waybill }, include: { destMunicipality: true } });
    if (!s) throw Err.notFound();
    const courier = await this.prisma.courier.findUniqueOrThrow({ where: { id: actor.courierId } });
    if (courier.municipalityId !== s.destMunicipalityId) throw Err.notFound(); // not your area
    if (!SERVICE_SCHEME_META[s.serviceScheme].delivery) throw new AppException('delivery_not_allowed', 422);
    if (!s.recipientAddress) throw new AppException('delivery_address_required', 422);

    await this.prisma.$transaction(async (tx) => {
      await this.state.transition(tx, s.id, 'OUT_FOR_DELIVERY', {
        from: ['ARRIVED_AT_DEST_AGENT'],
        actorId: actor.id,
        locationLabel: `Courier ${actor.fullName}`,
        data: { deliveryCourierId: actor.courierId },
      });
      await this.audit.writeInTx(tx, { action: 'DELIVERY_STARTED', entityType: 'shipment', entityId: s.id });
    });
    await this.notifications.notifyShipment(s.id, 'OUT_FOR_DELIVERY', ['RECIPIENT'], {}, `:${s.deliveryAttempts}`);
    return { waybill: s.waybillNumber, status: 'OUT_FOR_DELIVERY' as const };
  }

  /**
   * Recipient not at home. After the 2nd failed attempt the parcel returns to the destination agent
   * for self pick-up (SOP §2.2); the recipient's existing OTP stays valid.
   */
  async deliveryFailed(actor: Actor, ref: string, notes?: string) {
    const s = await this.prisma.shipment.findUnique({ where: { waybillNumber: ref.toUpperCase() } });
    if (!s || !actor.courierId || s.deliveryCourierId !== actor.courierId) throw Err.notFound();
    if (s.status !== 'OUT_FOR_DELIVERY') throw new AppException('shipment_wrong_state', 409);
    const attempts = s.deliveryAttempts + 1;

    return this.prisma.$transaction(async (tx) => {
      if (attempts >= 2) {
        await this.state.transition(tx, s.id, 'ARRIVED_AT_DEST_AGENT', {
          from: ['OUT_FOR_DELIVERY'],
          actorId: actor.id,
          notes: notes ?? 'Recipient not available — back to destination agent for self pick-up',
          meta: { kind: 'DELIVERY_ATTEMPT_FAILED', attempts },
          data: { deliveryAttempts: attempts, deliveryCourierId: null },
        });
        return { waybill: s.waybillNumber, status: 'ARRIVED_AT_DEST_AGENT' as const, attempts, returnedToAgent: true };
      }
      await tx.shipment.update({ where: { id: s.id }, data: { deliveryAttempts: attempts } });
      await this.state.note(tx, s.id, 'OUT_FOR_DELIVERY', { actorId: actor.id, notes, meta: { kind: 'DELIVERY_ATTEMPT_FAILED', attempts } });
      return { waybill: s.waybillNumber, status: 'OUT_FOR_DELIVERY' as const, attempts, returnedToAgent: false };
    });
  }
}
