import { Injectable } from '@nestjs/common';
import { Prisma, type PickupBookingStatus } from '@prisma/client';
import { SERVICE_SCHEME_META, toPrismaLanguage, type Locale } from '@670send/types';
import { AuditService } from '../audit/audit.service';
import { AppException, Err } from '../common/errors';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import type { Actor } from '../rbac/actor';
import { newBookingCode } from './codes';
import { maskPhone } from './dto';

export interface CreateBookingInput {
  senderName: string;
  senderPhone: string;
  preferredLang: Locale;
  scheme: 'SCHEME_B' | 'SCHEME_D';
  destMunicipalityCode?: string;
  parcelCount: number;
  estimatedWeightKg?: number;
  pickupAddress: string;
  lat?: number;
  lng?: number;
  notes?: string;
}

@Injectable()
export class BookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Public online / WhatsApp pick-up request (Schemes B & D). It starts UNVERIFIED: ops confirm the
   * phone number with the customer before a courier is dispatched, which keeps bots and typo'd
   * numbers out of the courier queue. (Automatic WhatsApp-OTP verification arrives with the web app.)
   */
  async createPublic(input: CreateBookingInput) {
    if (!SERVICE_SCHEME_META[input.scheme].pickup) throw Err.validation([{ path: 'scheme', message: 'errors.validation_failed' }]);
    let destMunicipalityId: string | undefined;
    if (input.destMunicipalityCode) {
      const dest = await this.prisma.municipality.findUnique({ where: { code: input.destMunicipalityCode } });
      if (!dest) throw Err.validation([{ path: 'destMunicipalityCode', message: 'errors.validation_failed' }]);
      destMunicipalityId = dest.id;
    }
    for (let i = 0; i < 5; i++) {
      try {
        const b = await this.prisma.pickupBooking.create({
          data: {
            batchCode: newBookingCode(),
            senderName: input.senderName,
            senderPhone: input.senderPhone,
            senderInfo: { name: input.senderName, phone: input.senderPhone } as Prisma.InputJsonObject,
            preferredLang: toPrismaLanguage(input.preferredLang),
            serviceScheme: input.scheme,
            destMunicipalityId,
            parcelCount: input.parcelCount,
            estimatedWeightKg: input.estimatedWeightKg,
            pickupAddress: input.pickupAddress,
            lat: input.lat,
            lng: input.lng,
            notes: input.notes,
          },
        });
        // Only the batch code leaves the server — the customer quotes it when calling / on WhatsApp.
        return { batchCode: b.batchCode, status: b.status, parcelCount: b.parcelCount, phone: maskPhone(b.senderPhone) };
      } catch (err) {
        if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') throw err;
      }
    }
    throw new AppException('internal_error', 500);
  }

  async list(q: { status?: PickupBookingStatus; limit: number }) {
    const rows = await this.prisma.pickupBooking.findMany({
      where: q.status ? { status: q.status } : {},
      orderBy: { createdAt: 'desc' },
      take: q.limit,
      include: { assignedCourier: { select: { id: true, user: { select: { fullName: true } } } }, destMunicipality: { select: { code: true } } },
    });
    return rows.map((b) => ({
      id: b.id,
      batchCode: b.batchCode,
      status: b.status,
      scheme: b.serviceScheme,
      sender: { name: b.senderName, phone: b.senderPhone, lang: b.preferredLang },
      parcelCount: b.parcelCount,
      pickupAddress: b.pickupAddress,
      lat: b.lat && Number(b.lat),
      lng: b.lng && Number(b.lng),
      destination: b.destMunicipality?.code ?? null,
      confirmed: b.phoneVerifiedAt != null,
      courier: b.assignedCourier && { id: b.assignedCourier.id, name: b.assignedCourier.user.fullName },
      createdAt: b.createdAt,
    }));
  }

  private async load(id: string) {
    const b = await this.prisma.pickupBooking.findUnique({ where: { id } });
    if (!b) throw Err.notFound();
    return b;
  }

  /** Ops called / WhatsApp'd the customer and confirmed the number and the request. */
  async confirm(actor: Actor, id: string) {
    const b = await this.load(id);
    if (b.status !== 'REQUESTED') throw new AppException('shipment_wrong_state', 409);
    await this.prisma.pickupBooking.update({ where: { id }, data: { phoneVerifiedAt: new Date() } });
    await this.audit.write({ action: 'PICKUP_CONFIRMED', entityType: 'pickup_booking', entityId: id, actorId: actor.id });
    return { id, confirmed: true };
  }

  /** Dispatch a courier → PICKUP_ASSIGNED WhatsApp to the sender (in their language). */
  async assign(actor: Actor, id: string, courierId: string) {
    const b = await this.load(id);
    if (!b.phoneVerifiedAt) throw new AppException('booking_not_confirmed', 422);
    if (b.status !== 'REQUESTED' && b.status !== 'ASSIGNED') throw new AppException('shipment_wrong_state', 409);
    const courier = await this.prisma.courier.findFirst({
      where: { id: courierId, status: 'ACTIVE', isAvailable: true, deletedAt: null },
      include: { user: { select: { fullName: true, phone: true } } },
    });
    if (!courier) throw new AppException('courier_unavailable', 422);

    await this.prisma.$transaction(async (tx) => {
      await tx.pickupBooking.update({ where: { id }, data: { status: 'ASSIGNED', assignedCourierId: courier.id, assignedAt: new Date() } });
      await this.audit.writeInTx(tx, { action: 'PICKUP_ASSIGNED', entityType: 'pickup_booking', entityId: id, after: { courierId } });
    });
    await this.notifications.notify({
      eventCode: 'PICKUP_ASSIGNED',
      audience: 'SENDER',
      phone: b.senderPhone,
      lang: b.preferredLang,
      vars: { courierName: courier.user.fullName, courierPhone: courier.user.phone, waybill: b.batchCode },
      dedupeKey: `booking:${id}:${courier.id}`,
    });
    void actor;
    return { id, status: 'ASSIGNED' as const, courier: { id: courier.id, name: courier.user.fullName } };
  }

  async cancel(actor: Actor, id: string, reason: string) {
    const b = await this.load(id);
    if (b.status !== 'REQUESTED' && b.status !== 'ASSIGNED') throw new AppException('shipment_wrong_state', 409);
    await this.prisma.pickupBooking.update({ where: { id }, data: { status: 'CANCELLED', cancelReason: reason } });
    await this.audit.write({ action: 'PICKUP_CANCELLED', entityType: 'pickup_booking', entityId: id, actorId: actor.id, after: { reason } });
    return { id, status: 'CANCELLED' as const };
  }

  /** The courier's work list: assigned pick-ups, parcels waiting for door delivery in their area, and their runs. */
  async courierJobs(actor: Actor) {
    if (!actor.courierId) throw Err.forbidden();
    const courier = await this.prisma.courier.findUniqueOrThrow({ where: { id: actor.courierId } });
    const [pickups, deliverable, mine] = await Promise.all([
      this.prisma.pickupBooking.findMany({ where: { assignedCourierId: courier.id, status: 'ASSIGNED' }, orderBy: { assignedAt: 'asc' } }),
      this.prisma.shipment.findMany({
        where: { status: 'ARRIVED_AT_DEST_AGENT', serviceScheme: { in: ['SCHEME_C', 'SCHEME_D'] }, destMunicipalityId: courier.municipalityId },
        orderBy: { arrivedDestAt: 'asc' },
        take: 100,
      }),
      this.prisma.shipment.findMany({ where: { status: 'OUT_FOR_DELIVERY', deliveryCourierId: courier.id }, orderBy: { updatedAt: 'asc' } }),
    ]);
    const stop = (s: (typeof mine)[number]) => ({
      waybill: s.waybillNumber,
      recipientName: s.recipientName,
      recipientPhone: s.recipientPhone,
      recipientAddress: s.recipientAddress,
      attempts: s.deliveryAttempts,
    });
    return {
      pickups: pickups.map((b) => ({
        id: b.id,
        batchCode: b.batchCode,
        senderName: b.senderName,
        senderPhone: b.senderPhone,
        pickupAddress: b.pickupAddress,
        lat: b.lat && Number(b.lat),
        lng: b.lng && Number(b.lng),
        parcelCount: b.parcelCount,
        scheme: b.serviceScheme,
      })),
      readyForDelivery: deliverable.map(stop),
      outForDelivery: mine.map(stop),
    };
  }
}
