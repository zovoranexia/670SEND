import { Injectable } from '@nestjs/common';
import type { InboundCondition, Prisma } from '@prisma/client';
import { WAYBILL_REGEX } from '@670send/validation';
import { AuditService } from '../audit/audit.service';
import { AppException, Err } from '../common/errors';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import type { Actor } from '../rbac/actor';
import { ManifestsService } from './manifests.service';
import { OtpService } from './otp.service';
import { SettlementService } from './settlement.service';
import { ShipmentStateService } from './shipment-state.service';

export interface InboundScanInput {
  /** Waybill number or master-bag QR code. */
  code: string;
  condition: InboundCondition;
  notes?: string;
  /** Required unless the condition is INTACT. */
  incidentPhotoUploadIds?: string[];
  /** Bag scans: parcels the bag manifest lists but that are physically absent. */
  missingWaybills?: string[];
}

interface PendingNotice {
  shipmentId: string;
  kind: 'ARRIVED' | 'HOLD';
  otp?: string;
}

@Injectable()
export class InboundService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly state: ShipmentStateService,
    private readonly otp: OtpService,
    private readonly settlement: SettlementService,
    private readonly manifests: ManifestsService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Destination inbound scan, performed by the destination agent IN FRONT OF THE DRIVER.
   *  INTACT  → ARRIVED_AT_DEST_AGENT, a 6-digit pickup OTP is generated (stored only as an HMAC) and
   *            WhatsApp'd to the recipient in their language; the fleet's 40 % is released to its owner.
   *  other   → ON_HOLD_ISSUE with mandatory incident photos; the DRIVER must confirm the incident
   *            digitally before the trip can be closed.
   */
  async scan(actor: Actor, input: InboundScanInput) {
    if (!actor.agentId) throw Err.notFound();
    const code = input.code.trim().toUpperCase();
    const notices: PendingNotice[] = [];

    const result = WAYBILL_REGEX.test(code)
      ? await this.scanParcel(actor, code, input, notices)
      : await this.scanBag(actor, code, input, notices);

    // After commit: customer messages. OTPs go out only now, never inside the transaction.
    for (const n of notices) {
      if (n.kind === 'ARRIVED') await this.notifications.notifyShipment(n.shipmentId, 'ARRIVED_AT_DEST_AGENT', ['RECIPIENT'], { otp: n.otp });
      else await this.notifications.notifyShipment(n.shipmentId, 'ON_HOLD_ISSUE', ['SENDER', 'RECIPIENT'], {}, `:${Date.now()}`);
    }
    return result;
  }

  /* --------------------------------- loose parcel --------------------------------- */

  private async scanParcel(actor: Actor, waybill: string, input: InboundScanInput, notices: PendingNotice[]) {
    const s = await this.prisma.shipment.findUnique({ where: { waybillNumber: waybill }, include: { masterBagItem: true } });
    if (!s || s.destAgentId !== actor.agentId) throw Err.notFound();
    if (s.status !== 'IN_TRANSIT') throw new AppException('shipment_wrong_state', 409);
    if (s.masterBagItem) throw new AppException('master_bag_invalid', 422); // parcels in a bag are received by scanning the bag

    const item = await this.prisma.manifestItem.findFirst({
      where: { shipmentId: s.id, manifest: { status: { in: ['IN_TRANSIT', 'ARRIVED'] } } },
      include: { manifest: true },
    });
    if (!item) throw new AppException('manifest_invalid', 422);
    if (input.condition !== 'INTACT') this.requirePhotos(input);

    const out = await this.prisma.$transaction(async (tx) => {
      let incidentId: string | undefined;
      if (input.condition === 'INTACT') {
        const otp = await this.arrive(tx, s.id, actor);
        notices.push({ shipmentId: s.id, kind: 'ARRIVED', otp });
      } else {
        incidentId = await this.holdWithIncident(tx, actor, {
          shipmentIds: [s.id],
          manifestId: item.manifestId,
          driverId: item.manifest.driverId,
          masterBagId: null,
          condition: input.condition,
          notes: input.notes,
          uploadIds: input.incidentPhotoUploadIds!,
          notices,
        }).then((ids) => ids[0]);
      }
      await tx.manifestItem.update({ where: { id: item.id }, data: { inboundCondition: input.condition, inboundAt: new Date(), inboundBy: actor.id } });
      await this.manifests.refreshCompletion(tx, item.manifestId);
      await this.audit.writeInTx(tx, { action: 'INBOUND_SCAN', entityType: 'shipment', entityId: s.id, after: { condition: input.condition, incidentId } });
      const m = await tx.manifest.findUniqueOrThrow({ where: { id: item.manifestId }, select: { status: true, manifestCode: true } });
      return { incidentId, manifest: m };
    });

    const fresh = await this.prisma.shipment.findUniqueOrThrow({ where: { id: s.id }, select: { status: true } });
    return {
      processed: [{ waybill, status: fresh.status }],
      incidents: out.incidentId ? [{ id: out.incidentId, waybill, condition: input.condition }] : [],
      driverConfirmationRequired: input.condition !== 'INTACT',
      manifest: out.manifest,
    };
  }

  /* ----------------------------------- master bag ----------------------------------- */

  private async scanBag(actor: Actor, bagCode: string, input: InboundScanInput, notices: PendingNotice[]) {
    const bag = await this.prisma.masterBag.findUnique({ where: { bagCode }, include: { items: { include: { shipment: true } } } });
    if (!bag || bag.items.length === 0 || bag.items.some((i) => i.shipment.destAgentId !== actor.agentId)) throw Err.notFound();
    if (bag.status !== 'DISPATCHED') throw new AppException('shipment_wrong_state', 409);

    const item = await this.prisma.manifestItem.findFirst({
      where: { masterBagId: bag.id, manifest: { status: { in: ['IN_TRANSIT', 'ARRIVED'] } } },
      include: { manifest: true },
    });
    if (!item) throw new AppException('manifest_invalid', 422);

    const missing = new Set((input.missingWaybills ?? []).map((w) => w.toUpperCase()));
    const inBag = new Set(bag.items.map((i) => i.shipment.waybillNumber));
    if ([...missing].some((w) => !inBag.has(w))) throw Err.validation([{ path: 'missingWaybills', message: 'errors.validation_failed' }]);
    const wholeBagBad = input.condition !== 'INTACT';
    if (wholeBagBad || missing.size > 0) this.requirePhotos(input);

    const processed: Array<{ waybill: string; status: string }> = [];
    const incidents: Array<{ id: string; waybill: string; condition: InboundCondition }> = [];

    const manifestInfo = await this.prisma.$transaction(async (tx) => {
      const holdIds: string[] = [];
      for (const i of bag.items) {
        const wb = i.shipment.waybillNumber;
        if (!wholeBagBad && !missing.has(wb)) {
          const otp = await this.arrive(tx, i.shipmentId, actor);
          notices.push({ shipmentId: i.shipmentId, kind: 'ARRIVED', otp });
          processed.push({ waybill: wb, status: 'ARRIVED_AT_DEST_AGENT' });
        } else {
          holdIds.push(i.shipmentId);
          processed.push({ waybill: wb, status: 'ON_HOLD_ISSUE' });
        }
      }
      if (holdIds.length > 0) {
        const condition: InboundCondition = wholeBagBad ? input.condition : 'MISSING';
        const ids = await this.holdWithIncident(tx, actor, {
          shipmentIds: holdIds,
          manifestId: item.manifestId,
          driverId: item.manifest.driverId,
          masterBagId: bag.id,
          condition,
          notes: input.notes,
          uploadIds: input.incidentPhotoUploadIds!,
          notices,
        });
        holdIds.forEach((sid, idx) => {
          const wb = bag.items.find((b) => b.shipmentId === sid)!.shipment.waybillNumber;
          incidents.push({ id: ids[idx]!, waybill: wb, condition });
        });
      }
      const bagOk = !wholeBagBad && missing.size === 0;
      await tx.masterBag.update({ where: { id: bag.id }, data: { status: bagOk ? 'RECEIVED' : 'DISCREPANCY', receivedAt: new Date() } });
      await tx.manifestItem.update({
        where: { id: item.id },
        data: { inboundCondition: wholeBagBad ? input.condition : missing.size > 0 ? 'MISSING' : 'INTACT', inboundAt: new Date(), inboundBy: actor.id },
      });
      await this.manifests.refreshCompletion(tx, item.manifestId);
      await this.audit.writeInTx(tx, {
        action: 'INBOUND_SCAN_BAG',
        entityType: 'master_bag',
        entityId: bag.id,
        after: { condition: input.condition, parcels: bag.items.length, held: holdIds.length },
      });
      return tx.manifest.findUniqueOrThrow({ where: { id: item.manifestId }, select: { status: true, manifestCode: true } });
    });

    return { processed, incidents, driverConfirmationRequired: incidents.length > 0, manifest: manifestInfo };
  }

  /* -------------------------------------- core -------------------------------------- */

  private requirePhotos(input: InboundScanInput): void {
    if (!input.incidentPhotoUploadIds || input.incidentPhotoUploadIds.length === 0) throw new AppException('incident_photo_required', 422);
  }

  /** IN_TRANSIT → ARRIVED_AT_DEST_AGENT, issue the OTP, release the fleet's 40 %. Returns the clear OTP. */
  private async arrive(tx: Prisma.TransactionClient, shipmentId: string, actor: Actor): Promise<string> {
    const now = new Date();
    await this.state.transition(tx, shipmentId, 'ARRIVED_AT_DEST_AGENT', {
      from: ['IN_TRANSIT', 'ON_HOLD_ISSUE'],
      actorId: actor.id,
      data: { arrivedDestAt: now },
      meta: { seal: 'intact' },
    });
    const otp = await this.otp.issue(tx, shipmentId, now);
    await this.settlement.releaseFleetShare(tx, shipmentId, actor.id);
    return otp;
  }

  /**
   * Put parcels ON_HOLD with one incident each; the same evidence photos are attached to every
   * affected parcel (they show the shared damaged bag / wet compartment).
   */
  private async holdWithIncident(
    tx: Prisma.TransactionClient,
    actor: Actor,
    a: {
      shipmentIds: string[];
      manifestId: string;
      driverId: string;
      masterBagId: string | null;
      condition: InboundCondition;
      notes?: string;
      uploadIds: string[];
      notices: PendingNotice[];
    },
  ): Promise<string[]> {
    const ids = [...new Set(a.uploadIds)];
    const uploads = await tx.stagedUpload.findMany({ where: { id: { in: ids }, uploadedBy: actor.id, consumedAt: null, photoType: 'INBOUND_INCIDENT' } });
    if (uploads.length !== ids.length) throw new AppException('incident_photo_required', 422);
    const claimed = await tx.stagedUpload.updateMany({
      where: { id: { in: ids }, consumedAt: null },
      data: { consumedAt: new Date(), consumedByShipmentId: a.shipmentIds[0] },
    });
    if (claimed.count !== ids.length) throw Err.uploadNotFound();

    const incidentIds: string[] = [];
    for (const shipmentId of a.shipmentIds) {
      await this.state.transition(tx, shipmentId, 'ON_HOLD_ISSUE', {
        from: ['IN_TRANSIT'],
        actorId: actor.id,
        notes: a.notes,
        meta: { condition: a.condition, manifestId: a.manifestId },
        data: { holdReason: a.condition },
      });
      await tx.shipmentPhoto.createMany({
        data: uploads.map((u) => ({
          shipmentId,
          photoType: 'INBOUND_INCIDENT' as const,
          fileUrl: u.fileUrl,
          mimeType: u.mimeType,
          sizeBytes: u.sizeBytes,
          sha256: u.sha256,
          lat: u.lat,
          lng: u.lng,
          uploadedBy: u.uploadedBy,
        })),
      });
      const inc = await tx.inboundIncident.create({
        data: {
          shipmentId,
          manifestId: a.manifestId,
          masterBagId: a.masterBagId,
          condition: a.condition,
          notes: a.notes,
          reportedBy: actor.id,
          driverId: a.driverId,
        },
        select: { id: true },
      });
      incidentIds.push(inc.id);
      a.notices.push({ shipmentId, kind: 'HOLD' });
    }
    return incidentIds;
  }

  /* ----------------------------------- incidents ----------------------------------- */

  /** The driver confirms the incident digitally (their own login) — required to close the trip. */
  async driverConfirm(actor: Actor, incidentId: string) {
    const inc = await this.prisma.inboundIncident.findUnique({ where: { id: incidentId } });
    if (!inc || !actor.driverId || inc.driverId !== actor.driverId) throw Err.notFound();
    if (inc.driverConfirmedAt) return this.incidentDto(inc.id);
    await this.prisma.$transaction(async (tx) => {
      await tx.inboundIncident.update({ where: { id: inc.id }, data: { driverConfirmedAt: new Date() } });
      if (inc.manifestId) await this.manifests.refreshCompletion(tx, inc.manifestId);
      await this.audit.writeInTx(tx, { action: 'INCIDENT_DRIVER_CONFIRMED', entityType: 'inbound_incident', entityId: inc.id });
    });
    return this.incidentDto(inc.id);
  }

  async incidentDto(id: string) {
    const i = await this.prisma.inboundIncident.findUniqueOrThrow({
      where: { id },
      include: { shipment: { select: { waybillNumber: true, status: true } } },
    });
    return {
      id: i.id,
      waybill: i.shipment.waybillNumber,
      shipmentStatus: i.shipment.status,
      condition: i.condition,
      status: i.status,
      notes: i.notes,
      driverConfirmedAt: i.driverConfirmedAt,
      resolutionNotes: i.resolutionNotes,
      createdAt: i.createdAt,
    };
  }

  async listIncidents(status?: string) {
    const rows = await this.prisma.inboundIncident.findMany({
      where: status ? { status: status as never } : {},
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { id: true },
    });
    return Promise.all(rows.map((r) => this.incidentDto(r.id)));
  }

  /**
   * CS / Ops decision on a held parcel.
   *  RELEASE_TO_RECIPIENT  parcel goes on to the recipient (OTP issued). `fleetLiable=false` also releases
   *                        the fleet's 40 %; by default it stays held pending the claim decision (Phase 4).
   *  RETURN_TO_SENDER      parcel is sent back.
   */
  async resolve(actor: Actor, incidentId: string, input: { resolution: 'RELEASE_TO_RECIPIENT' | 'RETURN_TO_SENDER'; notes: string; fleetLiable: boolean }) {
    const inc = await this.prisma.inboundIncident.findUnique({ where: { id: incidentId } });
    if (!inc) throw Err.notFound();
    if (inc.status === 'RESOLVED') throw new AppException('shipment_wrong_state', 409);
    if (!inc.driverConfirmedAt) throw new AppException('incident_driver_confirmation_required', 422);

    let otp: string | undefined;
    await this.prisma.$transaction(async (tx) => {
      if (input.resolution === 'RELEASE_TO_RECIPIENT') {
        await this.state.transition(tx, inc.shipmentId, 'ARRIVED_AT_DEST_AGENT', {
          from: ['ON_HOLD_ISSUE'],
          actorId: actor.id,
          notes: input.notes,
          data: { arrivedDestAt: new Date() },
          meta: { resolvedIncident: inc.id },
        });
        otp = await this.otp.issue(tx, inc.shipmentId);
        if (!input.fleetLiable) await this.settlement.releaseFleetShare(tx, inc.shipmentId, actor.id);
      } else {
        await this.state.transition(tx, inc.shipmentId, 'RETURN_TO_SENDER', {
          from: ['ON_HOLD_ISSUE'],
          actorId: actor.id,
          notes: input.notes,
          data: { rtsFlaggedAt: new Date() },
          meta: { resolvedIncident: inc.id },
        });
      }
      await tx.inboundIncident.update({
        where: { id: inc.id },
        data: { status: 'RESOLVED', resolvedBy: actor.id, resolvedAt: new Date(), resolutionNotes: input.notes },
      });
      await this.audit.writeInTx(tx, { action: 'INCIDENT_RESOLVED', entityType: 'inbound_incident', entityId: inc.id, after: input });
    });

    if (otp) await this.notifications.notifyShipment(inc.shipmentId, 'ARRIVED_AT_DEST_AGENT', ['RECIPIENT'], { otp }, `:resolved:${inc.id}`);
    else await this.notifications.notifyShipment(inc.shipmentId, 'RETURN_TO_SENDER', ['SENDER']);
    return this.incidentDto(inc.id);
  }
}
