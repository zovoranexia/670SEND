import { Injectable } from '@nestjs/common';
import { Prisma, type Driver, type FleetPartner, type Manifest, type TransportCanal, type Vehicle } from '@prisma/client';
import { hasPermission } from '@670send/types';
import { AuditService } from '../audit/audit.service';
import { AppException, Err } from '../common/errors';
import { SettingsService } from '../common/settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import type { Actor } from '../rbac/actor';
import { newManifestCode } from './codes';
import { HubsService } from './hubs.service';
import { ShipmentStateService } from './shipment-state.service';

export interface CreateManifestInput {
  hubCode: string;
  destMunicipalityCode: string;
  canal: TransportCanal;
  fleetPartnerId: string;
  vehicleId: string;
  driverId: string;
  masterBagCodes: string[];
  /** Loose parcels (heavy / oversize freight, or bus parcels that did not go in a bag). */
  waybills: string[];
  scheduledDepartureAt?: Date;
  portManifestNo?: string;
}

const todayUtc = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
};
const expired = (d: Date | null | undefined) => !d || d < todayUtc();

@Injectable()
export class ManifestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hubs: HubsService,
    private readonly state: ShipmentStateService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  /* ------------------------------ eligibility ------------------------------ */

  /** MoU in force, vehicle permits (DNTT + KIR) valid, driver licence valid, everything belongs together. */
  assertFleetEligible(partner: FleetPartner | null, vehicle: Vehicle | null, driver: Driver | null, canal: TransportCanal): void {
    if (!partner || partner.deletedAt || !vehicle || vehicle.deletedAt || !driver || driver.deletedAt) throw Err.notFound();
    if (partner.status !== 'ACTIVE') throw new AppException('partner_inactive', 422);
    if (expired(partner.mouValidUntil)) throw new AppException('mou_expired', 422);
    if (vehicle.fleetPartnerId !== partner.id || driver.fleetPartnerId !== partner.id) throw new AppException('manifest_invalid', 422);
    if (!vehicle.isActive || !driver.isActive) throw new AppException('manifest_invalid', 422);
    if (expired(vehicle.dnttPermitExpiry) || expired(vehicle.kirExpiry)) throw new AppException('vehicle_permit_expired', 422);
    if (expired(driver.licenseExpiry)) throw new AppException('driver_license_expired', 422);

    const typeOk: Record<TransportCanal, string[]> = {
      BUS_BAGGAGE: ['BUS_PASSENGER'],
      CARGO_TRUCK_PICKUP: ['PICKUP_CARGO', 'TRUCK_CARGO'],
      SEA_FERRY_CARGO: ['SEA_FERRY'],
    };
    if (!typeOk[canal].includes(vehicle.vehicleType)) throw new AppException('manifest_invalid', 422);
  }

  /* -------------------------------- create --------------------------------- */

  async create(actor: Actor, input: CreateManifestInput) {
    const hub = await this.prisma.hub.findUnique({ where: { code: input.hubCode } });
    const dest = await this.prisma.municipality.findUnique({ where: { code: input.destMunicipalityCode } });
    if (!hub || !dest) throw Err.notFound();
    if (dest.servingHubId !== hub.id) throw new AppException('wrong_hub', 422);
    // Compliance: Oecusse / Ataúro never travel by land — refuse before touching the database trigger.
    if (dest.isSeaRoute !== (input.canal === 'SEA_FERRY_CARGO')) throw new AppException('sea_route_bus_forbidden', 422);

    const [partner, vehicle, driver] = await Promise.all([
      this.prisma.fleetPartner.findUnique({ where: { id: input.fleetPartnerId } }),
      this.prisma.vehicle.findUnique({ where: { id: input.vehicleId } }),
      this.prisma.driver.findUnique({ where: { id: input.driverId } }),
    ]);
    this.assertFleetEligible(partner, vehicle, driver, input.canal);

    const bags = await this.prisma.masterBag.findMany({
      where: { bagCode: { in: input.masterBagCodes.map((c) => c.toUpperCase()) } },
      include: { items: { include: { shipment: true } } },
    });
    if (bags.length !== new Set(input.masterBagCodes).size) throw Err.notFound();
    const loose = await this.prisma.shipment.findMany({
      where: { waybillNumber: { in: input.waybills.map((w) => w.toUpperCase()) } },
      include: { masterBagItem: true },
    });
    if (loose.length !== new Set(input.waybills.map((w) => w.toUpperCase())).size) throw Err.notFound();
    if (bags.length + loose.length === 0) throw new AppException('manifest_invalid', 422);

    for (const b of bags) {
      const sameCanal = b.items.every((i) => i.shipment.transportCanal === input.canal);
      if (b.status !== 'SEALED' || b.originHubId !== hub.id || b.destMunicipalityId !== dest.id || !sameCanal || b.items.length === 0) {
        throw new AppException('manifest_invalid', 422);
      }
      if (await this.hubs.onActiveManifest(b.items[0]!.shipmentId)) throw new AppException('parcel_already_assigned', 409);
    }
    for (const s of loose) {
      if (
        s.status !== 'CONSOLIDATED_AT_HUB' ||
        s.originHubId !== hub.id ||
        s.destMunicipalityId !== dest.id ||
        s.transportCanal !== input.canal ||
        s.masterBagItem
      ) {
        throw new AppException('manifest_invalid', 422);
      }
      if (await this.hubs.onActiveManifest(s.id)) throw new AppException('parcel_already_assigned', 409);
    }

    // ---- bus safety cap (DNTT / PNTL): few parcels, few bags, never in the passenger aisle ----
    const parcelsInBags = bags.reduce((n, b) => n + b.items.length, 0);
    const parcelCount = parcelsInBags + loose.length;
    if (input.canal === 'BUS_BAGGAGE') {
      const cap = await this.settings.busCapacity();
      const maxParcels = Math.min(vehicle!.maxParcelSlots, cap.maxSmallParcels);
      if (parcelCount > maxParcels || bags.length > cap.maxMasterBags) throw new AppException('bus_capacity_exceeded', 422);
    }

    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const manifest = await this.prisma.$transaction(async (tx) => {
          const m = await tx.manifest.create({
            data: {
              manifestCode: newManifestCode(),
              originHubId: hub.id,
              destMunicipalityId: dest.id,
              transportCanal: input.canal,
              fleetPartnerId: partner!.id,
              vehicleId: vehicle!.id,
              driverId: driver!.id,
              portManifestNo: input.portManifestNo,
              scheduledDepartureAt: input.scheduledDepartureAt,
              parcelCount,
              masterBagCount: bags.length,
              createdBy: actor.id,
            },
          });
          await tx.manifestItem.createMany({
            data: [
              ...bags.map((b) => ({ manifestId: m.id, masterBagId: b.id })),
              ...loose.map((s) => ({ manifestId: m.id, shipmentId: s.id })),
            ],
          });
          await this.audit.writeInTx(tx, {
            action: 'MANIFEST_CREATED',
            entityType: 'manifest',
            entityId: m.id,
            after: { manifestCode: m.manifestCode, canal: input.canal, bags: bags.length, loose: loose.length, parcelCount },
          });
          return m;
        });
        return this.detail(manifest.manifestCode);
      } catch (err) {
        if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') throw err;
      }
    }
    throw new AppException('internal_error', 500);
  }

  /* ------------------------------ lifecycle ------------------------------- */

  private async load(code: string): Promise<Manifest> {
    const m = await this.prisma.manifest.findUnique({ where: { manifestCode: code.toUpperCase() } });
    if (!m) throw Err.notFound();
    return m;
  }

  /** DRAFT → READY (ops signs the manifest off; sea freight needs the official port manifest number). */
  async markReady(actor: Actor, code: string, portManifestNo?: string) {
    const m = await this.load(code);
    if (m.status !== 'DRAFT') throw new AppException('shipment_wrong_state', 409);
    const [partner, vehicle, driver] = await Promise.all([
      this.prisma.fleetPartner.findUnique({ where: { id: m.fleetPartnerId } }),
      this.prisma.vehicle.findUnique({ where: { id: m.vehicleId } }),
      this.prisma.driver.findUnique({ where: { id: m.driverId } }),
    ]);
    this.assertFleetEligible(partner, vehicle, driver, m.transportCanal); // permits may have lapsed since drafting
    const port = portManifestNo ?? m.portManifestNo;
    if (m.transportCanal === 'SEA_FERRY_CARGO' && !port) throw new AppException('manifest_invalid', 422);
    await this.prisma.manifest.update({ where: { id: m.id }, data: { status: 'READY', portManifestNo: port } });
    await this.audit.write({ action: 'MANIFEST_READY', entityType: 'manifest', entityId: m.id, actorId: actor.id });
    return this.detail(m.manifestCode);
  }

  async cancel(actor: Actor, code: string) {
    const m = await this.load(code);
    if (m.status !== 'DRAFT' && m.status !== 'READY') throw new AppException('shipment_wrong_state', 409);
    await this.prisma.manifest.update({ where: { id: m.id }, data: { status: 'CANCELLED' } });
    await this.audit.write({ action: 'MANIFEST_CANCELLED', entityType: 'manifest', entityId: m.id, actorId: actor.id });
    return this.detail(m.manifestCode);
  }

  /**
   * Driver handover scan: the driver confirms the manifest at the hub and uploads the
   * BAGGAGE_PLACEMENT photo (parcels in the CLOSED baggage compartment — not the passenger aisle, not
   * piled on the roof). From this scan the physical custody moves to the fleet partner.
   */
  async handover(actor: Actor, code: string, baggagePhotoUploadId?: string) {
    const m = await this.load(code);
    if (!actor.driverId || m.driverId !== actor.driverId) throw Err.notFound();
    if (m.status !== 'READY') throw new AppException('shipment_wrong_state', 409);

    const [partner, vehicle, driver] = await Promise.all([
      this.prisma.fleetPartner.findUnique({ where: { id: m.fleetPartnerId } }),
      this.prisma.vehicle.findUnique({ where: { id: m.vehicleId } }),
      this.prisma.driver.findUnique({ where: { id: m.driverId } }),
    ]);
    this.assertFleetEligible(partner, vehicle, driver, m.transportCanal);
    if (m.transportCanal === 'BUS_BAGGAGE' && !baggagePhotoUploadId) throw new AppException('baggage_photo_required', 422);

    const shipmentIds = await this.prisma.$transaction(async (tx) => {
      const items = await tx.manifestItem.findMany({
        where: { manifestId: m.id },
        include: { masterBag: { include: { items: true } } },
      });
      const ids = [...items.flatMap((i) => (i.shipmentId ? [i.shipmentId] : i.masterBag!.items.map((b) => b.shipmentId)))];

      let photoUrl: string | null = null;
      if (baggagePhotoUploadId) {
        const up = await tx.stagedUpload.findFirst({
          where: { id: baggagePhotoUploadId, uploadedBy: actor.id, photoType: 'BAGGAGE_PLACEMENT', consumedAt: null },
        });
        if (!up) throw new AppException('baggage_photo_required', 422);
        await tx.stagedUpload.update({ where: { id: up.id }, data: { consumedAt: new Date() } });
        photoUrl = up.fileUrl;
        await tx.shipmentPhoto.createMany({
          data: ids.map((shipmentId) => ({
            shipmentId,
            photoType: 'BAGGAGE_PLACEMENT' as const,
            fileUrl: up.fileUrl,
            mimeType: up.mimeType,
            sizeBytes: up.sizeBytes,
            sha256: up.sha256,
            uploadedBy: actor.id,
          })),
        });
      }

      for (const id of ids) {
        await this.state.transition(tx, id, 'IN_TRANSIT', {
          from: ['CONSOLIDATED_AT_HUB'],
          actorId: actor.id,
          locationLabel: `Manifest ${m.manifestCode}`,
          meta: { manifest: m.manifestCode, vehicle: vehicle!.plateNumber },
        });
      }
      await tx.masterBag.updateMany({
        where: { id: { in: items.flatMap((i) => (i.masterBagId ? [i.masterBagId] : [])) }, status: 'SEALED' },
        data: { status: 'DISPATCHED', dispatchedAt: new Date() },
      });
      // The fleet owner (never the driver) is the beneficiary of the 40 % share of every parcel on board.
      await tx.shipmentSettlement.updateMany({ where: { shipmentId: { in: ids } }, data: { fleetPartnerId: m.fleetPartnerId } });
      await tx.manifest.update({
        where: { id: m.id },
        data: { status: 'IN_TRANSIT', dispatchedAt: new Date(), baggagePhotoUrl: photoUrl, parcelCount: ids.length },
      });
      await this.audit.writeInTx(tx, { action: 'MANIFEST_HANDOVER', entityType: 'manifest', entityId: m.id, after: { parcels: ids.length, photo: Boolean(photoUrl) } });
      return ids;
    });

    for (const id of shipmentIds) await this.notifications.notifyShipment(id, 'IN_TRANSIT', ['SENDER', 'RECIPIENT']);
    return this.detail(m.manifestCode);
  }

  /** Driver marks the trip as arrived at the destination municipality. */
  async arrive(actor: Actor, code: string) {
    const m = await this.load(code);
    if (!actor.driverId || m.driverId !== actor.driverId) throw Err.notFound();
    if (m.status !== 'IN_TRANSIT') throw new AppException('shipment_wrong_state', 409);
    await this.prisma.manifest.update({ where: { id: m.id }, data: { status: 'ARRIVED', arrivedAt: new Date() } });
    return this.detail(m.manifestCode);
  }

  /**
   * After every inbound scan: when every line of the manifest has been received and every incident
   * has been confirmed by the driver, the trip is COMPLETED (or DISCREPANCY if anything was wrong).
   */
  async refreshCompletion(tx: Prisma.TransactionClient, manifestId: string): Promise<void> {
    const m = await tx.manifest.findUnique({ where: { id: manifestId }, include: { items: true } });
    if (!m || ['COMPLETED', 'CANCELLED', 'DISCREPANCY'].includes(m.status)) return;
    const pending = m.items.filter((i) => !i.inboundCondition).length;
    const bad = m.items.some((i) => i.inboundCondition && i.inboundCondition !== 'INTACT');
    const unconfirmed = await tx.inboundIncident.count({ where: { manifestId, driverConfirmedAt: null, status: { in: ['OPEN', 'UNDER_REVIEW'] } } });
    if (pending > 0) {
      if (m.status === 'IN_TRANSIT') await tx.manifest.update({ where: { id: manifestId }, data: { status: 'ARRIVED', arrivedAt: m.arrivedAt ?? new Date() } });
      return;
    }
    if (unconfirmed > 0) {
      // Everything has been scanned, but the driver still has to confirm the incident(s): arrived, not closed.
      if (m.status === 'IN_TRANSIT') await tx.manifest.update({ where: { id: manifestId }, data: { status: 'ARRIVED', arrivedAt: m.arrivedAt ?? new Date() } });
      return;
    }
    await tx.manifest.update({
      where: { id: manifestId },
      data: { status: bad ? 'DISCREPANCY' : 'COMPLETED', arrivedAt: m.arrivedAt ?? new Date() },
    });
  }

  /* -------------------------------- queries -------------------------------- */

  async detail(code: string) {
    const m = await this.prisma.manifest.findUnique({
      where: { manifestCode: code.toUpperCase() },
      include: {
        originHub: { select: { code: true, name: true } },
        destMunicipality: { select: { code: true, name: true } },
        fleetPartner: { select: { id: true, companyName: true } },
        vehicle: { select: { plateNumber: true, vehicleType: true } },
        driver: { select: { id: true, licenseNumber: true, user: { select: { fullName: true } } } },
        items: {
          include: {
            masterBag: { select: { bagCode: true, status: true, _count: { select: { items: true } } } },
            shipment: { select: { waybillNumber: true, status: true, transportCanal: true } },
          },
        },
      },
    });
    if (!m) throw Err.notFound();
    return {
      manifestCode: m.manifestCode,
      status: m.status,
      canal: m.transportCanal,
      hub: m.originHub,
      destination: m.destMunicipality,
      fleetPartner: m.fleetPartner,
      vehicle: m.vehicle,
      driver: { id: m.driver.id, name: m.driver.user.fullName, licenseNumber: m.driver.licenseNumber },
      portManifestNo: m.portManifestNo,
      parcelCount: m.parcelCount,
      masterBagCount: m.masterBagCount,
      scheduledDepartureAt: m.scheduledDepartureAt,
      dispatchedAt: m.dispatchedAt,
      arrivedAt: m.arrivedAt,
      hasBaggagePhoto: m.baggagePhotoUrl != null,
      items: m.items.map((i) => ({
        type: i.masterBag ? 'MASTER_BAG' : 'PARCEL',
        code: i.masterBag?.bagCode ?? i.shipment?.waybillNumber,
        parcelCount: i.masterBag ? i.masterBag._count.items : 1,
        inboundCondition: i.inboundCondition,
      })),
    };
  }

  /** Scoped listing: staff see all, a fleet owner their fleet's, a driver their own trips. */
  async list(actor: Actor, q: { status?: string; limit: number }) {
    const all = hasPermission(actor.permissions, 'manifests:read');
    const scope: Prisma.ManifestWhereInput[] = [];
    if (!all) {
      if (actor.fleetPartnerId && hasPermission(actor.permissions, 'manifests:read_own_fleet')) scope.push({ fleetPartnerId: actor.fleetPartnerId });
      if (actor.driverId && hasPermission(actor.permissions, 'manifests:read_assigned')) scope.push({ driverId: actor.driverId });
      if (scope.length === 0) return [];
    }
    const rows = await this.prisma.manifest.findMany({
      where: { ...(all ? {} : { OR: scope }), ...(q.status ? { status: q.status as never } : {}) },
      orderBy: { createdAt: 'desc' },
      take: q.limit,
      include: { destMunicipality: { select: { code: true, name: true } }, vehicle: { select: { plateNumber: true } } },
    });
    return rows.map((m) => ({
      manifestCode: m.manifestCode,
      status: m.status,
      canal: m.transportCanal,
      destination: m.destMunicipality,
      vehicle: m.vehicle.plateNumber,
      parcelCount: m.parcelCount,
      masterBagCount: m.masterBagCount,
      scheduledDepartureAt: m.scheduledDepartureAt,
    }));
  }

  /** Ownership check used by the controller before returning details. */
  async assertCanView(actor: Actor, code: string): Promise<void> {
    if (hasPermission(actor.permissions, 'manifests:read')) return;
    const m = await this.load(code);
    const ownFleet = actor.fleetPartnerId && m.fleetPartnerId === actor.fleetPartnerId && hasPermission(actor.permissions, 'manifests:read_own_fleet');
    const assigned = actor.driverId && m.driverId === actor.driverId && hasPermission(actor.permissions, 'manifests:read_assigned');
    if (!ownFleet && !assigned) throw Err.notFound();
  }
}
