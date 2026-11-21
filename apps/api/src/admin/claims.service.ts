import { Injectable } from '@nestjs/common';
import { Prisma, type ClaimType, type LiableParty, type PaymentChannel } from '@prisma/client';
import { hasPermission } from '@670send/types';
import { formatMoneyDb, maxEligibleLiability, parseMoney, yymmddDili } from '@670send/pricing';
import { AuditService } from '../audit/audit.service';
import { AppException, Err } from '../common/errors';
import { SettingsService } from '../common/settings.service';
import { LedgerService, type PostingLine, type WalletRef } from '../ledger/ledger.service';
import { PrismaService } from '../prisma/prisma.service';
import type { Actor } from '../rbac/actor';
import { canAccess } from '../rbac/scope';
import { StorageService } from '../storage/storage.service';

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const usd = (d: Prisma.Decimal | null | undefined) => (d == null ? null : d.toFixed(4));
const sys = LedgerService.systemWallet;

export interface FileClaimInput {
  waybill: string;
  claimType: ClaimType;
  requestedAmountUsd: string;
  description?: string;
  claimantName?: string;
  claimantPhone?: string;
  evidenceUploadIds?: string[];
  lateFilingReason?: string;
}

/**
 * How a recovery from the liable party is split back into the funds that paid the claim:
 * the insurance pool is made whole first (up to what it paid), the rest goes to the claim escrow reserve.
 */
export function recoveryCredits(
  claim: { paidFromInsuranceUsd: Prisma.Decimal; recoveredAmountUsd: Prisma.Decimal },
  amount: Prisma.Decimal,
): { pool: Prisma.Decimal; escrow: Prisma.Decimal } {
  const poolOwed = claim.paidFromInsuranceUsd;
  const poolRecoveredBefore = Prisma.Decimal.min(claim.recoveredAmountUsd, poolOwed);
  const pool = Prisma.Decimal.min(amount, poolOwed.minus(poolRecoveredBefore));
  return { pool, escrow: amount.minus(pool) };
}

/**
 * Claims engine (SOP §7).
 *  • liability cap computed by the SOP rule: insured → declared value (max $500); uninsured → min(10 × base fee, $50);
 *  • damage / seal claims on a delivered parcel are only valid at hand-over (setting `claim_handover_window_minutes`);
 *  • CS approves up to `claim_cs_approval_limit_usd`; above it Finance must co-approve (a DIFFERENT person);
 *  • payout in one click from the claim escrow reserve (insured claims: insurance pool first, escrow for any shortfall);
 *  • the liable party is charged back: agent / courier deposit now, fleet owner through the next payout.
 */
