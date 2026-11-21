import { Module } from '@nestjs/common';
import { LogisticsModule } from '../logistics/logistics.module';
import { AccessService } from './access.service';
import { AccessController, ContentController, DirectoryController } from './admin.controller';
import { AnalyticsService } from './analytics.service';
import { ClaimsService } from './claims.service';
import { ContentService } from './content.service';
import { AnalyticsController, CsController } from './cs.controller';
import { CsOpsService } from './cs-ops.service';
import { DirectoryService } from './directory.service';
import { FinanceController, PayoutsController, ClaimsController } from './finance.controller';
import { FinanceService } from './finance.service';
import { PayoutsService } from './payouts.service';

/** Phase 4 — admin, finance and claims APIs (all behind the Phase-2 guards, audit and idempotency). */
@Module({
  imports: [LogisticsModule],
  controllers: [FinanceController, PayoutsController, ClaimsController, AccessController, ContentController, DirectoryController, CsController, AnalyticsController],
  providers: [FinanceService, PayoutsService, ClaimsService, AccessService, ContentService, DirectoryService, CsOpsService, AnalyticsService],
  exports: [FinanceService, ClaimsService, PayoutsService],
})
export class AdminModule {}
