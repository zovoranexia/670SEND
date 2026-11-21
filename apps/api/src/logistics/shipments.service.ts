import { Injectable } from '@nestjs/common';
import { Prisma, type Shipment } from '@prisma/client';
import { SERVICE_SCHEME_META, hasPermission, toPrismaLanguage } from '@670send/types';
import { WAYBILL_REGEX } from '@670send/validation';
import { formatMoneyDb } from '@670send/pricing';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { AppException, Err } from '../common/errors';
import { LedgerService, type WalletRef } from '../ledger/ledger.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import type { Actor } from '../rbac/actor';
import { assertCanAccess, canAccess } from '../rbac/scope';
import { UploadsService } from '../storage/uploads.service';
import { newSealCode } from './codes';
import { toShipmentDto, type IntakeInput, type ShipmentView } from './dto';
import { PricingService, quoteToDto } from './pricing.service';
import { SettlementService } from './settlement.service';
import { ShipmentStateService } from './shipment-state.service';
import { WaybillService } from './waybill.service';

interface IntakeContext {
  channel: 'AGENT_DROP_OFF' | 'COURIER_PICKUP' | 'HUB_DESK';
  originCode: string;
  payer: WalletRef;
  originAgentId: string | null;
  pickupCourierId: string | null;
  originHubId: string | null;
  label: string;
}

export const SHIPMENT_INCLUDE = {
  originMunicipality: { select: { code: true, name: true } },
  destMunicipality: { select: { code: true, name: true } },
  destAgent: { select: { id: true, kioskName: true, address: true, openingHours: true } },
} satisfies Prisma.ShipmentInclude;

