import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { INBOUND_CONDITIONS, TRANSPORT_CANALS } from '@670send/types';
import { CurrentActor, RequireAnyPermission, RequirePermissions } from '../common/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { Actor } from '../rbac/actor';
import { BookingsService } from './bookings.service';
import { DeliveryService } from './delivery.service';
import { HubsService } from './hubs.service';
import { InboundService } from './inbound.service';
import { ManifestsService } from './manifests.service';
import { pin6, uuid } from './dto';

const waybill = z.string().trim().min(10).max(40).transform((v) => v.toUpperCase());
const code3 = z.string().trim().length(3).transform((v) => v.toUpperCase());
const hubCode = z.string().trim().min(3).max(40).transform((v) => v.toUpperCase());

/* ---------------------------------------- hub & master bags ---------------------------------------- */

const receiveSchema = z.object({ hubCode, waybills: z.array(waybill).min(1).max(100) });
const bagCreateSchema = z.object({ hubCode, destMunicipalityCode: code3 });
const bagItemSchema = z.object({ waybill });
const sealSchema = z.object({ plasticSealNumber: z.string().trim().min(4).max(40) });
const bagListSchema = z.object({ hubCode: hubCode.optional(), status: z.enum(['OPEN', 'SEALED', 'DISPATCHED', 'RECEIVED', 'DISCREPANCY']).optional() });

@Controller()
export class HubsController {
  constructor(private readonly hubs: HubsService) {}

  /** Hub scan: parcels arrive at a consolidation hub (staff scan, or a courier hands over their pick-ups). */
  @RequireAnyPermission('hub_handover:execute', 'master_bags:manage')
  @Post('hub/receive')
  @HttpCode(200)
  receive(@CurrentActor() actor: Actor, @Body(new ZodValidationPipe(receiveSchema)) b: z.infer<typeof receiveSchema>) {
    return this.hubs.receive(actor, b.hubCode, b.waybills);
  }

  @RequirePermissions('master_bags:manage')
  @Post('master-bags')
  createBag(@CurrentActor() actor: Actor, @Body(new ZodValidationPipe(bagCreateSchema)) b: z.infer<typeof bagCreateSchema>) {
    return this.hubs.createBag(actor, b.hubCode, b.destMunicipalityCode);
  }

  @RequirePermissions('master_bags:read')
  @Get('master-bags')
  listBags(@Query(new ZodValidationPipe(bagListSchema)) q: z.infer<typeof bagListSchema>) {
    return this.hubs.listBags(q);
  }

  @RequirePermissions('master_bags:read')
  @Get('master-bags/:code')
  bag(@Param('code') code: string) {
    return this.hubs.bagDto(code);
  }

  @RequirePermissions('master_bags:manage')
  @Post('master-bags/:code/items')
  @HttpCode(200)
  addItem(@CurrentActor() actor: Actor, @Param('code') code: string, @Body(new ZodValidationPipe(bagItemSchema)) b: z.infer<typeof bagItemSchema>) {
    return this.hubs.addItem(actor, code, b.waybill);
  }

  @RequirePermissions('master_bags:manage')
  @Delete('master-bags/:code/items/:waybill')
  removeItem(@CurrentActor() actor: Actor, @Param('code') code: string, @Param('waybill') wb: string) {
    return this.hubs.removeItem(actor, code, wb);
  }

  @RequirePermissions('master_bags:manage')
  @Post('master-bags/:code/seal')
  @HttpCode(200)
  seal(@CurrentActor() actor: Actor, @Param('code') code: string, @Body(new ZodValidationPipe(sealSchema)) b: z.infer<typeof sealSchema>) {
    return this.hubs.seal(actor, code, b.plasticSealNumber);
  }
}

/* -------------------------------------------- manifests -------------------------------------------- */

