import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { LOCALES } from '@670send/types';
import { tlWhatsAppPhoneSchema } from '@670send/validation';
import { Public } from '../common/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { BookingsService } from './bookings.service';
import { quoteSchema } from './dto';
import { PricingService, quoteToDto } from './pricing.service';
import { TrackingService } from './tracking.service';

const bookingSchema = z.object({
  senderName: z.string().trim().min(3, { message: 'errors.validation.name' }).max(120),
  senderPhone: tlWhatsAppPhoneSchema,
  preferredLang: z.enum(LOCALES).default('tet'),
  scheme: z.enum(['SCHEME_B', 'SCHEME_D']).default('SCHEME_B'),
  destMunicipalityCode: z.string().trim().length(3).transform((v) => v.toUpperCase()).optional(),
  parcelCount: z.number().int().min(1).max(50).default(1),
  estimatedWeightKg: z.number().positive().max(500).optional(),
  pickupAddress: z.string().trim().min(5).max(300),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  notes: z.string().trim().max(300).optional(),
});

/**
 * Anonymous endpoints for 670send.tl: rate calculator, waybill tracker and pick-up request.
 * Everything here is covered by the general per-IP rate limit and exposes no personal data.
 */
@Controller('public')
export class PublicController {
  constructor(
    private readonly pricing: PricingService,
    private readonly tracking: TrackingService,
    private readonly bookings: BookingsService,
  ) {}

  /** Itemised price + which fleet carries it (bus baggage, cargo pickup, or sea ferry). */
  @Public()
  @Post('quote')
  @HttpCode(200)
  async quote(@Body(new ZodValidationPipe(quoteSchema)) b: z.infer<typeof quoteSchema>) {
    const q = await this.pricing.quote({
      originCode: b.originMunicipalityCode,
      destCode: b.destMunicipalityCode,
      scheme: b.scheme,
      actualWeightKg: b.parcel.actualWeightKg,
      lengthCm: b.parcel.lengthCm,
      widthCm: b.parcel.widthCm,
      heightCm: b.parcel.heightCm,
      itemCategory: b.itemCategory,
      isFragile: b.isFragile,
      isHeavyBulk: b.isHeavyBulk,
      declaredValue: b.declaredValueUsd,
      insure: b.insure,
    });
    return quoteToDto(q);
  }

  @Public()
  @Get('track/:waybill')
  track(@Param('waybill') waybill: string) {
    return this.tracking.track(waybill);
  }

  @Public()
  @Post('pickup-bookings')
  create(@Body(new ZodValidationPipe(bookingSchema)) b: z.infer<typeof bookingSchema>) {
    return this.bookings.createPublic({ ...b, preferredLang: b.preferredLang });
  }
}
