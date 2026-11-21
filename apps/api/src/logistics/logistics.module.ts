import { Module } from '@nestjs/common';
import { BookingsService } from './bookings.service';
import { DeliveryService } from './delivery.service';
import { HubsService } from './hubs.service';
import { InboundService } from './inbound.service';
import { ManifestsService } from './manifests.service';
import { BookingsController, FieldOpsController, HubsController, ManifestsController } from './ops.controller';
import { OtpService } from './otp.service';
import { PricingService } from './pricing.service';
import { PublicController } from './public.controller';
import { ReceiptsService } from './receipts.service';
import { SettlementService } from './settlement.service';
import { ShipmentStateService } from './shipment-state.service';
import { ShipmentsController } from './shipments.controller';
import { ShipmentsService } from './shipments.service';
import { TrackingService } from './tracking.service';
import { UnclaimedService } from './unclaimed.service';
import { WaybillService } from './waybill.service';

/** Phase 3 — the logistics engine. Cross-cutting services (ledger, audit, uploads, notifications, settings) are global. */
@Module({
  controllers: [ShipmentsController, PublicController, HubsController, ManifestsController, FieldOpsController, BookingsController],
  providers: [
    WaybillService,
    ShipmentStateService,
    OtpService,
    PricingService,
    SettlementService,
    ShipmentsService,
    HubsService,
    ManifestsService,
    InboundService,
    DeliveryService,
    BookingsService,
    TrackingService,
    UnclaimedService,
    ReceiptsService,
  ],
  exports: [ShipmentsService, SettlementService, UnclaimedService, OtpService, PricingService],
})
export class LogisticsModule {}