const manifestCreateSchema = z.object({
  hubCode,
  destMunicipalityCode: code3,
  canal: z.enum(TRANSPORT_CANALS),
  fleetPartnerId: uuid,
  vehicleId: uuid,
  driverId: uuid,
  masterBagCodes: z.array(z.string().trim().min(5)).default([]),
  waybills: z.array(waybill).default([]),
  scheduledDepartureAt: z.string().datetime().optional(),
  portManifestNo: z.string().trim().min(3).max(60).optional(),
});
const readySchema = z.object({ portManifestNo: z.string().trim().min(3).max(60).optional() });
const handoverSchema = z.object({ baggagePhotoUploadId: uuid.optional() });
const manifestListSchema = z.object({ status: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).default(30) });

@Controller('manifests')
export class ManifestsController {
  constructor(private readonly manifests: ManifestsService) {}

  @RequirePermissions('manifests:create')
  @Post()
  create(@CurrentActor() actor: Actor, @Body(new ZodValidationPipe(manifestCreateSchema)) b: z.infer<typeof manifestCreateSchema>) {
    return this.manifests.create(actor, { ...b, scheduledDepartureAt: b.scheduledDepartureAt ? new Date(b.scheduledDepartureAt) : undefined });
  }

  @RequireAnyPermission('manifests:read', 'manifests:read_own_fleet', 'manifests:read_assigned')
  @Get()
  list(@CurrentActor() actor: Actor, @Query(new ZodValidationPipe(manifestListSchema)) q: z.infer<typeof manifestListSchema>) {
    return this.manifests.list(actor, q);
  }

  @RequireAnyPermission('manifests:read', 'manifests:read_own_fleet', 'manifests:read_assigned')
  @Get(':code')
  async detail(@CurrentActor() actor: Actor, @Param('code') code: string) {
    await this.manifests.assertCanView(actor, code);
    return this.manifests.detail(code);
  }

  @RequirePermissions('manifests:dispatch')
  @Post(':code/ready')
  @HttpCode(200)
  ready(@CurrentActor() actor: Actor, @Param('code') code: string, @Body(new ZodValidationPipe(readySchema)) b: z.infer<typeof readySchema>) {
    return this.manifests.markReady(actor, code, b.portManifestNo);
  }

  @RequirePermissions('manifests:create')
  @Post(':code/cancel')
  @HttpCode(200)
  cancel(@CurrentActor() actor: Actor, @Param('code') code: string) {
    return this.manifests.cancel(actor, code);
  }

  /** Driver handover scan + baggage-compartment photo → every parcel on board becomes IN_TRANSIT. */
  @RequirePermissions('manifests:handover')
  @Post(':code/handover')
  @HttpCode(200)
  handover(@CurrentActor() actor: Actor, @Param('code') code: string, @Body(new ZodValidationPipe(handoverSchema)) b: z.infer<typeof handoverSchema>) {
    return this.manifests.handover(actor, code, b.baggagePhotoUploadId);
  }

  @RequirePermissions('manifests:update_trip')
  @Post(':code/arrive')
  @HttpCode(200)
  arrive(@CurrentActor() actor: Actor, @Param('code') code: string) {
    return this.manifests.arrive(actor, code);
  }
}

/* ----------------------------------- inbound scan, incidents, PoD ----------------------------------- */

const inboundSchema = z.object({
  code: z.string().trim().min(5).max(40),
  condition: z.enum(INBOUND_CONDITIONS).default('INTACT'),
  notes: z.string().trim().max(500).optional(),
  incidentPhotoUploadIds: z.array(uuid).max(8).optional(),
  missingWaybills: z.array(waybill).max(100).optional(),
});
const resolveSchema = z.object({
  resolution: z.enum(['RELEASE_TO_RECIPIENT', 'RETURN_TO_SENDER']),
  notes: z.string().trim().min(5).max(500),
  fleetLiable: z.boolean().default(true),
});
const incidentListSchema = z.object({ status: z.enum(['OPEN', 'UNDER_REVIEW', 'RESOLVED', 'CLAIM_FILED']).optional() });
const podSchema = z.object({
  waybill,
  otp: z.string().regex(/^\d{6}$/, { message: 'errors.validation.otp' }),
  collector: z.object({
    name: z.string().trim().min(2, { message: 'errors.validation.name' }).max(120),
    idType: z.enum(['BI', 'KARTAUN_ELEITORAL', 'PASSPORT']),
    idNumber: z.string().trim().min(4, { message: 'errors.validation.id_number' }).max(40),
    isRepresentative: z.boolean().default(false),
  }),
  photoUploadId: uuid,
  storagePenaltyCollected: z.boolean().default(false),
});

