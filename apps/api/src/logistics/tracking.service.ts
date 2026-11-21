import { Injectable } from '@nestjs/common';
import { TRACKER_HAPPY_PATH } from '@670send/types';
import { WAYBILL_REGEX } from '@670send/validation';
import { Err } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';
import { maskName } from './dto';

/**
 * Public waybill tracker (no login). It reveals the minimum: masked names, municipality names, the
 * 9-state progress with timestamps, and — once the parcel is at the destination — the kiosk to go to.
 * No phone numbers, ID numbers, fees, notes, photos or OTP data, ever. Unknown and malformed numbers
 * get the same 404 so the endpoint cannot be used to probe which waybills exist.
 */
@Injectable()
export class TrackingService {
  constructor(private readonly prisma: PrismaService) {}

  async track(raw: string) {
    const waybill = raw.trim().toUpperCase();
    if (!WAYBILL_REGEX.test(waybill)) throw Err.notFound();
    const s = await this.prisma.shipment.findUnique({
      where: { waybillNumber: waybill },
      include: {
        originMunicipality: { select: { name: true } },
        destMunicipality: { select: { name: true } },
        destAgent: { select: { kioskName: true, address: true, lat: true, lng: true, openingHours: true } },
        events: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { status: true, createdAt: true } },
      },
    });
    if (!s) throw Err.notFound();

    const reached = new Map<string, Date>();
    for (const e of s.events) if (!reached.has(e.status)) reached.set(e.status, e.createdAt);
    const showKiosk = ['ARRIVED_AT_DEST_AGENT', 'OUT_FOR_DELIVERY', 'DELIVERED'].some((st) => reached.has(st)) && s.status !== 'RETURN_TO_SENDER';

    return {
      waybill: s.waybillNumber,
      status: s.status,
      origin: s.originMunicipality.name,
      destination: s.destMunicipality.name,
      sender: maskName(s.senderName),
      recipient: maskName(s.recipientName),
      scheme: s.serviceScheme,
      canal: s.transportCanal,
      steps: TRACKER_HAPPY_PATH.filter((st) => st !== 'PICKUP_ASSIGNED' || reached.has(st)).map((st) => ({
        status: st,
        reachedAt: reached.get(st) ?? null,
        current: s.status === st,
      })),
      // Exception states are shown as a banner, without internal detail.
      exception: s.status === 'ON_HOLD_ISSUE' || s.status === 'RETURN_TO_SENDER' ? s.status : null,
      kiosk:
        showKiosk && s.destAgent
          ? {
              name: s.destAgent.kioskName,
              address: s.destAgent.address,
              openingHours: s.destAgent.openingHours,
              lat: s.destAgent.lat && Number(s.destAgent.lat),
              lng: s.destAgent.lng && Number(s.destAgent.lng),
            }
          : null,
      lastUpdate: s.events[s.events.length - 1]?.createdAt ?? s.createdAt,
    };
  }
}
