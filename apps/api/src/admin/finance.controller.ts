import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Query, StreamableFile } from '@nestjs/common';
import { z } from 'zod';
import { PAYMENT_CHANNELS } from '@670send/types';
import { CurrentActor, Idempotent, RequireAnyPermission, RequirePermissions } from '../common/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { moneyInput, uuid } from '../logistics/dto';
import type { Actor } from '../rbac/actor';
import { ClaimsService } from './claims.service';
import { DirectoryService } from './directory.service';
import { FinanceService } from './finance.service';
import { PayoutsService } from './payouts.service';

const limit = (max = 100, def = 30) => z.coerce.number().int().min(1).max(max).default(def);
const isoDate = z.string().datetime();

/* ------------------------------------------- deposits / wallets / ledger ------------------------------------------- */

const depositSchema = z.object({
  amountUsd: moneyInput,
  channel: z.enum(PAYMENT_CHANNELS),
  referenceNo: z.string().trim().min(3).max(60),
  proofUploadId: uuid.optional(),
  note: z.string().trim().max(300).optional(),
});
const depositListSchema = z.object({ status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(), ownerType: z.enum(['AGENT', 'COURIER']).optional(), limit: limit(), before: isoDate.optional() });
const reasonSchema = z.object({ reason: z.string().trim().min(3).max(300) });
const statementSchema = z.object({ limit: limit(200, 50), before: isoDate.optional() });
const walletsSchema = z.object({ ownerType: z.enum(['USER', 'AGENT', 'COURIER', 'FLEET_OWNER', 'SYSTEM']).optional(), ownerId: uuid.optional(), walletType: z.string().optional(), limit: limit(200, 100) });
const ledgerSchema = z.object({ walletId: uuid.optional(), referenceType: z.string().optional(), referenceId: z.string().max(80).optional(), from: isoDate.optional(), to: isoDate.optional(), limit: limit(200, 50), before: isoDate.optional() });
const refundSchema = z.object({ waybill: z.string().trim().min(10).max(40), reason: z.string().trim().min(5).max(300), reference: z.string().trim().max(80).optional() });

@Controller()
export class FinanceController {
  constructor(private readonly finance: FinanceService) {}

  /** Agent / courier asks for a deposit top-up (slip photo staged first via POST /uploads/photos, type DEPOSIT_PROOF). */
  @RequirePermissions('deposits:request')
  @Idempotent()
  @Post('deposits/requests')
  request(@CurrentActor() actor: Actor, @Headers('idempotency-key') key: string, @Body(new ZodValidationPipe(depositSchema)) b: z.infer<typeof depositSchema>) {
    return this.finance.requestDeposit(actor, b, key);
  }

  @RequireAnyPermission('deposits:request', 'deposits:read')
  @Get('deposits/requests')
  list(@CurrentActor() actor: Actor, @Query(new ZodValidationPipe(depositListSchema)) q: z.infer<typeof depositListSchema>) {
    return this.finance.listDeposits(actor, q);
  }

  @RequirePermissions('deposits:read')
  @Get('finance/deposits/:id/proof')
  proof(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.finance.proofUrl(id);
  }

  /** Maker-checker: the requester can never approve their own request. */
  @RequirePermissions('deposits:approve')
  @Idempotent({ required: false })
  @Post('finance/deposits/:id/approve')
  @HttpCode(200)
  approve(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.finance.approveDeposit(actor, id);
  }

  @RequirePermissions('deposits:approve')
  @Post('finance/deposits/:id/reject')
  @HttpCode(200)
  reject(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodValidationPipe(reasonSchema)) b: z.infer<typeof reasonSchema>) {
    return this.finance.rejectDeposit(actor, id, b.reason);
  }

  @RequirePermissions('wallets:read_own')
  @Get('wallets/me')
  mine(@CurrentActor() actor: Actor) {
    return this.finance.myWallets(actor);
  }

  @RequireAnyPermission('wallets:read_own', 'wallets:read_all')
  @Get('wallets/:id/statement')
  statement(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string, @Query(new ZodValidationPipe(statementSchema)) q: z.infer<typeof statementSchema>) {
    return this.finance.statement(actor, id, q);
  }

  @RequirePermissions('wallets:read_all')
  @Get('finance/wallets')
  wallets(@Query(new ZodValidationPipe(walletsSchema)) q: z.infer<typeof walletsSchema>) {
    return this.finance.adminWallets(q);
  }

  @RequirePermissions('ledger:read')
  @Get('finance/ledger')
  ledger(@Query(new ZodValidationPipe(ledgerSchema)) q: z.infer<typeof ledgerSchema>) {
    return this.finance.adminLedger(q);
  }

  @RequirePermissions('reconciliation:run')
  @Get('finance/reconciliation')
  reconciliation() {
    return this.finance.reconciliation();
  }

  @RequirePermissions('refunds:issue')
  @Idempotent()
  @Post('finance/refunds')
  @HttpCode(200)
  refund(@CurrentActor() actor: Actor, @Body(new ZodValidationPipe(refundSchema)) b: z.infer<typeof refundSchema>) {
    return this.finance.refundUnusedDeliveryAddon(actor, b.waybill, b);
  }
}