@Controller()
export class FieldOpsController {
  constructor(
    private readonly inbound: InboundService,
    private readonly delivery: DeliveryService,
    private readonly bookings: BookingsService,
  ) {}

  /** Destination agent scans a parcel or master bag in front of the driver. */
  @RequirePermissions('inbound:scan')
  @Post('inbound/scan')
  @HttpCode(200)
  scan(@CurrentActor() actor: Actor, @Body(new ZodValidationPipe(inboundSchema)) b: z.infer<typeof inboundSchema>) {
    return this.inbound.scan(actor, b);
  }

  @RequireAnyPermission('incidents:read')
  @Get('incidents')
  incidents(@Query(new ZodValidationPipe(incidentListSchema)) q: z.infer<typeof incidentListSchema>) {
    return this.inbound.listIncidents(q.status);
  }

  /** The driver confirms the incident in their own app. */
  @RequirePermissions('manifests:handover')
  @Post('incidents/:id/driver-confirm')
  @HttpCode(200)
  driverConfirm(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.inbound.driverConfirm(actor, id);
  }

  @RequirePermissions('incidents:manage')
  @Post('incidents/:id/resolve')
  @HttpCode(200)
  resolve(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodValidationPipe(resolveSchema)) b: z.infer<typeof resolveSchema>) {
    return this.inbound.resolve(actor, id, b);
  }

  /** Proof of delivery: OTP + collector ID + PoD photo → DELIVERED + money released. */
  @RequirePermissions('pod:verify')
  @Post('pod/verify')
  @HttpCode(200)
  pod(@CurrentActor() actor: Actor, @Body(new ZodValidationPipe(podSchema)) b: z.infer<typeof podSchema>) {
    return this.delivery.verifyPod(actor, b);
  }

  @RequirePermissions('courier_jobs:read_own')
  @Get('courier/jobs')
  jobs(@CurrentActor() actor: Actor) {
    return this.bookings.courierJobs(actor);
  }
}

/* --------------------------------------- pick-up bookings (ops) --------------------------------------- */

const bookingListSchema = z.object({ status: z.enum(['REQUESTED', 'ASSIGNED', 'PICKED_UP', 'CANCELLED', 'EXPIRED']).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) });
const assignSchema = z.object({ courierId: uuid });
const cancelSchema = z.object({ reason: z.string().trim().min(3).max(300) });

@Controller('pickup-bookings')
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @RequirePermissions('pickups:read')
  @Get()
  list(@Query(new ZodValidationPipe(bookingListSchema)) q: z.infer<typeof bookingListSchema>) {
    return this.bookings.list(q);
  }

  @RequirePermissions('pickups:assign')
  @Post(':id/confirm')
  @HttpCode(200)
  confirm(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.bookings.confirm(actor, id);
  }

  @RequirePermissions('pickups:assign')
  @Post(':id/assign')
  @HttpCode(200)
  assign(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodValidationPipe(assignSchema)) b: z.infer<typeof assignSchema>) {
    return this.bookings.assign(actor, id, b.courierId);
  }

  @RequirePermissions('pickups:assign')
  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodValidationPipe(cancelSchema)) b: z.infer<typeof cancelSchema>) {
    return this.bookings.cancel(actor, id, b.reason);
  }
}

export { pin6 };
