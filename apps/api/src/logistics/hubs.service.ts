import { Injectable } from '@nestjs/common';
import { Prisma, type MasterBagStatus } from '@prisma/client';
import { hasPermission } from '@670send/types';
import { AuditService } from '../audit/audit.service';
import { AppException, Err } from '../common/errors';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import type { Actor } from '../rbac/actor';
import { newBagCode } from './codes';
import { ShipmentStateService } from './shipment-state.service';

export interface ReceiveResult {
  received: string[];
  failed: Array<{ waybill: string; code: string }>;
}

@Injectable()
export class HubsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly state: ShipmentStateService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  private async hubByCode(code: string) {
    const hub = await this.prisma.hub.findUnique({ where: { code } });
    if (!hub || !hub.isActive) throw Err.notFound();
    return hub;
  }

  /**
   * Hub scan: parcels dropped at origin → CONSOLIDATED_AT_HUB. A courier may only hand over the
   * pick-ups they collected; hub staff can scan anything that belongs to this hub's corridor.
   * Each waybill is processed on its own so one bad scan does not block the rest of the batch.
   */
  async receive(actor: Actor, hubCode: string, waybills: string[]): Promise<ReceiveResult> {
    const hub = await this.hubByCode(hubCode);
    const staff = hasPermission(actor.permissions, 'master_bags:manage');
    const result: ReceiveResult = { received: [], failed: [] };

    for (const waybill of [...new Set(waybills.map((w) => w.toUpperCase()))]) {
      try {
        const done = await this.prisma.$transaction(async (tx) => {
          const s = await tx.shipment.findUnique({ where: { waybillNumber: waybill }, include: { destMunicipality: true } });
          if (!s) throw Err.notFound();
          if (!staff && !(actor.courierId && s.pickupCourierId === actor.courierId)) throw Err.notFound();
          if (s.destMunicipality.servingHubId !== hub.id) throw new AppException('wrong_hub', 422);
          await this.state.transition(tx, s.id, 'CONSOLIDATED_AT_HUB', {
            from: ['DROPPED_AT_ORIGIN'],
            actorId: actor.id,
            locationLabel: hub.name,
            data: { originHubId: hub.id },
          });
          return s.id;
        });
        result.received.push(waybill);
        await this.notifications.notifyShipment(done, 'CONSOLIDATED_AT_HUB', ['SENDER']);
      } catch (err) {
        result.failed.push({ waybill, code: err instanceof AppException ? err.code : 'internal_error' });
      }
    }
    await this.audit.write({ action: 'HUB_RECEIVE', entityType: 'hub', entityId: hub.id, after: { received: result.received.length, failed: result.failed.length } });
    return result;
  }

  /* ----------------------------------- master bags ----------------------------------- */

  async createBag(actor: Actor, hubCode: string, destCode: string) {
    const hub = await this.hubByCode(hubCode);
    const dest = await this.prisma.municipality.findUnique({ where: { code: destCode } });
    if (!dest || dest.servingHubId !== hub.id) throw new AppException('wrong_hub', 422);
    for (let i = 0; i < 5; i++) {
      try {
        const bag = await this.prisma.masterBag.create({
          data: { bagCode: newBagCode(), originHubId: hub.id, destMunicipalityId: dest.id, createdBy: actor.id },
        });
        await this.audit.write({ action: 'MASTER_BAG_CREATED', entityType: 'master_bag', entityId: bag.id, after: { bagCode: bag.bagCode, hub: hub.code, dest: dest.code } });
        return this.bagDto(bag.bagCode);
      } catch (err) {
        if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') throw err;
      }
    }
    throw new AppException('internal_error', 500);
  }

  private async loadBag(code: string) {
    const bag = await this.prisma.masterBag.findUnique({ where: { bagCode: code.toUpperCase() } });
    if (!bag) throw Err.notFound();
    return bag;
  }

  async bagDto(code: string) {
    const bag = await this.prisma.masterBag.findUnique({
      where: { bagCode: code.toUpperCase() },
      include: {
        originHub: { select: { code: true, name: true } },
        destMunicipality: { select: { code: true, name: true } },
        items: { include: { shipment: { select: { waybillNumber: true, transportCanal: true, chargeableWeightKg: true, status: true } } } },
      },
    });
    if (!bag) throw Err.notFound();
    return {
      id: bag.id,
      bagCode: bag.bagCode,
      status: bag.status,
      plasticSealNumber: bag.plasticSealNumber,
      hub: bag.originHub,
      destination: bag.destMunicipality,
      parcelCount: bag.items.length,
      parcels: bag.items.map((i) => i.shipment),
      sealedAt: bag.sealedAt,
    };
  }

  async listBags(q: { hubCode?: string; status?: MasterBagStatus }) {
    const bags = await this.prisma.masterBag.findMany({
      where: { ...(q.status ? { status: q.status } : {}), ...(q.hubCode ? { originHub: { code: q.hubCode } } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { originHub: { select: { code: true } }, destMunicipality: { select: { code: true } }, _count: { select: { items: true } } },
    });
    return bags.map((b) => ({ bagCode: b.bagCode, status: b.status, hub: b.originHub.code, destination: b.destMunicipality.code, parcelCount: b._count.items, sealedAt: b.sealedAt }));
  }

  async addItem(actor: Actor, bagCode: string, waybill: string) {
    const bag = await this.loadBag(bagCode);
    if (bag.status !== 'OPEN') throw new AppException('master_bag_invalid', 409);

    const s = await this.prisma.shipment.findUnique({ where: { waybillNumber: waybill.toUpperCase() } });
    if (!s) throw Err.notFound();
    if (s.status !== 'CONSOLIDATED_AT_HUB' || s.originHubId !== bag.originHubId) throw new AppException('wrong_hub', 422);
    if (s.destMunicipalityId !== bag.destMunicipalityId) throw new AppException('master_bag_invalid', 422);
    // Bags carry small parcels only; heavy / oversize freight travels on its own manifest line.
    if (s.transportCanal === 'CARGO_TRUCK_PICKUP' || s.chargeableWeightKg > 10) throw new AppException('master_bag_invalid', 422);

    const existing = await this.prisma.masterBagItem.findMany({
      where: { masterBagId: bag.id },
      include: { shipment: { select: { transportCanal: true, destAgentId: true } } },
    });
    // One bag = one fleet type and one destination kiosk, so the bag can be opened by a single agent.
    if (existing.some((i) => i.shipment.transportCanal !== s.transportCanal || i.shipment.destAgentId !== s.destAgentId)) {
      throw new AppException('master_bag_invalid', 422);
    }
    if (await this.onActiveManifest(s.id)) throw new AppException('parcel_already_assigned', 409);

    try {
      await this.prisma.masterBagItem.create({ data: { masterBagId: bag.id, shipmentId: s.id, addedBy: actor.id } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw new AppException('parcel_already_assigned', 409);
      throw err;
    }
    return this.bagDto(bag.bagCode);
  }

  async removeItem(actor: Actor, bagCode: string, waybill: string) {
    void actor;
    const bag = await this.loadBag(bagCode);
    if (bag.status !== 'OPEN') throw new AppException('master_bag_invalid', 409);
    const s = await this.prisma.shipment.findUnique({ where: { waybillNumber: waybill.toUpperCase() } });
    if (!s) throw Err.notFound();
    await this.prisma.masterBagItem.deleteMany({ where: { masterBagId: bag.id, shipmentId: s.id } });
    return this.bagDto(bag.bagCode);
  }

  async seal(actor: Actor, bagCode: string, plasticSealNumber: string) {
    const bag = await this.loadBag(bagCode);
    if (bag.status !== 'OPEN') throw new AppException('master_bag_invalid', 409);
    if ((await this.prisma.masterBagItem.count({ where: { masterBagId: bag.id } })) === 0) throw new AppException('master_bag_invalid', 422);
    try {
      await this.prisma.masterBag.update({ where: { id: bag.id }, data: { status: 'SEALED', plasticSealNumber, sealedAt: new Date() } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw Err.validation([{ path: 'plasticSealNumber', message: 'errors.validation_failed' }]);
      throw err;
    }
    await this.audit.write({ action: 'MASTER_BAG_SEALED', entityType: 'master_bag', entityId: bag.id, after: { plasticSealNumber } });
    void actor;
    return this.bagDto(bag.bagCode);
  }

  /** True when the parcel already sits on a manifest that has not finished (or been cancelled). */
  async onActiveManifest(shipmentId: string): Promise<boolean> {
    const hit = await this.prisma.manifestItem.findFirst({
      where: {
        manifest: { status: { notIn: ['CANCELLED', 'COMPLETED'] } },
        OR: [{ shipmentId }, { masterBag: { items: { some: { shipmentId } } } }],
      },
      select: { id: true },
    });
    return hit != null;
  }
}
