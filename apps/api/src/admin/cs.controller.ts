import { Body, Controller, Get, HttpCode, Param, Post, Query, StreamableFile } from '@nestjs/common';
import { z } from 'zod';
import { SHIPMENT_STATUSES } from '@670send/types';
import { AuditReasonRequired, CurrentActor, RequirePermissions } from '../common/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { Actor } from '../rbac/actor';
import { AnalyticsService } from './analytics.service';
import { CsOpsService } from './cs-ops.service';

const waybill = z.string().trim().min(10).max(40);
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/** Inclusive Dili calendar dates → half-open [from 00:00, to+1 00:00) range. */
const range = z.object({ from: dateOnly, to: dateOnly }).transform(({ from, to }) => ({
  from: new Date(`${from}T00:00:00+09:00`),
  to: new Date(new Date(`${to}T00:00:00+09:00`).getTime() + 86_400_000),
}));

const rtsList = z.object({ stage: z.enum(['TO_RECEIVE', 'AT_HUB', 'DONE']).optional(), limit: z.coerce.number().int().min(1).max(200).default(100) });
const handBackBody = z.object({
  collectorName: z.string().trim().min(2).max(120),
  idType: z.enum(['BI', 'KARTAUN_ELEITORAL', 'PASSPORT']),
  idNumber: z.string().trim().min(4).max(40),
  isRepresentative: z.boolean().default(false),
});
const overrideBody = z.object({ status: z.enum(SHIPMENT_STATUSES), notes: z.string().trim().max(300).optional(), reason: z.string().trim().min(5).max(500).optional() });
const reminderBody = z.object({ kind: z.enum(['DAY3', 'DAY5']) });

@Controller()
export class CsController {
  constructor(private readonly cs: CsOpsService) {}

  @RequirePermissions('rts:manage')
  @Get('rts')
  queue(@Query(new ZodValidationPipe(rtsList)) q: z.infer<typeof rtsList>) {
    return this.cs.rtsQueue(q);
  }

  @RequirePermissions('rts:manage')
  @Post('rts/:waybill/received')
  @HttpCode(200)
  received(@CurrentActor() actor: Actor, @Param('waybill') w: string) {
    return this.cs.receiveAtHub(actor, w);
  }

  @RequirePermissions('rts:manage')
  @Post('rts/:waybill/hand-back')
  @HttpCode(200)
  handBack(@CurrentActor() actor: Actor, @Param('waybill') w: string, @Body(new ZodValidationPipe(handBackBody)) b: z.infer<typeof handBackBody>) {
    return this.cs.handBack(actor, w, b);
  }

  /** Super-Admin force override: the `reason` (body) or `X-Audit-Reason` header is mandatory and audited. */
  @RequirePermissions('shipments:override_status')
  @AuditReasonRequired()
  @Post('admin/shipments/:waybill/override-status')
  @HttpCode(200)
  override(@CurrentActor() actor: Actor, @Param('waybill') w: string, @Body(new ZodValidationPipe(overrideBody)) b: z.infer<typeof overrideBody>) {
    return this.cs.overrideStatus(actor, w, b.status, b.notes);
  }

  @RequirePermissions('notifications:send_reminder')
  @Post('shipments/:waybill/reminders')
  @HttpCode(200)
  reminder(@CurrentActor() actor: Actor, @Param('waybill') w: string, @Body(new ZodValidationPipe(reminderBody)) b: z.infer<typeof reminderBody>) {
    return this.cs.sendStorageReminder(actor, w, b.kind);
  }
}

@Controller()
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  /** Executive KPI dashboard: GMV today / month, platform revenue, reserves, queues, volume by corridor. */
  @RequirePermissions('dashboard:view')
  @Get('analytics/executive')
  executive() {
    return this.analytics.executive();
  }

  @RequirePermissions('dashboard:view')
  @Get('analytics/volume')
  volume(@Query(new ZodValidationPipe(range.pipe(z.object({ from: z.date(), to: z.date() })))) r: { from: Date; to: Date }, @Query('groupBy') groupBy?: string) {
    return this.analytics.volume({ ...r, groupBy: groupBy === 'municipality' ? 'municipality' : 'day' });
  }

  private csv(text: string, name: string) {
    return new StreamableFile(Buffer.from(`﻿${text}`, 'utf8'), { type: 'text/csv; charset=utf-8', disposition: `attachment; filename="${name}.csv"` });
  }

  @RequirePermissions('reports:export')
  @Get('reports/shipments.csv')
  async shipments(@Query(new ZodValidationPipe(range)) r: { from: Date; to: Date }) {
    return this.csv(await this.analytics.shipmentsCsv(r), 'shipments');
  }

  @RequirePermissions('reports:export', 'ledger:read')
  @Get('reports/ledger.csv')
  async ledger(@Query(new ZodValidationPipe(range)) r: { from: Date; to: Date }) {
    return this.csv(await this.analytics.ledgerCsv(r), 'ledger');
  }

  @RequirePermissions('reports:export', 'claims:read')
  @Get('reports/claims.csv')
  async claims(@Query(new ZodValidationPipe(range)) r: { from: Date; to: Date }) {
    return this.csv(await this.analytics.claimsCsv(r), 'claims');
  }

  @RequirePermissions('reports:export', 'deposits:read')
  @Get('reports/deposits.csv')
  async deposits(@Query(new ZodValidationPipe(range)) r: { from: Date; to: Date }) {
    return this.csv(await this.analytics.depositsCsv(r), 'deposits');
  }
}