@Injectable()
export class ShipmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly settlement: SettlementService,
    private readonly ledger: LedgerService,
    private readonly uploads: UploadsService,
    private readonly waybills: WaybillService,
    private readonly state: ShipmentStateService,
    private readonly auth: AuthService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  /* ================================================================================== */
  /* INTAKE                                                                             */
  /* ================================================================================== */

  /**
   * Parcel intake — the single place a waybill is born. In ONE database transaction:
   * KYC + prohibited-items gate + 2 mandatory photos → price & canal → waybill number → shipment →
   * ledger posting (collector's deposit debited, shares credited) → settlement → timeline → audit.
   * If any step fails nothing is stored, no photo is burned and no money moves.
   * Retrying with the same Idempotency-Key can never create a second parcel or charge twice.
   */
  async intake(actor: Actor, input: IntakeInput, idempotencyKey: string) {
    await this.auth.verifyTransactionPin(actor.id, input.pin);

    const ctx = await this.resolveContext(actor, input);
    const meta = SERVICE_SCHEME_META[input.scheme];
    if (meta.delivery && !input.recipient.address) throw new AppException('delivery_address_required', 422);

    // ---- pick-up booking (courier only) ---------------------------------------------------------
    let booking: Prisma.PickupBookingGetPayload<object> | null = null;
    let alreadyInBatch = 0;
    if (input.pickupBookingId) {
      booking = await this.prisma.pickupBooking.findUnique({ where: { id: input.pickupBookingId } });
      if (!booking || booking.status !== 'ASSIGNED' || !actor.courierId || booking.assignedCourierId !== actor.courierId) {
        throw new AppException('booking_invalid', 422);
      }
      alreadyInBatch = await this.prisma.shipment.count({ where: { pickupBookingId: booking.id } });
    }

    // ---- price + canal (sea rule enforced inside) -------------------------------------------------
    const quote = await this.pricing.quote({
      originCode: ctx.originCode,
      destCode: input.destMunicipalityCode,
      scheme: input.scheme,
      actualWeightKg: input.parcel.actualWeightKg,
      lengthCm: input.parcel.lengthCm,
      widthCm: input.parcel.widthCm,
      heightCm: input.parcel.heightCm,
      itemCategory: input.item.category,
      isFragile: input.item.isFragile,
      isHeavyBulk: input.item.isHeavyBulk,
      declaredValue: input.item.declaredValueUsd,
      insure: input.insure,
      pickupBatch: booking ? { parcelCount: booking.parcelCount, alreadyChargedInBatch: alreadyInBatch > 0 } : undefined,
    });

    const destAgentId = await this.resolveDestAgent(quote.destMunicipalityId, input.destAgentId);
    const plan = this.settlement.plan({
      channel: ctx.channel,
      payer: ctx.payer,
      base: quote.base,
      premium: quote.premium,
      pickup: quote.pickup,
      delivery: quote.delivery,
    });
    const scopedKey = `${actor.id}:${idempotencyKey}`;

    const created = await this.prisma.$transaction(
      async (tx) => {
        const waybillNumber = await this.waybills.next(tx, quote.originCode, quote.destCode);
        const shipment = await tx.shipment.create({
          data: {
            waybillNumber,
            idempotencyKey: scopedKey,
            serviceScheme: input.scheme,
            transportCanal: quote.canal,
            intakeChannel: ctx.channel,
            originMunicipalityId: quote.originMunicipalityId,
            destMunicipalityId: quote.destMunicipalityId,
            originAgentId: ctx.originAgentId,
            destAgentId,
            originHubId: ctx.originHubId,
            pickupCourierId: ctx.pickupCourierId,
            pickupBookingId: booking?.id,
            createdById: actor.id,
            senderName: input.sender.name,
            senderIdType: input.sender.idType,
            senderIdNumber: input.sender.idNumber,
            senderPhone: input.sender.phone,
            senderLang: toPrismaLanguage(input.sender.lang),
            senderAddress: input.sender.address ?? booking?.pickupAddress,
            recipientName: input.recipient.name,
            recipientPhone: input.recipient.phone,
            recipientLang: toPrismaLanguage(input.recipient.lang),
            recipientAddress: input.recipient.address,
            itemDescription: input.item.description,
            itemCategory: input.item.category,
            isFragile: input.item.isFragile,
            isHeavyBulk: input.item.isHeavyBulk,
            isShortShelfLife: input.item.category === 'FOOD',
            prohibitedCheckPassed: true,
            prohibitedChecklist: input.prohibitedChecklist,
            prohibitedCheckLang: toPrismaLanguage(input.checklistLang),
            declaredValueUsd: input.item.declaredValueUsd,
            isInsured: quote.premium > 0n,
            insuredAmountUsd: quote.premium > 0n ? formatMoneyDb(quote.insuredAmount) : null,
            insuranceFeeUsd: formatMoneyDb(quote.premium),
            actualWeightKg: input.parcel.actualWeightKg,
            lengthCm: input.parcel.lengthCm,
            widthCm: input.parcel.widthCm,
            heightCm: input.parcel.heightCm,
            volumetricWeightKg: quote.measure.volumetricKg,
            chargeableWeightKg: quote.measure.chargeableKg,
            isDocumentTier: quote.tier === 'DOCUMENT',
            baseShippingFeeUsd: formatMoneyDb(quote.base),
            pickupAddonFeeUsd: formatMoneyDb(quote.pickup?.fee ?? 0n),
            deliveryAddonFeeUsd: formatMoneyDb(quote.delivery?.fee ?? 0n),
            totalFeeUsd: formatMoneyDb(quote.total),
            pricingSnapshot: quote.snapshot as Prisma.InputJsonObject,
            sealCode: input.sealCode ?? newSealCode(),
            status: 'DROPPED_AT_ORIGIN',
          },
        });

        // 2-photo gate: no OPEN_BOX_CONTENT + SEALED_PARCEL upload by this user → no waybill.
        await this.uploads.consumeForShipment(tx, { uploadIds: input.photoUploadIds, shipmentId: shipment.id, actorId: actor.id });

        // Money: collector's deposit debited, shares credited — same transaction.
        const posting = await this.ledger.post(
          {
            referenceType: 'SHIPMENT_INTAKE',
            referenceId: shipment.id,
            idempotencyKey: `intake:${scopedKey}`,
            description: `Intake ${waybillNumber}`,
            createdBy: actor.id,
            metadata: { waybill: waybillNumber, channel: ctx.channel, totalCollected: formatMoneyDb(plan.totalCollected) },
            lines: plan.lines,
          },
          tx,
        );
        await tx.shipmentSettlement.create({
          data: { shipmentId: shipment.id, intakeLedgerTxnId: posting.transactionId, ...plan.row },
        });

        await tx.shipmentEvent.create({
          data: {
            shipmentId: shipment.id,
            status: 'DROPPED_AT_ORIGIN',
            actorId: actor.id,
            locationLabel: ctx.label,
            meta: { channel: ctx.channel, scheme: input.scheme, canal: quote.canal, photos: input.photoUploadIds.length } as Prisma.InputJsonObject,
          },
        });

        if (booking) {
          const taken = await tx.shipment.count({ where: { pickupBookingId: booking.id } });
          if (taken >= booking.parcelCount) {
            await tx.pickupBooking.update({ where: { id: booking.id }, data: { status: 'PICKED_UP' } });
          }
        }

        await this.audit.writeInTx(tx, {
          action: 'SHIPMENT_CREATED',
          entityType: 'shipment',
          entityId: shipment.id,
          after: { waybill: waybillNumber, scheme: input.scheme, canal: quote.canal, total: formatMoneyDb(quote.total), channel: ctx.channel },
        });
        return shipment;
      },
      { timeout: 20_000, maxWait: 5_000 },
    );

    // Outside the transaction: messaging must never be able to roll the parcel back.
    await this.notifications.notifyShipment(created.id, 'DROPPED_AT_ORIGIN', ['SENDER', 'RECIPIENT']);

    const full = await this.prisma.shipment.findUniqueOrThrow({ where: { id: created.id }, include: SHIPMENT_INCLUDE });
    return { shipment: toShipmentDto(full, 'FULL'), quote: quoteToDto(quote) };
  }

  private async resolveContext(actor: Actor, input: IntakeInput): Promise<IntakeContext> {
    const meta = SERVICE_SCHEME_META[input.scheme];

    if (actor.agentId && !meta.pickup) {
      const agent = await this.prisma.agent.findUniqueOrThrow({ where: { id: actor.agentId }, include: { municipality: { select: { code: true } } } });
      return {
        channel: 'AGENT_DROP_OFF',
        originCode: agent.municipality.code,
        payer: { ownerType: 'AGENT', ownerId: agent.id, walletType: 'DEPOSIT' },
        originAgentId: agent.id,
        pickupCourierId: null,
        originHubId: null,
        label: agent.kioskName,
      };
    }
    if (actor.courierId && meta.pickup) {
      const courier = await this.prisma.courier.findUniqueOrThrow({ where: { id: actor.courierId }, include: { municipality: { select: { code: true } } } });
      return {
        channel: 'COURIER_PICKUP',
        originCode: courier.municipality.code,
        payer: { ownerType: 'COURIER', ownerId: courier.id, walletType: 'DEPOSIT' },
        originAgentId: null,
        pickupCourierId: courier.id,
        originHubId: null,
        label: `Courier ${actor.fullName}`,
      };
    }
    // Company hub desk (no agent kiosk): staff with full rights; the cash goes to the company.
    if (!actor.agentId && !actor.courierId && !meta.pickup && hasPermission(actor.permissions, 'master_bags:manage')) {
      return {
        channel: 'HUB_DESK',
        originCode: input.originMunicipalityCode ?? 'DIL',
        payer: LedgerService.systemWallet('EXTERNAL_CLEARING'),
        originAgentId: null,
        pickupCourierId: null,
        originHubId: null,
        label: 'Company hub desk',
      };
    }
    throw new AppException('scheme_not_allowed', 403);
  }

  private async resolveDestAgent(destMunicipalityId: string, requested?: string): Promise<string> {
    const agents = await this.prisma.agent.findMany({
      where: { municipalityId: destMunicipalityId, status: 'ACTIVE', deletedAt: null },
      select: { id: true },
    });
    if (requested) {
      if (!agents.some((a) => a.id === requested)) throw Err.validation([{ path: 'destAgentId', message: 'errors.validation_failed' }]);
      return requested;
    }
    if (agents.length === 0) throw new AppException('no_destination_agent', 422);
    if (agents.length > 1) throw new AppException('destination_agent_required', 422);
    return agents[0]!.id;
  }

  /* ================================================================================== */
  /* READ (scoped)                                                                      */
  /* ================================================================================== */

  viewFor(actor: Actor, s: Pick<Shipment, 'originAgentId' | 'pickupCourierId' | 'createdById'>): ShipmentView {
    if (hasPermission(actor.permissions, 'shipments:read_all')) return 'FULL';
    if (s.createdById === actor.id) return 'FULL';
    if (actor.agentId && s.originAgentId === actor.agentId) return 'FULL';
    if (actor.courierId && s.pickupCourierId === actor.courierId) return 'FULL';
    return 'DEST_ONLY';
  }

  /** Load by UUID or waybill number; strangers get 404, never 403. */
  async getScoped<I extends Prisma.ShipmentInclude>(actor: Actor, ref: string, include?: I) {
    const where: Prisma.ShipmentWhereUniqueInput = WAYBILL_REGEX.test(ref.toUpperCase()) ? { waybillNumber: ref.toUpperCase() } : { id: ref };
    if (!WAYBILL_REGEX.test(ref.toUpperCase()) && !/^[0-9a-f-]{36}$/i.test(ref)) throw Err.notFound();
    const s = await this.prisma.shipment.findUnique({ where, include: include ?? (SHIPMENT_INCLUDE as unknown as I) });
    if (!s) throw Err.notFound();
    const shipment = s as unknown as Shipment;
    assertCanAccess(
      actor,
      { agentIds: [shipment.originAgentId, shipment.destAgentId], courierIds: [shipment.pickupCourierId, shipment.deliveryCourierId] },
      'shipments:read_all',
    );
    return s;
  }

  async get(actor: Actor, ref: string) {
    const s = (await this.getScoped(actor, ref, SHIPMENT_INCLUDE)) as Shipment & Prisma.ShipmentGetPayload<{ include: typeof SHIPMENT_INCLUDE }>;
    return toShipmentDto(s, this.viewFor(actor, s));
  }

  async events(actor: Actor, ref: string) {
    const s = await this.getScoped(actor, ref, SHIPMENT_INCLUDE);
    const rows = await this.prisma.shipmentEvent.findMany({
      where: { shipmentId: (s as unknown as Shipment).id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: { actor: { select: { fullName: true } } },
    });
    return rows.map((e) => ({
      status: e.status,
      fromStatus: e.fromStatus,
      at: e.createdAt,
      location: e.locationLabel,
      notes: e.notes,
      actor: e.actor?.fullName ?? null,
    }));
  }

  async list(actor: Actor, q: { status?: string; q?: string; limit: number; before?: string }) {
    const all = hasPermission(actor.permissions, 'shipments:read_all');
    const scope: Prisma.ShipmentWhereInput[] = [];
    if (!all) {
      if (actor.agentId) scope.push({ originAgentId: actor.agentId }, { destAgentId: actor.agentId });
      if (actor.courierId) scope.push({ pickupCourierId: actor.courierId }, { deliveryCourierId: actor.courierId });
      if (scope.length === 0) return { items: [], nextBefore: null };
    }
    const statuses = q.status?.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean);
    const rows = await this.prisma.shipment.findMany({
      where: {
        ...(all ? {} : { OR: scope }),
        ...(statuses?.length ? { status: { in: statuses as never[] } } : {}),
        ...(q.before ? { createdAt: { lt: new Date(q.before) } } : {}),
        ...(q.q
          ? { OR: [{ waybillNumber: { contains: q.q.toUpperCase() } }, { senderPhone: { contains: q.q } }, { recipientPhone: { contains: q.q } }] }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
      include: SHIPMENT_INCLUDE,
    });
    const page = rows.slice(0, q.limit);
    return {
      items: page.map((s) => toShipmentDto(s, this.viewFor(actor, s))),
      nextBefore: rows.length > q.limit ? page[page.length - 1]!.createdAt.toISOString() : null,
    };
  }

  canSee(actor: Actor, s: Shipment): boolean {
    return canAccess(actor, { agentIds: [s.originAgentId, s.destAgentId], courierIds: [s.pickupCourierId, s.deliveryCourierId] }, 'shipments:read_all');
  }
}
