import { Injectable } from '@nestjs/common';
import { Prisma, type PaymentChannel } from '@prisma/client';
import { hasPermission } from '@670send/types';
import { formatMoneyDb, parseMoney } from '@670send/pricing';
import { AuditService } from '../audit/audit.service';
import { AppException, Err } from '../common/errors';
import { LedgerService, type WalletRef } from '../ledger/ledger.service';
import { PrismaService } from '../prisma/prisma.service';
import type { Actor } from '../rbac/actor';
import { StorageService } from '../storage/storage.service';

export interface DepositRequestInput {
  amountUsd: string;
  channel: PaymentChannel;
  /** Bank / MOSAN / T-Pay transaction id, or the cash receipt number. */
  referenceNo: string;
  proofUploadId?: string;
  note?: string;
}

const usd = (d: Prisma.Decimal | null | undefined) => (d == null ? null : d.toFixed(4));

/**
 * Finance centre:
 *  • deposit top-up requests (agents / couriers) with maker-checker approval by Finance;
 *  • wallets, statements and the ledger viewer;
 *  • reconciliation (ledger integrity + the settlement ↔ pending-pool invariant);
 *  • the one-time refund of an unused door-delivery add-on.
 */
@Injectable()
export class FinanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  /* ================================ deposit requests ================================ */

  async requestDeposit(actor: Actor, input: DepositRequestInput, idempotencyKey: string) {
    if (!actor.agentId && !actor.courierId) throw Err.forbidden();
    const amount = parseMoney(input.amountUsd);
    if (amount <= 0n || amount > parseMoney('10000')) throw Err.validation([{ path: 'amountUsd', message: 'errors.validation_failed' }]);

    const reference = input.referenceNo.trim();
    if (reference.length < 3) throw new AppException('reference_required', 422);
    if (input.channel !== 'CASH' && !input.proofUploadId) throw new AppException('deposit_proof_required', 422);

    const duplicate = await this.prisma.depositRequest.findFirst({
      where: { channel: input.channel, referenceNo: { equals: reference, mode: 'insensitive' }, status: { not: 'REJECTED' } },
      select: { id: true },
    });
    if (duplicate) throw new AppException('duplicate_reference', 409);

    const created = await this.prisma.$transaction(async (tx) => {
      let proofUrl: string | null = null;
      if (input.proofUploadId) {
        const up = await tx.stagedUpload.findFirst({
          where: { id: input.proofUploadId, uploadedBy: actor.id, photoType: 'DEPOSIT_PROOF', consumedAt: null },
        });
        if (!up) throw Err.uploadNotFound();
        await tx.stagedUpload.update({ where: { id: up.id }, data: { consumedAt: new Date() } });
        proofUrl = up.fileUrl;
      }
      const row = await tx.depositRequest.create({
        data: {
          agentId: actor.agentId ?? null,
          courierId: actor.agentId ? null : actor.courierId,
          amountUsd: formatMoneyDb(amount),
          channel: input.channel,
          referenceNo: reference,
          proofUrl,
          note: input.note,
          requestedBy: actor.id,
          idempotencyKey: `${actor.id}:${idempotencyKey}`,
        },
      });
      await this.audit.writeInTx(tx, { action: 'DEPOSIT_REQUESTED', entityType: 'deposit_request', entityId: row.id, after: { amount: formatMoneyDb(amount), channel: input.channel, referenceNo: reference } });
      return row;
    });
    return this.depositDto(created.id);
  }

  async depositDto(id: string) {
    const r = await this.prisma.depositRequest.findUniqueOrThrow({
      where: { id },
      include: {
        agent: { select: { id: true, agentCode: true, kioskName: true } },
        courier: { select: { id: true, user: { select: { fullName: true } } } },
        requester: { select: { fullName: true } },
        reviewer: { select: { fullName: true } },
      },
    });
    return {
      id: r.id,
      status: r.status,
      amount: usd(r.amountUsd),
      channel: r.channel,
      referenceNo: r.referenceNo,
      hasProof: r.proofUrl != null,
      note: r.note,
      owner: r.agent ? { type: 'AGENT', id: r.agent.id, name: `${r.agent.kioskName} (${r.agent.agentCode})` } : { type: 'COURIER', id: r.courier!.id, name: r.courier!.user.fullName },
      requestedBy: r.requester.fullName,
      reviewedBy: r.reviewer?.fullName ?? null,
      reviewedAt: r.reviewedAt,
      rejectReason: r.rejectReason,
      createdAt: r.createdAt,
    };
  }

  /** Requesters see their own; Finance (deposits:read) sees all with filters. */
  async listDeposits(actor: Actor, q: { status?: string; ownerType?: 'AGENT' | 'COURIER'; limit: number; before?: string }) {
    const all = hasPermission(actor.permissions, 'deposits:read');
    const where: Prisma.DepositRequestWhereInput = {
      ...(q.status ? { status: q.status as never } : {}),
      ...(q.before ? { createdAt: { lt: new Date(q.before) } } : {}),
      ...(q.ownerType === 'AGENT' ? { agentId: { not: null } } : q.ownerType === 'COURIER' ? { courierId: { not: null } } : {}),
    };
    if (!all) {
      if (!actor.agentId && !actor.courierId) return [];
      where.OR = [...(actor.agentId ? [{ agentId: actor.agentId }] : []), ...(actor.courierId ? [{ courierId: actor.courierId }] : [])];
    }
    const rows = await this.prisma.depositRequest.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: q.limit, select: { id: true } });
    return Promise.all(rows.map((r) => this.depositDto(r.id)));
  }

  /** Short-lived signed URL of the payment slip (Finance only). */
  async proofUrl(id: string) {
    const r = await this.prisma.depositRequest.findUnique({ where: { id }, select: { proofUrl: true } });
    if (!r?.proofUrl) throw Err.notFound();
    return this.storage.signedUrl(r.proofUrl);
  }

  /**
   * Maker-checker: the requester can never approve their own top-up. Approval credits the deposit wallet
   * through the ledger (EXTERNAL_CLEARING → DEPOSIT) in the same transaction that flips the status; a
   * race between two approvers is impossible (conditional update + idempotent ledger key).
   */
  async approveDeposit(actor: Actor, id: string) {
    const r = await this.prisma.depositRequest.findUnique({ where: { id } });
    if (!r) throw Err.notFound();
    if (r.status !== 'PENDING') throw new AppException('shipment_wrong_state', 409);
    if (r.requestedBy === actor.id) throw new AppException('self_approval_forbidden', 403);

    const wallet: WalletRef = r.agentId
      ? { ownerType: 'AGENT', ownerId: r.agentId, walletType: 'DEPOSIT' }
      : { ownerType: 'COURIER', ownerId: r.courierId!, walletType: 'DEPOSIT' };

    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.depositRequest.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'APPROVED', reviewedBy: actor.id, reviewedAt: new Date() } });
      if (claimed.count !== 1) throw new AppException('shipment_wrong_state', 409);
      const posting = await this.ledger.post(
        {
          referenceType: 'DEPOSIT_TOPUP',
          referenceId: id,
          idempotencyKey: `deposit:${id}`,
          description: `Deposit top-up ${r.channel} ${r.referenceNo ?? ''}`.trim(),
          createdBy: actor.id,
          lines: [
            { wallet: LedgerService.systemWallet('EXTERNAL_CLEARING'), type: 'DEBIT', amount: r.amountUsd },
            { wallet, type: 'CREDIT', amount: r.amountUsd },
          ],
        },
        tx,
      );
      await tx.depositRequest.update({ where: { id }, data: { ledgerTxnId: posting.transactionId } });
      await this.audit.writeInTx(tx, { action: 'DEPOSIT_APPROVED', entityType: 'deposit_request', entityId: id, after: { amount: r.amountUsd.toFixed(4), ledgerTxnId: posting.transactionId } });
    });
    return this.depositDto(id);
  }

  async rejectDeposit(actor: Actor, id: string, reason: string) {
    const r = await this.prisma.depositRequest.findUnique({ where: { id } });
    if (!r) throw Err.notFound();
    if (r.requestedBy === actor.id) throw new AppException('self_approval_forbidden', 403);
    const upd = await this.prisma.depositRequest.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'REJECTED', reviewedBy: actor.id, reviewedAt: new Date(), rejectReason: reason } });
    if (upd.count !== 1) throw new AppException('shipment_wrong_state', 409);
    await this.audit.write({ action: 'DEPOSIT_REJECTED', entityType: 'deposit_request', entityId: id, after: { reason } });
    return this.depositDto(id);
  }

  /* ================================ wallets & ledger ================================ */

  /** The caller's own wallets with live balances. */
  async myWallets(actor: Actor) {
    const refs: WalletRef[] = [];
    if (actor.agentId) refs.push({ ownerType: 'AGENT', ownerId: actor.agentId, walletType: 'DEPOSIT' }, { ownerType: 'AGENT', ownerId: actor.agentId, walletType: 'COMMISSION' });
    if (actor.courierId) refs.push({ ownerType: 'COURIER', ownerId: actor.courierId, walletType: 'DEPOSIT' }, { ownerType: 'COURIER', ownerId: actor.courierId, walletType: 'COURIER_EARNINGS' });
    if (actor.fleetPartnerId && !actor.driverId) refs.push({ ownerType: 'FLEET_OWNER', ownerId: actor.fleetPartnerId, walletType: 'FLEET_PAYABLE' });
    if (refs.length === 0) return [];
    // Wallets are created lazily by the ledger; show the standard ones even before their first posting ($0.00).
    const ids = await Promise.all(refs.map((r) => this.ledger.resolveWalletId(r)));
    const wallets = await this.prisma.wallet.findMany({ where: { id: { in: ids } }, orderBy: { walletType: 'asc' } });
    return wallets.map((w) => this.walletDto(w));
  }

  private walletDto(w: { id: string; ownerType: string; ownerId: string; walletType: string; balance: Prisma.Decimal; lockedBalance: Prisma.Decimal }) {
    return {
      id: w.id,
      ownerType: w.ownerType,
      ownerId: w.ownerId,
      type: w.walletType,
      balance: usd(w.balance),
      locked: usd(w.lockedBalance),
      available: usd(w.balance.minus(w.lockedBalance)),
    };
  }

  /** Statement of one wallet: its owner, or Finance (wallets:read_all). Strangers get 404. */
  async statement(actor: Actor, walletId: string, q: { limit: number; before?: string }) {
    const w = await this.prisma.wallet.findUnique({ where: { id: walletId } });
    if (!w) throw Err.notFound();
    const own =
      (w.ownerType === 'AGENT' && w.ownerId === actor.agentId) ||
      (w.ownerType === 'COURIER' && w.ownerId === actor.courierId) ||
      (w.ownerType === 'FLEET_OWNER' && w.ownerId === actor.fleetPartnerId && !actor.driverId);
    if (!own && !hasPermission(actor.permissions, 'wallets:read_all')) throw Err.notFound();

    const entries = await this.ledger.statement(walletId, { limit: q.limit, before: q.before ? new Date(q.before) : undefined });
    return {
      wallet: this.walletDto(w),
      entries: entries.map((e) => ({
        id: e.id,
        at: e.createdAt,
        type: e.entryType,
        reference: e.referenceType,
        referenceId: e.referenceId,
        amount: usd(e.amount),
        balanceAfter: usd(e.balanceAfter),
        description: e.description,
      })),
      nextBefore: entries.length === q.limit ? entries[entries.length - 1]!.createdAt.toISOString() : null,
    };
  }

  async adminWallets(q: { ownerType?: string; ownerId?: string; walletType?: string; limit: number }) {
    const rows = await this.prisma.wallet.findMany({
      where: { ...(q.ownerType ? { ownerType: q.ownerType as never } : {}), ...(q.ownerId ? { ownerId: q.ownerId } : {}), ...(q.walletType ? { walletType: q.walletType as never } : {}) },
      orderBy: [{ walletType: 'asc' }, { balance: 'desc' }],
      take: q.limit,
    });
    // Resolve a human label for agent / courier / fleet wallets.
    const agentIds = rows.filter((w) => w.ownerType === 'AGENT').map((w) => w.ownerId);
    const courierIds = rows.filter((w) => w.ownerType === 'COURIER').map((w) => w.ownerId);
    const fleetIds = rows.filter((w) => w.ownerType === 'FLEET_OWNER').map((w) => w.ownerId);
    const [agents, couriers, fleets] = await Promise.all([
      this.prisma.agent.findMany({ where: { id: { in: agentIds } }, select: { id: true, kioskName: true } }),
      this.prisma.courier.findMany({ where: { id: { in: courierIds } }, select: { id: true, user: { select: { fullName: true } } } }),
      this.prisma.fleetPartner.findMany({ where: { id: { in: fleetIds } }, select: { id: true, companyName: true } }),
    ]);
    const label = new Map<string, string>([
      ...agents.map((a) => [a.id, a.kioskName] as const),
      ...couriers.map((c) => [c.id, c.user.fullName] as const),
      ...fleets.map((f) => [f.id, f.companyName] as const),
    ]);
    return rows.map((w) => ({ ...this.walletDto(w), owner: label.get(w.ownerId) ?? (w.ownerType === 'SYSTEM' ? 'System' : w.ownerId) }));
  }

  async adminLedger(q: { walletId?: string; referenceType?: string; referenceId?: string; from?: string; to?: string; limit: number; before?: string }) {
    const rows = await this.prisma.ledgerEntry.findMany({
      where: {
        ...(q.walletId ? { walletId: q.walletId } : {}),
        ...(q.referenceType ? { referenceType: q.referenceType as never } : {}),
        ...(q.referenceId ? { referenceId: q.referenceId } : {}),
        ...(q.from || q.to || q.before
          ? { createdAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lt: new Date(q.to) } : {}), ...(q.before ? { lt: new Date(q.before) } : {}) } }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit,
      include: { wallet: { select: { ownerType: true, walletType: true } } },
    });
    return rows.map((e) => ({
      id: e.id,
      transactionId: e.transactionId,
      at: e.createdAt,
      wallet: `${e.wallet.ownerType}/${e.wallet.walletType}`,
      type: e.entryType,
      reference: e.referenceType,
      referenceId: e.referenceId,
      amount: usd(e.amount),
      balanceAfter: usd(e.balanceAfter),
      description: e.description,
    }));
  }

  /* ================================== reconciliation ================================== */

  /**
   * Finance reconciliation: (1) ledger integrity — Σ wallets = 0, wallet = Σ its entries, every
   * transaction nets to zero; (2) the settlement invariant — the PENDING_SETTLEMENT wallet must equal
   * the sum of all shares not yet released on shipment_settlements; (3) escrow / float watch-list.
   */
  async reconciliation() {
    const base = await this.ledger.reconcile();

    const [pendingWallet, expected, escrow, pool, lowFloat] = await Promise.all([
      this.ledger.balanceOf(LedgerService.systemWallet('PENDING_SETTLEMENT')),
      this.prisma.$queryRaw<Array<{ expected: Prisma.Decimal }>>`
        SELECT COALESCE(SUM(
          CASE WHEN fleet_released_at IS NULL THEN fleet_share_usd ELSE 0 END +
          CASE WHEN released_at IS NULL THEN dest_share_usd + courier_share_usd ELSE 0 END
        ), 0) AS expected
        FROM shipment_settlements WHERE status <> 'REVERSED'`,
      this.ledger.balanceOf(LedgerService.systemWallet('CLAIM_ESCROW_RESERVE')),
      this.ledger.balanceOf(LedgerService.systemWallet('INSURANCE_POOL')),
      this.prisma.wallet.findMany({ where: { ownerType: 'AGENT', walletType: 'DEPOSIT', balance: { lt: 10 } }, take: 50, orderBy: { balance: 'asc' } }),
    ]);
    const expectedPending = expected[0]?.expected ?? new Prisma.Decimal(0);
    const pendingOk = pendingWallet.balance.equals(expectedPending);

    const openClaimExposure = await this.prisma.claim.aggregate({
      _sum: { approvedAmountUsd: true },
      where: { status: 'APPROVED' },
    });

    return {
      ok: base.ok && pendingOk,
      ledger: base,
      pendingSettlement: { wallet: pendingWallet.balance.toFixed(4), expectedFromSettlements: expectedPending.toFixed(4), ok: pendingOk },
      escrow: {
        claimReserve: escrow.balance.toFixed(4),
        insurancePool: pool.balance.toFixed(4),
        approvedUnpaidClaims: (openClaimExposure._sum.approvedAmountUsd ?? new Prisma.Decimal(0)).toFixed(4),
      },
      lowFloatAgents: lowFloat.map((w) => ({ agentId: w.ownerId, balance: w.balance.toFixed(4) })),
    };
  }

  /* ===================================== refunds ===================================== */

  /**
   * Refund of an UNUSED door-delivery add-on: the customer paid for a courier but collected at the kiosk
   * (two failed attempts) or the parcel was returned. Finance pays it back out of platform revenue.
   * One-time (ledger key + settlement flag), never more than the add-on that was actually paid.
   */
  async refundUnusedDeliveryAddon(actor: Actor, waybill: string, input: { reason: string; reference?: string }) {
    const s = await this.prisma.shipment.findUnique({ where: { waybillNumber: waybill.toUpperCase() }, include: { settlement: true } });
    if (!s || !s.settlement) throw Err.notFound();
    const st = s.settlement;
    const eligible =
      s.deliveryAddonFeeUsd.greaterThan(0) &&
      s.deliveryCourierId === null &&
      st.releasedAt !== null &&
      (s.status === 'DELIVERED' || (s.status === 'RETURN_TO_SENDER' && s.rtsReceivedAt !== null));
    if (!eligible || st.addonRefundedAt) throw new AppException('refund_not_applicable', 422);

    const amount = s.deliveryAddonFeeUsd;
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.shipmentSettlement.updateMany({ where: { id: st.id, addonRefundedAt: null }, data: { addonRefundedAt: new Date() } });
      if (claimed.count !== 1) throw new AppException('refund_not_applicable', 422);
      const posting = await this.ledger.post(
        {
          referenceType: 'ADJUSTMENT',
          referenceId: s.id,
          idempotencyKey: `refund-addon:${s.id}`,
          description: `Refund of unused delivery add-on ${s.waybillNumber}: ${input.reason}`,
          createdBy: actor.id,
          metadata: { reference: input.reference, reason: input.reason },
          lines: [
            { wallet: LedgerService.systemWallet('PLATFORM_REVENUE'), type: 'DEBIT', amount },
            { wallet: LedgerService.systemWallet('EXTERNAL_CLEARING'), type: 'CREDIT', amount },
          ],
        },
        tx,
      );
      await tx.shipmentSettlement.update({ where: { id: st.id }, data: { addonRefundTxnId: posting.transactionId } });
      await this.audit.writeInTx(tx, { action: 'ADDON_REFUNDED', entityType: 'shipment', entityId: s.id, after: { amount: amount.toFixed(4), reason: input.reason, reference: input.reference } });
    });
    return { waybill: s.waybillNumber, refunded: { usd: amount.toFixed(4) } };
  }
}