@Injectable()
export class ClaimsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  /* ----------------------------------- helpers ----------------------------------- */

  private async threshold(): Promise<Prisma.Decimal> {
    return D(await this.settings.get<string>('claim_cs_approval_limit_usd', '25.00'));
  }

  private maxLiability(s: { isInsured: boolean; insuredAmountUsd: Prisma.Decimal | null; baseShippingFeeUsd: Prisma.Decimal }): Prisma.Decimal {
    return D(
      formatMoneyDb(
        maxEligibleLiability({
          isInsured: s.isInsured,
          declaredValue: s.insuredAmountUsd?.toFixed(4) ?? null,
          baseShippingFee: s.baseShippingFeeUsd.toFixed(4),
        }),
      ),
    );
  }

  private async nextClaimNo(tx: Prisma.TransactionClient): Promise<string> {
    const key = yymmddDili(new Date());
    const rows = await tx.$queryRaw<Array<{ last_value: number }>>`
      INSERT INTO waybill_sequences (origin_code, dest_code, date_key, last_value, updated_at)
      VALUES ('CLM', 'CLM', ${key}, 1, now())
      ON CONFLICT (origin_code, dest_code, date_key)
      DO UPDATE SET last_value = waybill_sequences.last_value + 1, updated_at = now()
      RETURNING last_value`;
    return `CLM-${key}-${String(rows[0]!.last_value).padStart(4, '0')}`;
  }

  /** Liability preview for the filing screen: what is the most this parcel can ever pay out. */
  async liabilityPreview(actor: Actor, waybill: string) {
    const s = await this.prisma.shipment.findUnique({ where: { waybillNumber: waybill.toUpperCase() } });
    if (!s || !this.canTouch(actor, s)) throw Err.notFound();
    const max = this.maxLiability(s);
    const used = await this.activeTotal(s.id);
    return {
      waybill: s.waybillNumber,
      isInsured: s.isInsured,
      basis: s.isInsured ? 'INSURED_DECLARED_VALUE_MAX_500' : 'UNINSURED_10X_BASE_FEE_MAX_50',
      maxEligible: usd(max),
      alreadyClaimed: usd(used),
      remaining: usd(Prisma.Decimal.max(max.minus(used), D(0))),
    };
  }

  private canTouch(actor: Actor, s: { originAgentId: string | null; destAgentId: string | null; pickupCourierId: string | null; deliveryCourierId: string | null }): boolean {
    return (
      hasPermission(actor.permissions, 'claims:review') ||
      canAccess(actor, { agentIds: [s.originAgentId, s.destAgentId], courierIds: [s.pickupCourierId, s.deliveryCourierId] }, 'shipments:read_all')
    );
  }

  private async activeTotal(shipmentId: string, exceptClaimId?: string): Promise<Prisma.Decimal> {
    const agg = await this.prisma.claim.aggregate({
      _sum: { approvedAmountUsd: true },
      where: { shipmentId, status: { in: ['INVESTIGATING', 'APPROVED', 'PAID'] }, approvedAmountUsd: { not: null }, ...(exceptClaimId ? { id: { not: exceptClaimId } } : {}) },
    });
    return agg._sum.approvedAmountUsd ?? D(0);
  }

  /* ------------------------------------ filing ------------------------------------ */

  async file(actor: Actor, input: FileClaimInput) {
    const s = await this.prisma.shipment.findUnique({ where: { waybillNumber: input.waybill.toUpperCase() } });
    if (!s || !this.canTouch(actor, s)) throw Err.notFound();

    const requested = parseMoney(input.requestedAmountUsd);
    if (requested <= 0n) throw Err.validation([{ path: 'requestedAmountUsd', message: 'errors.validation_failed' }]);

    // "Claims after the parcel has been taken home are not valid" — except a documented exception by an approver.
    let lateReason: string | undefined;
    if (s.status === 'DELIVERED') {
      const minutes = await this.settings.get<number>('claim_handover_window_minutes', 60);
      const late = !s.deliveredAt || Date.now() - s.deliveredAt.getTime() > minutes * 60_000;
      if (input.claimType === 'LOST') throw new AppException('claim_deadline_passed', 422);
      if (late) {
        if (!input.lateFilingReason || !hasPermission(actor.permissions, 'claims:approve')) throw new AppException('claim_deadline_passed', 422);
        lateReason = input.lateFilingReason;
      }
    }

    const maxEligible = this.maxLiability(s);

    const claim = await this.prisma.$transaction(async (tx) => {
      const evidence: Array<{ uri: string; sha256: string; kind: string }> = [];
      if (input.evidenceUploadIds?.length) {
        const ids = [...new Set(input.evidenceUploadIds)];
        const ups = await tx.stagedUpload.findMany({ where: { id: { in: ids }, uploadedBy: actor.id, photoType: 'CLAIM_EVIDENCE', consumedAt: null } });
        if (ups.length !== ids.length) throw Err.uploadNotFound();
        await tx.stagedUpload.updateMany({ where: { id: { in: ids } }, data: { consumedAt: new Date(), consumedByShipmentId: s.id } });
        evidence.push(...ups.map((u) => ({ uri: u.fileUrl, sha256: u.sha256, kind: 'CLAIM_EVIDENCE' })));
      }
      const row = await tx.claim.create({
        data: {
          claimNo: await this.nextClaimNo(tx),
          shipmentId: s.id,
          filedBy: actor.id,
          claimType: input.claimType,
          description: input.description,
          claimantName: input.claimantName,
          claimantPhone: input.claimantPhone,
          requestedAmountUsd: formatMoneyDb(requested),
          maxEligibleLiabilityUsd: maxEligible,
          evidenceUrls: evidence as Prisma.InputJsonValue,
          lateFilingReason: lateReason,
        },
      });
      await this.audit.writeInTx(tx, {
        action: 'CLAIM_FILED',
        entityType: 'claim',
        entityId: row.id,
        after: { claimNo: row.claimNo, waybill: s.waybillNumber, type: input.claimType, requested: formatMoneyDb(requested), maxEligible: maxEligible.toFixed(4), late: Boolean(lateReason) },
      });
      return row;
    });
    return this.dto(claim.id);
  }

  async addEvidence(actor: Actor, id: string, uploadIds: string[]) {
    const c = await this.loadScoped(actor, id);
    if (['PAID', 'REJECTED'].includes(c.status)) throw new AppException('shipment_wrong_state', 409);
    const ids = [...new Set(uploadIds)];
    await this.prisma.$transaction(async (tx) => {
      const ups = await tx.stagedUpload.findMany({ where: { id: { in: ids }, uploadedBy: actor.id, photoType: 'CLAIM_EVIDENCE', consumedAt: null } });
      if (ups.length !== ids.length) throw Err.uploadNotFound();
      await tx.stagedUpload.updateMany({ where: { id: { in: ids } }, data: { consumedAt: new Date(), consumedByShipmentId: c.shipmentId } });
      const current = (c.evidenceUrls as Array<unknown>) ?? [];
      await tx.claim.update({
        where: { id },
        data: { evidenceUrls: [...current, ...ups.map((u) => ({ uri: u.fileUrl, sha256: u.sha256, kind: 'CLAIM_EVIDENCE' }))] as Prisma.InputJsonValue },
      });
    });
    return this.dto(id);
  }

  /* ----------------------------------- reading ----------------------------------- */

  private async loadScoped(actor: Actor, id: string) {
    const c = await this.prisma.claim.findUnique({ where: { id } });
    if (!c) throw Err.notFound();
    if (!hasPermission(actor.permissions, 'claims:read') && c.filedBy !== actor.id) throw Err.notFound();
    return c;
  }

  async dto(id: string) {
    const c = await this.prisma.claim.findUniqueOrThrow({
      where: { id },
      include: {
        shipment: { select: { waybillNumber: true, status: true, isInsured: true } },
        filer: { select: { fullName: true } },
        reviewer: { select: { fullName: true } },
        financeApprover: { select: { fullName: true } },
      },
    });
    const th = await this.threshold();
    const approved = c.approvedAmountUsd;
    const recoverable = c.status === 'PAID' && c.liableParty && c.liableParty !== 'PLATFORM_ESCROW';
    return {
      id: c.id,
      claimNo: c.claimNo,
      status: c.status,
      type: c.claimType,
      waybill: c.shipment.waybillNumber,
      shipmentStatus: c.shipment.status,
      isInsured: c.shipment.isInsured,
      description: c.description,
      claimant: { name: c.claimantName, phone: c.claimantPhone },
      requested: usd(c.requestedAmountUsd),
      maxEligible: usd(c.maxEligibleLiabilityUsd),
      approved: usd(approved),
      liableParty: c.liableParty,
      needsFinanceApproval: Boolean(approved && approved.greaterThan(th) && !c.financeApprovedBy && c.status !== 'REJECTED'),
      filedBy: c.filer.fullName,
      reviewedBy: c.reviewer?.fullName ?? null,
      financeApprovedBy: c.financeApprover?.fullName ?? null,
      rejectionReason: c.rejectionReason,
      resolutionNotes: c.resolutionNotes,
      lateFilingReason: c.lateFilingReason,
      paid: c.paidAt && { at: c.paidAt, reference: c.payoutReference, fromInsurancePool: usd(c.paidFromInsuranceUsd), fromEscrow: usd(c.paidFromEscrowUsd) },
      recovery: recoverable && approved ? { recovered: usd(c.recoveredAmountUsd), outstanding: usd(Prisma.Decimal.max(approved.minus(c.recoveredAmountUsd), D(0))) } : null,
      evidenceCount: Array.isArray(c.evidenceUrls) ? (c.evidenceUrls as unknown[]).length : 0,
      createdAt: c.createdAt,
    };
  }

  async list(actor: Actor, q: { status?: string; mine?: boolean; waybill?: string; limit: number; before?: string }) {
    const all = hasPermission(actor.permissions, 'claims:read') && !q.mine;
    const rows = await this.prisma.claim.findMany({
      where: {
        ...(all ? {} : { filedBy: actor.id }),
        ...(q.status ? { status: q.status as never } : {}),
        ...(q.waybill ? { shipment: { waybillNumber: q.waybill.toUpperCase() } } : {}),
        ...(q.before ? { createdAt: { lt: new Date(q.before) } } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit,
      select: { id: true },
    });
    return Promise.all(rows.map((r) => this.dto(r.id)));
  }

  async get(actor: Actor, id: string) {
    await this.loadScoped(actor, id);
    return this.dto(id);
  }

  /**
   * Evidence for the side-by-side desk: open-box → baggage → inbound incident → PoD photos of the parcel
   * plus anything attached to the claim, each as a 5-minute signed URL (the bucket stays private).
   */
  async evidence(id: string) {
    const c = await this.prisma.claim.findUnique({ where: { id } });
    if (!c) throw Err.notFound();
    const photos = await this.prisma.shipmentPhoto.findMany({ where: { shipmentId: c.shipmentId }, orderBy: { createdAt: 'asc' } });
    const sign = async (uri: string) => {
      const r = await this.storage.signedUrl(uri);
      return { url: r.url, expiresIn: r.expiresIn };
    };
    const order = ['OPEN_BOX_CONTENT', 'SEALED_PARCEL', 'BAGGAGE_PLACEMENT', 'INBOUND_INCIDENT', 'PROOF_OF_DELIVERY'];
    const shipmentPhotos = await Promise.all(
      photos
        .sort((a, b) => order.indexOf(a.photoType) - order.indexOf(b.photoType))
        .map(async (p) => ({ type: p.photoType, takenAt: p.createdAt, sha256: p.sha256, ...(await sign(p.fileUrl)) })),
    );
    const claimEvidence = await Promise.all(((c.evidenceUrls as Array<{ uri: string; sha256: string }>) ?? []).map(async (e) => ({ sha256: e.sha256, ...(await sign(e.uri)) })));
    const incidents = await this.prisma.inboundIncident.findMany({
      where: { shipmentId: c.shipmentId },
      select: { id: true, condition: true, notes: true, status: true, driverConfirmedAt: true, createdAt: true },
    });
    const events = await this.prisma.shipmentEvent.findMany({ where: { shipmentId: c.shipmentId }, orderBy: { createdAt: 'asc' }, select: { status: true, createdAt: true, locationLabel: true, notes: true } });
    return { claimNo: c.claimNo, shipmentPhotos, claimEvidence, incidents, timeline: events };
  }

  /* -------------------------------------- review -------------------------------------- */

  async startReview(actor: Actor, id: string) {
    const upd = await this.prisma.claim.updateMany({ where: { id, status: 'OPEN' }, data: { status: 'INVESTIGATING', reviewedBy: actor.id, reviewedAt: new Date() } });
    if (upd.count !== 1) throw (await this.prisma.claim.findUnique({ where: { id } })) ? new AppException('shipment_wrong_state', 409) : Err.notFound();
    await this.audit.write({ action: 'CLAIM_REVIEW_STARTED', entityType: 'claim', entityId: id });
    return this.dto(id);
  }

  /**
   * CS decision. Approving requires the liable party; the amount can never exceed what was asked, the SOP
   * cap, or (together with other claims on the same parcel) the cap. Above the CS limit the claim waits
   * in INVESTIGATING for Finance's co-approval.
   */
  async decide(
    actor: Actor,
    id: string,
    input: { decision: 'APPROVE' | 'REJECT'; approvedAmountUsd?: string; liableParty?: LiableParty; notes?: string; reason?: string },
  ) {
    const c = await this.prisma.claim.findUnique({ where: { id }, include: { shipment: { include: { settlement: true } } } });
    if (!c) throw Err.notFound();
    if (c.status !== 'OPEN' && c.status !== 'INVESTIGATING') throw new AppException('shipment_wrong_state', 409);

    if (input.decision === 'REJECT') {
      if (!input.reason) throw Err.validation([{ path: 'reason', message: 'errors.validation_failed' }]);
      await this.prisma.claim.update({ where: { id }, data: { status: 'REJECTED', reviewedBy: actor.id, reviewedAt: new Date(), rejectionReason: input.reason, resolutionNotes: input.notes } });
      await this.audit.write({ action: 'CLAIM_REJECTED', entityType: 'claim', entityId: id, after: { reason: input.reason } });
      return this.dto(id);
    }

    if (!input.approvedAmountUsd || !input.liableParty) throw Err.validation([{ path: 'approvedAmountUsd', message: 'errors.validation_failed' }]);
    const approved = D(formatMoneyDb(parseMoney(input.approvedAmountUsd)));
    if (approved.lessThanOrEqualTo(0) || approved.greaterThan(c.requestedAmountUsd) || approved.greaterThan(c.maxEligibleLiabilityUsd)) {
      throw new AppException('claim_over_limit', 422);
    }
    const others = await this.activeTotal(c.shipmentId, id);
    if (others.plus(approved).greaterThan(c.maxEligibleLiabilityUsd)) throw new AppException('claim_total_exceeded', 422);
    this.assertLiablePartyExists(input.liableParty, c.shipment);

    const th = await this.threshold();
    const needsFinance = approved.greaterThan(th);
    await this.prisma.claim.update({
      where: { id },
      data: {
        approvedAmountUsd: approved,
        liableParty: input.liableParty,
        reviewedBy: actor.id,
        reviewedAt: new Date(),
        resolutionNotes: input.notes,
        status: needsFinance ? 'INVESTIGATING' : 'APPROVED',
        financeApprovedBy: null,
        financeApprovedAt: null,
      },
    });
    await this.audit.write({
      action: needsFinance ? 'CLAIM_PROPOSED_NEEDS_FINANCE' : 'CLAIM_APPROVED',
      entityType: 'claim',
      entityId: id,
      after: { approved: approved.toFixed(4), liableParty: input.liableParty, threshold: th.toFixed(4) },
    });
    return this.dto(id);
  }

  private assertLiablePartyExists(
    party: LiableParty,
    s: { originAgentId: string | null; destAgentId: string | null; pickupCourierId: string | null; deliveryCourierId: string | null; settlement: { fleetPartnerId: string | null } | null },
  ): void {
    const ok =
      (party === 'ORIGIN_AGENT' && s.originAgentId) ||
      (party === 'DEST_AGENT' && s.destAgentId) ||
      (party === 'COURIER' && (s.deliveryCourierId || s.pickupCourierId)) ||
      (party === 'FLEET_PARTNER' && s.settlement?.fleetPartnerId) ||
      party === 'PLATFORM_ESCROW';
    if (!ok) throw Err.validation([{ path: 'liableParty', message: 'errors.validation_failed' }]);
  }

  /** Finance co-approval above the CS limit. Must be a different person from the reviewer. */
  async financeApprove(actor: Actor, id: string) {
    const c = await this.prisma.claim.findUnique({ where: { id } });
    if (!c) throw Err.notFound();
    const th = await this.threshold();
    if (c.status !== 'INVESTIGATING' || !c.approvedAmountUsd || !c.approvedAmountUsd.greaterThan(th) || c.financeApprovedBy) {
      throw new AppException('shipment_wrong_state', 409);
    }
    if (c.reviewedBy === actor.id) throw new AppException('self_approval_forbidden', 403);
    await this.prisma.claim.update({ where: { id }, data: { status: 'APPROVED', financeApprovedBy: actor.id, financeApprovedAt: new Date() } });
    await this.audit.write({ action: 'CLAIM_FINANCE_APPROVED', entityType: 'claim', entityId: id, after: { approved: c.approvedAmountUsd.toFixed(4) } });
    return this.dto(id);
  }

  /* --------------------------------------- payout --------------------------------------- */

  /**
   * One-click payout to the customer. Debits the claim escrow reserve (insured claims: the insurance pool
   * first, escrow for the shortfall) and credits EXTERNAL_CLEARING (cash / transfer leaves the company).
   * Then the liable agent / courier is charged back from their deposit as far as it reaches.
   */
  async pay(actor: Actor, id: string, input: { channel?: PaymentChannel; reference: string }) {
    const c = await this.prisma.claim.findUnique({ where: { id }, include: { shipment: { include: { settlement: true } } } });
    if (!c) throw Err.notFound();
    if (c.status !== 'APPROVED' || !c.approvedAmountUsd || !c.liableParty) throw new AppException('shipment_wrong_state', 409);
    const amount = c.approvedAmountUsd;
    const th = await this.threshold();
    if (amount.greaterThan(th) && !c.financeApprovedBy) throw new AppException('shipment_wrong_state', 409); // defence in depth

    const [poolBal, escrowBal] = await Promise.all([this.ledger.balanceOf(sys('INSURANCE_POOL')), this.ledger.balanceOf(sys('CLAIM_ESCROW_RESERVE'))]);
    const fromPool = c.shipment.isInsured ? Prisma.Decimal.min(amount, poolBal.available) : D(0);
    const fromEscrow = amount.minus(fromPool);
    if (fromEscrow.greaterThan(escrowBal.available)) throw new AppException('escrow_insufficient', 422);

    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.claim.updateMany({ where: { id, status: 'APPROVED' }, data: { status: 'PAID', paidAt: new Date() } });
      if (claimed.count !== 1) throw new AppException('shipment_wrong_state', 409);

      const lines: PostingLine[] = [];
      if (fromPool.greaterThan(0)) lines.push({ wallet: sys('INSURANCE_POOL'), type: 'DEBIT', amount: fromPool, referenceType: 'CLAIM_PAYOUT', description: `Claim ${c.claimNo} (insured)` });
      if (fromEscrow.greaterThan(0)) lines.push({ wallet: sys('CLAIM_ESCROW_RESERVE'), type: 'DEBIT', amount: fromEscrow, referenceType: 'CLAIM_PAYOUT', description: `Claim ${c.claimNo}` });
      lines.push({ wallet: sys('EXTERNAL_CLEARING'), type: 'CREDIT', amount, referenceType: 'CLAIM_PAYOUT', description: `Paid to customer ${input.reference}` });

      const posting = await this.ledger.post(
        {
          referenceType: 'CLAIM_PAYOUT',
          referenceId: id,
          idempotencyKey: `claim-pay:${id}`,
          description: `Claim payout ${c.claimNo}`,
          createdBy: actor.id,
          metadata: { reference: input.reference, channel: input.channel },
          lines,
        },
        tx,
      );
      await tx.claim.update({
        where: { id },
        data: { payoutLedgerTxnId: posting.transactionId, payoutReference: input.reference, paidFromInsuranceUsd: fromPool, paidFromEscrowUsd: fromEscrow },
      });
      await this.audit.writeInTx(tx, { action: 'CLAIM_PAID', entityType: 'claim', entityId: id, after: { amount: amount.toFixed(4), fromPool: fromPool.toFixed(4), fromEscrow: fromEscrow.toFixed(4), reference: input.reference } });
    });

    await this.recoverFromParty(actor, id);
    return this.dto(id);
  }

  /** Charge the liable agent / courier back from their deposit (as far as the available balance reaches). */
  async recoverFromParty(actor: Actor, id: string): Promise<void> {
    const c = await this.prisma.claim.findUnique({ where: { id }, include: { shipment: true } });
    if (!c || c.status !== 'PAID' || !c.approvedAmountUsd || !c.liableParty) return;
    const owner = this.partyWallet(c.liableParty, c.shipment);
    if (!owner) return; // FLEET_PARTNER → recovered through payout deductions; PLATFORM_ESCROW → absorbed
    const outstanding = c.approvedAmountUsd.minus(c.recoveredAmountUsd);
    if (outstanding.lessThanOrEqualTo(0)) return;

    const bal = await this.ledger.balanceOf(owner);
    const take = Prisma.Decimal.min(outstanding, bal.available);
    if (take.lessThanOrEqualTo(0)) return;

    const split = recoveryCredits(c, take);
    const lines: PostingLine[] = [{ wallet: owner, type: 'DEBIT', amount: take, referenceType: 'CLAIM_PAYOUT', description: `Recovery claim ${c.claimNo}` }];
    if (split.pool.greaterThan(0)) lines.push({ wallet: sys('INSURANCE_POOL'), type: 'CREDIT', amount: split.pool, referenceType: 'CLAIM_PAYOUT' });
    if (split.escrow.greaterThan(0)) lines.push({ wallet: sys('CLAIM_ESCROW_RESERVE'), type: 'CREDIT', amount: split.escrow, referenceType: 'CLAIM_PAYOUT' });

    await this.prisma.$transaction(async (tx) => {
      await this.ledger.post(
        { referenceType: 'CLAIM_PAYOUT', referenceId: id, idempotencyKey: `claim-recover:${id}:${c.recoveredAmountUsd.toFixed(4)}`, description: `Recovery of claim ${c.claimNo} from ${c.liableParty}`, createdBy: actor.id, lines },
        tx,
      );
      await tx.claim.update({ where: { id }, data: { recoveredAmountUsd: c.recoveredAmountUsd.plus(take) } });
      await this.audit.writeInTx(tx, { action: 'CLAIM_RECOVERED', entityType: 'claim', entityId: id, after: { recovered: take.toFixed(4), from: c.liableParty } });
    });
  }

  private partyWallet(
    party: LiableParty,
    s: { originAgentId: string | null; destAgentId: string | null; pickupCourierId: string | null; deliveryCourierId: string | null },
  ): WalletRef | null {
    if (party === 'ORIGIN_AGENT' && s.originAgentId) return { ownerType: 'AGENT', ownerId: s.originAgentId, walletType: 'DEPOSIT' };
    if (party === 'DEST_AGENT' && s.destAgentId) return { ownerType: 'AGENT', ownerId: s.destAgentId, walletType: 'DEPOSIT' };
    if (party === 'COURIER') {
      const id = s.deliveryCourierId ?? s.pickupCourierId;
      if (id) return { ownerType: 'COURIER', ownerId: id, walletType: 'DEPOSIT' };
    }
    return null;
  }
}
