import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, StreamableFile } from '@nestjs/common';
import { z } from 'zod';
import { LOCALES } from '@670send/types';
import { CurrentActor, Idempotent, RequireAnyPermission, RequirePermissions } from '../common/decorators';
import { RequestContext } from '../common/request-context';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { Actor } from '../rbac/actor';
import { DeliveryService } from './delivery.service';
import { intakeSchema, listQuerySchema, type IntakeInput } from './dto';
import { ReceiptsService, type PrintableShipment } from './receipts.service';
import { SHIPMENT_INCLUDE, ShipmentsService } from './shipments.service';

const printQuery = z.object({
  lang: z.enum(LOCALES).optional(),
  format: z.enum(['json', 'escpos', 'text']).default('json'),
});
const failedBody = z.object({ notes: z.string().trim().max(300).optional() });

@Controller('shipments')
export class ShipmentsController {
  constructor(
    private readonly shipments: ShipmentsService,
    private readonly receipts: ReceiptsService,
    private readonly delivery: DeliveryService,
  ) {}

  /** Intake (drop-off wizard step 5 / courier on-site intake). Requires an Idempotency-Key. */
  @RequirePermissions('shipments:create')
  @Idempotent()
  @Post()
  create(
    @CurrentActor() actor: Actor,
    @Headers('idempotency-key') key: string,
    @Body(new ZodValidationPipe(intakeSchema)) body: IntakeInput,
  ) {
    return this.shipments.intake(actor, body, key);
  }

  @RequireAnyPermission('shipments:read_own', 'shipments:read_all')
  @Get()
  list(@CurrentActor() actor: Actor, @Query(new ZodValidationPipe(listQuerySchema)) q: z.infer<typeof listQuerySchema>) {
    return this.shipments.list(actor, q);
  }

  @RequireAnyPermission('shipments:read_own', 'shipments:read_all')
  @Get(':ref')
  get(@CurrentActor() actor: Actor, @Param('ref') ref: string) {
    return this.shipments.get(actor, ref);
  }

  @RequireAnyPermission('shipments:read_own', 'shipments:read_all')
  @Get(':ref/events')
  events(@CurrentActor() actor: Actor, @Param('ref') ref: string) {
    return this.shipments.events(actor, ref);
  }

  /** 58 mm receipt. `?lang=` switches the language before printing; `?format=escpos` returns raw bytes. */
  @RequirePermissions('shipments:print_label')
  @Get(':ref/receipt')
  async receipt(@CurrentActor() actor: Actor, @Param('ref') ref: string, @Query(new ZodValidationPipe(printQuery)) q: z.infer<typeof printQuery>) {
    const s = await this.printable(actor, ref);
    const job = this.receipts.receipt(s, q.lang ?? this.printLang(actor, s));
    return this.respond(job, q.format, 'receipt');
  }

  @RequirePermissions('shipments:print_label')
  @Get(':ref/label')
  async label(@CurrentActor() actor: Actor, @Param('ref') ref: string, @Query(new ZodValidationPipe(printQuery)) q: z.infer<typeof printQuery>) {
    const s = await this.printable(actor, ref);
    const job = this.receipts.label(s, q.lang ?? this.printLang(actor, s));
    return this.respond(job, q.format, 'label');
  }

  private async printable(actor: Actor, ref: string): Promise<PrintableShipment> {
    return (await this.shipments.getScoped(actor, ref, SHIPMENT_INCLUDE)) as unknown as PrintableShipment;
  }

  /** Print language: explicit ?lang → X-Lang / saved preference of the printing user → the sender's language. */
  private printLang(actor: Actor, s: PrintableShipment) {
    return RequestContext.current()?.locale ?? actor.lang ?? this.receipts.defaultLang(s);
  }

  private respond(job: ReturnType<ReceiptsService['receipt']>, format: 'json' | 'escpos' | 'text', name: string) {
    if (format === 'escpos') {
      return new StreamableFile(Buffer.from(job.escposBase64, 'base64'), { type: 'application/octet-stream', disposition: `inline; filename="${name}.bin"` });
    }
    if (format === 'text') return new StreamableFile(Buffer.from(job.text, 'utf8'), { type: 'text/plain; charset=utf-8' });
    return job;
  }

  /* ------------------------ hand-over helpers for kiosks and couriers ------------------------ */

  /** What the recipient owes for storage today (free 5 days, then USD 0.50/day). */
  @RequireAnyPermission('pod:verify')
  @Get(':ref/storage-fee')
  storageFee(@CurrentActor() actor: Actor, @Param('ref') ref: string) {
    return this.delivery.storageFee(actor, ref);
  }

  /** The recipient lost the WhatsApp: issue a fresh OTP (old one is invalidated). */
  @RequireAnyPermission('pod:verify')
  @Post(':ref/resend-otp')
  @HttpCode(200)
  resendOtp(@CurrentActor() actor: Actor, @Param('ref') ref: string) {
    return this.delivery.resendOtp(actor, ref);
  }

  @RequirePermissions('courier_jobs:execute')
  @Post(':ref/out-for-delivery')
  @HttpCode(200)
  outForDelivery(@CurrentActor() actor: Actor, @Param('ref') ref: string) {
    return this.delivery.startDelivery(actor, ref);
  }

  @RequirePermissions('courier_jobs:execute')
  @Post(':ref/delivery-failed')
  @HttpCode(200)
  deliveryFailed(@CurrentActor() actor: Actor, @Param('ref') ref: string, @Body(new ZodValidationPipe(failedBody)) body: z.infer<typeof failedBody>) {
    return this.delivery.deliveryFailed(actor, ref, body.notes);
  }
}