/* ------------------------------------------------------ payouts ------------------------------------------------------ */

const generateSchema = z
  .object({ fleetPartnerId: uuid.optional(), cycle: z.enum(['DAILY', 'WEEKLY']).optional(), periodStart: isoDate.optional(), periodEnd: isoDate.optional() })
  .refine((v) => v.fleetPartnerId || v.cycle, { message: 'errors.validation_failed', path: ['cycle'] });
const payoutListSchema = z.object({ status: z.string().optional(), fleetPartnerId: uuid.optional(), limit: limit() });
const payBody = z.object({ bankReference: z.string().trim().min(3).max(80) });
const failBody = z.object({ reason: z.string().trim().min(3).max(300) });
const statementQuery = z.object({ format: z.enum(['json', 'csv']).default('json') });

@Controller()
export class PayoutsController {
  constructor(
    private readonly payouts: PayoutsService,
    private readonly directory: DirectoryService,
  ) {}

  @RequirePermissions('payouts:create')
  @Idempotent()
  @Post('finance/payouts/generate')
  @HttpCode(200)
  generate(@CurrentActor() actor: Actor, @Headers('idempotency-key') key: string, @Body(new ZodValidationPipe(generateSchema)) b: z.infer<typeof generateSchema>) {
    return this.payouts.generate(actor, { fleetPartnerId: b.fleetPartnerId, cycle: b.cycle, periodStart: b.periodStart ? new Date(b.periodStart) : undefined, periodEnd: b.periodEnd ? new Date(b.periodEnd) : undefined }, key);
  }

  @RequirePermissions('payouts:read')
  @Get('finance/payouts')
  list(@Query(new ZodValidationPipe(payoutListSchema)) q: z.infer<typeof payoutListSchema>) {
    return this.payouts.list(q);
  }

  @RequirePermissions('payouts:read')
  @Get('finance/payouts/:id')
  get(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.payouts.dto(id);
  }

  @RequirePermissions('payouts:read')
  @Get('finance/payouts/:id/statement')
  async statement(@Param('id', new ParseUUIDPipe()) id: string, @Query(new ZodValidationPipe(statementQuery)) q: z.infer<typeof statementQuery>) {
    if (q.format === 'csv') return this.csv(await this.payouts.statementCsv(id), id);
    return this.payouts.statement(id);
  }

  private csv(text: string, name: string) {
    return new StreamableFile(Buffer.from(`﻿${text}`, 'utf8'), { type: 'text/csv; charset=utf-8', disposition: `attachment; filename="payout-${name}.csv"` });
  }

  @RequirePermissions('payouts:create')
  @Post('finance/payouts/:id/submit')
  @HttpCode(200)
  submit(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.payouts.submit(actor, id);
  }

  @RequirePermissions('payouts:approve')
  @Post('finance/payouts/:id/approve')
  @HttpCode(200)
  approve(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.payouts.approve(actor, id);
  }

  @RequirePermissions('payouts:approve')
  @Idempotent({ required: false })
  @Post('finance/payouts/:id/pay')
  @HttpCode(200)
  pay(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodValidationPipe(payBody)) b: z.infer<typeof payBody>) {
    return this.payouts.pay(actor, id, b);
  }

  @RequirePermissions('payouts:approve')
  @Post('finance/payouts/:id/fail')
  @HttpCode(200)
  fail(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodValidationPipe(failBody)) b: z.infer<typeof failBody>) {
    return this.payouts.fail(actor, id, b.reason);
  }

  @RequirePermissions('payouts:create')
  @Post('finance/payouts/:id/cancel')
  @HttpCode(200)
  cancel(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.payouts.cancel(actor, id);
  }

  /** Bank / MOSAN details for the transfer — decrypted on demand and every read is audited. */
  @RequirePermissions('payouts:approve')
  @Get('finance/fleet-partners/:id/bank-details')
  bank(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.directory.revealBankDetails(actor, id);
  }

  /* ------------------------------- fleet owner portal (scoped to their company) ------------------------------- */

  @RequirePermissions('fleet_partners:read_own')
  @Get('fleet/me')
  me(@CurrentActor() actor: Actor) {
    return this.directory.myFleet(actor);
  }

  @RequirePermissions('payouts:read_own')
  @Get('fleet/payouts')
  own(@CurrentActor() actor: Actor, @Query(new ZodValidationPipe(z.object({ limit: limit() }))) q: { limit: number }) {
    return this.payouts.listOwn(actor, q);
  }

  @RequirePermissions('payouts:read_own')
  @Get('fleet/payouts/:id/statement')
  async ownStatement(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string, @Query(new ZodValidationPipe(statementQuery)) q: z.infer<typeof statementQuery>) {
    const scope = actor.fleetPartnerId ?? '00000000-0000-0000-0000-000000000000';
    if (q.format === 'csv') return this.csv(await this.payouts.statementCsv(id, scope), id);
    return this.payouts.statement(id, scope);
  }

  @RequirePermissions('payouts:read_own')
  @Get('fleet/earnings')
  earnings(@CurrentActor() actor: Actor, @Query(new ZodValidationPipe(z.object({ limit: limit(200, 50), before: isoDate.optional() }))) q: { limit: number; before?: string }) {
    return this.payouts.earnings(actor, q);
  }
}

/* ------------------------------------------------------- claims ------------------------------------------------------- */

const fileClaimSchema = z.object({
  waybill: z.string().trim().min(10).max(40),
  claimType: z.enum(['LOST', 'DAMAGED', 'SEAL_TAMPERED']),
  requestedAmountUsd: moneyInput,
  description: z.string().trim().max(1000).optional(),
  claimantName: z.string().trim().max(120).optional(),
  claimantPhone: z.string().trim().max(30).optional(),
  evidenceUploadIds: z.array(uuid).max(10).optional(),
  lateFilingReason: z.string().trim().min(5).max(300).optional(),
});
const claimListSchema = z.object({ status: z.string().optional(), mine: z.enum(['true', 'false']).transform((v) => v === 'true').optional(), waybill: z.string().max(40).optional(), limit: limit(), before: isoDate.optional() });
const decisionSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  approvedAmountUsd: moneyInput.optional(),
  liableParty: z.enum(['FLEET_PARTNER', 'ORIGIN_AGENT', 'DEST_AGENT', 'COURIER', 'PLATFORM_ESCROW']).optional(),
  notes: z.string().trim().max(500).optional(),
  reason: z.string().trim().min(3).max(300).optional(),
});
const claimPaySchema = z.object({ channel: z.enum(PAYMENT_CHANNELS).optional(), reference: z.string().trim().min(3).max(80) });
const evidenceSchema = z.object({ uploadIds: z.array(uuid).min(1).max(10) });

@Controller('claims')
export class ClaimsController {
  constructor(private readonly claims: ClaimsService) {}

  /** What the most this parcel can ever pay (SOP cap) — shown before the form is filled in. */
  @RequireAnyPermission('claims:file', 'claims:read')
  @Get('liability/:waybill')
  liability(@CurrentActor() actor: Actor, @Param('waybill') waybill: string) {
    return this.claims.liabilityPreview(actor, waybill);
  }

  @RequirePermissions('claims:file')
  @Idempotent()
  @Post()
  file(@CurrentActor() actor: Actor, @Body(new ZodValidationPipe(fileClaimSchema)) b: z.infer<typeof fileClaimSchema>) {
    return this.claims.file(actor, b);
  }

  @RequireAnyPermission('claims:read', 'claims:file')
  @Get()
  list(@CurrentActor() actor: Actor, @Query(new ZodValidationPipe(claimListSchema)) q: z.infer<typeof claimListSchema>) {
    return this.claims.list(actor, q);
  }

  @RequireAnyPermission('claims:read', 'claims:file')
  @Get(':id')
  get(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.claims.get(actor, id);
  }

  /** Side-by-side desk: open-box, baggage, inbound-incident and PoD photos as short-lived signed URLs. */
  @RequirePermissions('claims:read', 'evidence:read')
  @Get(':id/evidence')
  evidence(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.claims.evidence(id);
  }

  @RequirePermissions('claims:file')
  @Post(':id/evidence')
  @HttpCode(200)
  addEvidence(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodValidationPipe(evidenceSchema)) b: z.infer<typeof evidenceSchema>) {
    return this.claims.addEvidence(actor, id, b.uploadIds);
  }

  @RequirePermissions('claims:review')
  @Post(':id/review')
  @HttpCode(200)
  review(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.claims.startReview(actor, id);
  }

  @RequirePermissions('claims:approve')
  @Post(':id/decision')
  @HttpCode(200)
  decide(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodValidationPipe(decisionSchema)) b: z.infer<typeof decisionSchema>) {
    return this.claims.decide(actor, id, b);
  }

  @RequirePermissions('claims:finance_approve')
  @Post(':id/finance-approve')
  @HttpCode(200)
  financeApprove(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.claims.financeApprove(actor, id);
  }

  /** One-click payout from the claim escrow reserve. */
  @RequirePermissions('claims:pay')
  @Idempotent({ required: false })
  @Post(':id/pay')
  @HttpCode(200)
  pay(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodValidationPipe(claimPaySchema)) b: z.infer<typeof claimPaySchema>) {
    return this.claims.pay(actor, id, b);
  }

  /** Retry charging the liable agent / courier when their deposit could not cover everything at payout time. */
  @RequirePermissions('claims:pay')
  @Post(':id/recover')
  @HttpCode(200)
  async recover(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string) {
    await this.claims.recoverFromParty(actor, id);
    return this.claims.dto(id);
  }
}
