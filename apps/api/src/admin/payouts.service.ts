import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma, type FleetPartner } from '@prisma/client';
import { defaultPayoutPeriod, diliWeekday, formatDiliDateTime, formatMoneyDb, yymmddDili } from '@670send/pricing';
import { AuditService } from '../audit/audit.service';
import { AppException, Err } from '../common/errors';
import { LedgerService, type PostingLine } from '../ledger/ledger.service';
import { QueueService } from '../notifications/queue.service';
import { PrismaService } from '../prisma/prisma.service';
import type { Actor } from '../rbac/actor';
import { recoveryCredits } from './claims.service';
import { csvEscape } from './csv';

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const usd = (d: Prisma.Decimal | null | undefined) => (d == null ? null : d.toFixed(4));
const sys = LedgerService.systemWallet;

const ACTIVE_PAYOUT_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'FAILED'] as const;
const SYSTEM_PHONE = '+67000000000';

export interface GenerateInput {
  fleetPartnerId?: string;
  cycle?: 'DAILY' | 'WEEKLY';
  periodStart?: Date;
  periodEnd?: Date;
}

/**
 * Fleet partner payouts — always to the fleet OWNER, never to a driver (MoU Art. 4).
 *
 *  generate  (Finance, or the 06:00 scheduler as DRAFTs)  collects every released fleet share not yet paid
 *            (each parcel can be paid out once — DB-enforced), nets approved claims where the fleet was ruled
 *            liable, and creates a DRAFT with a statement.
 *  submit → approve  maker-checker: the approver can never be the creator.
 *  pay       posts FLEET_PAYABLE → EXTERNAL_CLEARING (net) and the claim recoveries back to the funds that paid
 *            them, with the bank / MOSAN reference stored.
 */
@Injectable()
export class PayoutsService implements OnModuleInit {
  private readonly log = new Logger('Payouts');

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
    private readonly queues: QueueService,
  ) {}

  onModuleInit(): void {
    this.queues.registerSchedule('payout-drafts-daily', '0 6 * * *', 'payout-generate');
    this.queues.registerHandler('payout-generate', async () => {
      const now = new Date();
      const cycles: Array<'DAILY' | 'WEEKLY'> = diliWeekday(now) === 1 ? ['DAILY', 'WEEKLY'] : ['DAILY'];
      for (const cycle of cycles) {
        const created = await this.generateDue(cycle, now);
        this.log.log(`Scheduled ${cycle} payout drafts: ${created.length}`);
      }
    });
  }

  private async systemUserId(): Promise<string> {
    return (await this.prisma.user.findUniqueOrThrow({ where: { phone: SYSTEM_PHONE }, select: { id: true } })).id;
  }

  private async nextPayoutNo(tx: Prisma.TransactionClient): Promise<string> {
    const key = yymmddDili(new Date());
    const rows = await tx.$queryRaw<Array<{ last_value: number }>>`
      INSERT INTO waybill_sequences (origin_code, dest_code, date_key, last_value, updated_at)
      VALUES ('PAY', 'PAY', ${key}, 1, now())
      ON CONFLICT (origin_code, dest_code, date_key)
      DO UPDATE SET last_value = waybill_sequences.last_value + 1, updated_at = now()
      RETURNING last_value`;
    return `PO-${key}-${String(rows[0]!.last_value).padStart(4, '0')}`;
  }

  /* ----------------------------------- generation ----------------------------------- */

  /** Manual generation by Finance for one partner (explicit period) or every partner of a cycle. */
  async generate(actor: Actor, input: GenerateInput, idempotencyKey: string) {
    const period = this.resolvePeriod(input, new Date());
    const partners = input.fleetPartnerId
      ? [await this.prisma.fleetPartner.findFirst({ where: { id: input.fleetPartnerId, deletedAt: null } })]
      : await this.prisma.fleetPartner.findMany({ where: { status: 'ACTIVE', deletedAt: null, payoutCycle: input.cycle! } });
    if (input.fleetPartnerId && !partners[0]) throw Err.notFound();

    const created: string[] = [];
    for (const partner of partners) {
      if (!partner) continue;
      const id = await this.buildDraft(partner, period.start, period.end, actor.id, `${actor.id}:${idempotencyKey}:${partner.id}`, false);
      if (id) created.push(id);
    }
    if (input.fleetPartnerId && created.length === 0) throw new AppException('payout_empty', 422);
    return Promise.all(created.map((id) => this.dto(id)));
  }

  /** The scheduler path: DRAFTs owned by the technical system user; Finance still reviews and approves. */
  async generateDue(cycle: 'DAILY' | 'WEEKLY', now = new Date()): Promise<string[]> {
    const { start, end } = defaultPayoutPeriod(cycle, now);
    const system = await this.systemUserId();
    const partners = await this.prisma.fleetPartner.findMany({ where: { status: 'ACTIVE', deletedAt: null, payoutCycle: cycle } });
    const created: string[] = [];
    for (const p of partners) {
      try {
        const id = await this.buildDraft(p, start, end, system, `auto:${p.id}:${cycle}:${start.toISOString()}`, true);
        if (id) created.push(id);
      } catch (err) {
        this.log.error(`Scheduled payout for ${p.companyName} failed: ${(err as Error).message}`);
      }
    }
    return created;
  }

  private resolvePeriod(input: GenerateInput, now: Date): { start: Date; end: Date } {
    if (input.periodStart && input.periodEnd) {
      if (input.periodEnd <= input.periodStart) throw Err.validation([{ path: 'periodEnd', message: 'errors.validation_failed' }]);
      return { start: input.periodStart, end: input.periodEnd };
    }
    if (input.cycle) return defaultPayoutPeriod(input.cycle, now);
    // One partner, no explicit period: "everything released so far" (the period start is informational only —
    // every released, unpaid share up to `end` is always collected).
    if (input.fleetPartnerId) return { start: new Date(now.getTime() - 7 * 86_400_000), end: now };
    throw Err.validation([{ path: 'cycle', message: 'errors.validation_failed' }]);
  }

  private async buildDraft(partner: FleetPartner, start: Date, end: Date, creatorId: string, idempotencyKey: string, auto: boolean): Promise<string | null> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        // 1. every released, not-yet-paid fleet share up to the end of the period (backlog is never lost)
        const earnings = await tx.shipmentSettlement.findMany({
          where: {
            fleetPartnerId: partner.id,
            fleetReleasedAt: { lt: end },
            fleetShareUsd: { gt: 0 },
            shipment: { payoutItems: { none: { kind: 'EARNING' } } },
          },
          select: { shipmentId: true, fleetShareUsd: true, shipment: { select: { waybillNumber: true } } },
          orderBy: { fleetReleasedAt: 'asc' },
        });
        const gross = earnings.reduce((a, e) => a.plus(e.fleetShareUsd), D(0));

        // 2. claims where this fleet was ruled liable and that are paid out to customers but not yet recovered
        const busy = await tx.fleetPayoutItem.findMany({
          where: { kind: 'CLAIM_DEDUCTION', claimId: { not: null }, payout: { status: { in: [...ACTIVE_PAYOUT_STATUSES] } } },
          select: { claimId: true },
        });
        const claims = await tx.claim.findMany({
          where: {
            liableParty: 'FLEET_PARTNER',
            status: 'PAID',
            shipment: { settlement: { fleetPartnerId: partner.id } },
            id: { notIn: busy.map((b) => b.claimId!) },
          },
          orderBy: { paidAt: 'asc' },
        });
        let room = gross;
        const deductions: Array<{ claimId: string; claimNo: string; shipmentId: string; amount: Prisma.Decimal }> = [];
        for (const c of claims) {
          const outstanding = (c.approvedAmountUsd ?? D(0)).minus(c.recoveredAmountUsd);
          const take = Prisma.Decimal.min(outstanding, room);
          if (take.greaterThan(0)) {
            deductions.push({ claimId: c.id, claimNo: c.claimNo, shipmentId: c.shipmentId, amount: take });
            room = room.minus(take);
          }
        }
        const deduction = deductions.reduce((a, d) => a.plus(d.amount), D(0));
        if (earnings.length === 0) return null; // nothing to pay (a deduction alone can't create a payout)

        const payout = await tx.fleetPayout.create({
          data: {
            payoutNo: await this.nextPayoutNo(tx),
            fleetPartnerId: partner.id,
            periodStart: start,
            periodEnd: end,
            grossAmountUsd: gross,
            claimDeductionUsd: deduction,
            netAmountUsd: gross.minus(deduction),
            channel: partner.payoutChannel,
            createdBy: creatorId,
            idempotencyKey,
            autoGenerated: auto,
          },
        });
        await tx.fleetPayoutItem.createMany({
          data: [
            ...earnings.map((e) => ({ payoutId: payout.id, shipmentId: e.shipmentId, kind: 'EARNING' as const, amountUsd: e.fleetShareUsd, description: e.shipment.waybillNumber })),
            ...deductions.map((d) => ({ payoutId: payout.id, shipmentId: d.shipmentId, kind: 'CLAIM_DEDUCTION' as const, amountUsd: d.amount, claimId: d.claimId, description: `Claim ${d.claimNo}` })),
          ],
        });
        await this.audit.writeInTx(tx, {
          actorId: creatorId,
          action: auto ? 'PAYOUT_DRAFT_AUTO' : 'PAYOUT_GENERATED',
          entityType: 'fleet_payout',
          entityId: payout.id,
          after: { payoutNo: payout.payoutNo, partner: partner.companyName, gross: gross.toFixed(4), deduction: deduction.toFixed(4), parcels: earnings.length },
        });
        return payout.id;
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        // same idempotency key (replay) or the unique "paid once" index (a concurrent generation took the parcels)
        const replay = await this.prisma.fleetPayout.findUnique({ where: { idempotencyKey }, select: { id: true } });
        if (replay) return replay.id;
        throw new AppException('request_in_progress', 409);
      }
      throw err;
    }
  }

  /* ---------------------------------- state machine ---------------------------------- */

  private async load(id: string) {
    const p = await this.prisma.fleetPayout.findUnique({ where: { id }, include: { items: true, fleetPartner: true } });
    if (!p) throw Err.notFound();
    return p;
  }

  async submit(actor: Actor, id: string) {
    const upd = await this.prisma.fleetPayout.updateMany({ where: { id, status: 'DRAFT' }, data: { status: 'PENDING_APPROVAL', submittedAt: new Date() } });
    if (upd.count !== 1) throw (await this.prisma.fleetPayout.findUnique({ where: { id } })) ? new AppException('shipment_wrong_state', 409) : Err.notFound();
    await this.audit.write({ action: 'PAYOUT_SUBMITTED', entityType: 'fleet_payout', entityId: id, actorId: actor.id });
    return this.dto(id);
  }

  /** Maker-checker: the approver can never be the person who created the batch. */
  async approve(actor: Actor, id: string) {
    const p = await this.load(id);
    if (p.createdBy === actor.id) throw new AppException('self_approval_forbidden', 403);
    const upd = await this.prisma.fleetPayout.updateMany({ where: { id, status: 'PENDING_APPROVAL' }, data: { status: 'APPROVED', approvedBy: actor.id, approvedAt: new Date() } });
    if (upd.count !== 1) throw new AppException('shipment_wrong_state', 409);
    await this.audit.write({ action: 'PAYOUT_APPROVED', entityType: 'fleet_payout', entityId: id, after: { net: p.netAmountUsd.toFixed(4) } });
    return this.dto(id);
  }

  /** Money leaves: FLEET_PAYABLE debited, bank / MOSAN reference stored, recoveries returned to the funds. */
  async pay(actor: Actor, id: string, input: { bankReference: string }) {
    const p = await this.load(id);
    if (p.status !== 'APPROVED' && p.status !== 'FAILED') throw new AppException('shipment_wrong_state', 409);
    if (p.approvedBy === actor.id && p.createdBy === actor.id) throw new AppException('self_approval_forbidden', 403);

    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.fleetPayout.updateMany({ where: { id, status: { in: ['APPROVED', 'FAILED'] } }, data: { status: 'PAID', paidAt: new Date(), paidBy: actor.id, bankReference: input.bankReference, failureReason: null } });
      if (claimed.count !== 1) throw new AppException('shipment_wrong_state', 409);

      const lines: PostingLine[] = [{ wallet: { ownerType: 'FLEET_OWNER', ownerId: p.fleetPartnerId, walletType: 'FLEET_PAYABLE' }, type: 'DEBIT', amount: p.grossAmountUsd, referenceType: 'FLEET_PAYOUT', description: `Payout ${p.payoutNo}` }];
      if (p.netAmountUsd.greaterThan(0)) lines.push({ wallet: sys('EXTERNAL_CLEARING'), type: 'CREDIT', amount: p.netAmountUsd, referenceType: 'FLEET_PAYOUT', description: `Paid to fleet owner ${input.bankReference}` });

      let toPool = D(0);
      let toEscrow = D(0);
      for (const item of p.items.filter((i) => i.kind === 'CLAIM_DEDUCTION' && i.claimId)) {
        const claim = await tx.claim.findUniqueOrThrow({ where: { id: item.claimId! } });
        const split = recoveryCredits(claim, item.amountUsd);
        toPool = toPool.plus(split.pool);
        toEscrow = toEscrow.plus(split.escrow);
        await tx.claim.update({ where: { id: claim.id }, data: { recoveredAmountUsd: claim.recoveredAmountUsd.plus(item.amountUsd), recoveredInPayoutId: p.id } });
      }
      if (toPool.greaterThan(0)) lines.push({ wallet: sys('INSURANCE_POOL'), type: 'CREDIT', amount: toPool, referenceType: 'CLAIM_PAYOUT', description: 'Claim recovery from fleet' });
      if (toEscrow.greaterThan(0)) lines.push({ wallet: sys('CLAIM_ESCROW_RESERVE'), type: 'CREDIT', amount: toEscrow, referenceType: 'CLAIM_PAYOUT', description: 'Claim recovery from fleet' });

      const posting = await this.ledger.post(
        { referenceType: 'FLEET_PAYOUT', referenceId: id, idempotencyKey: `payout:${id}`, description: `Fleet payout ${p.payoutNo}`, createdBy: actor.id, metadata: { bankReference: input.bankReference, channel: p.channel }, lines },
        tx,
      );
      await tx.fleetPayout.update({ where: { id }, data: { ledgerTxnId: posting.transactionId } });
      await this.audit.writeInTx(tx, { action: 'PAYOUT_PAID', entityType: 'fleet_payout', entityId: id, after: { payoutNo: p.payoutNo, net: p.netAmountUsd.toFixed(4), bankReference: input.bankReference } });
    });
    return this.dto(id);
  }

  async fail(actor: Actor, id: string, reason: string) {
    const upd = await this.prisma.fleetPayout.updateMany({ where: { id, status: 'APPROVED' }, data: { status: 'FAILED', failureReason: reason } });
    if (upd.count !== 1) throw new AppException('shipment_wrong_state', 409);
    await this.audit.write({ action: 'PAYOUT_FAILED', entityType: 'fleet_payout', entityId: id, actorId: actor.id, after: { reason } });
    return this.dto(id);
  }

  /** Cancelling frees every parcel and claim for the next batch. */
  async cancel(actor: Actor, id: string) {
    await this.prisma.$transaction(async (tx) => {
      const upd = await tx.fleetPayout.updateMany({ where: { id, status: { in: [...ACTIVE_PAYOUT_STATUSES] } }, data: { status: 'CANCELLED' } });
      if (upd.count !== 1) throw new AppException('shipment_wrong_state', 409);
      await tx.fleetPayoutItem.deleteMany({ where: { payoutId: id } });
      await this.audit.writeInTx(tx, { action: 'PAYOUT_CANCELLED', entityType: 'fleet_payout', entityId: id });
    });
    void actor;
    return this.dto(id);
  }

  /* ------------------------------------- queries ------------------------------------- */

  async dto(id: string) {
    const p = await this.prisma.fleetPayout.findUniqueOrThrow({
      where: { id },
      include: { fleetPartner: { select: { id: true, companyName: true } }, creator: { select: { fullName: true } }, approver: { select: { fullName: true } }, _count: { select: { items: true } } },
    });
    return {
      id: p.id,
      payoutNo: p.payoutNo,
      status: p.status,
      fleetPartner: p.fleetPartner,
      period: { start: p.periodStart, end: p.periodEnd },
      gross: usd(p.grossAmountUsd),
      claimDeduction: usd(p.claimDeductionUsd),
      net: usd(p.netAmountUsd),
      channel: p.channel,
      bankReference: p.bankReference,
      lineCount: p._count.items,
      autoGenerated: p.autoGenerated,
      createdBy: p.creator.fullName,
      approvedBy: p.approver?.fullName ?? null,
      approvedAt: p.approvedAt,
      paidAt: p.paidAt,
      failureReason: p.failureReason,
      createdAt: p.createdAt,
    };
  }

  async list(q: { status?: string; fleetPartnerId?: string; limit: number }) {
    const rows = await this.prisma.fleetPayout.findMany({
      where: { ...(q.status ? { status: q.status as never } : {}), ...(q.fleetPartnerId ? { fleetPartnerId: q.fleetPartnerId } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit,
      select: { id: true },
    });
    return Promise.all(rows.map((r) => this.dto(r.id)));
  }

  /** A fleet owner sees only their own company's payouts. */
  async listOwn(actor: Actor, q: { limit: number }) {
    if (!actor.fleetPartnerId || actor.driverId) throw Err.forbidden();
    return this.list({ fleetPartnerId: actor.fleetPartnerId, limit: q.limit }).then((rows) => rows.filter((r) => r.status !== 'DRAFT' && r.status !== 'CANCELLED'));
  }

  async statement(id: string, scopeFleetPartnerId?: string) {
    const p = await this.load(id);
    if (scopeFleetPartnerId && p.fleetPartnerId !== scopeFleetPartnerId) throw Err.notFound();
    if (scopeFleetPartnerId && (p.status === 'DRAFT' || p.status === 'CANCELLED')) throw Err.notFound();
    const shipments = await this.prisma.shipment.findMany({
      where: { id: { in: p.items.map((i) => i.shipmentId) } },
      select: { id: true, waybillNumber: true, originMunicipality: { select: { name: true } }, destMunicipality: { select: { name: true } }, transportCanal: true, chargeableWeightKg: true, arrivedDestAt: true },
    });
    const by = new Map(shipments.map((s) => [s.id, s]));
    const lines = p.items.map((i) => {
      const s = by.get(i.shipmentId);
      return {
        kind: i.kind,
        waybill: s?.waybillNumber ?? null,
        route: s ? `${s.originMunicipality.name} → ${s.destMunicipality.name}` : null,
        canal: s?.transportCanal ?? null,
        chargeableKg: s?.chargeableWeightKg ?? null,
        arrivedAt: s?.arrivedDestAt ?? null,
        description: i.description,
        amount: i.kind === 'CLAIM_DEDUCTION' ? `-${i.amountUsd.toFixed(4)}` : i.amountUsd.toFixed(4),
      };
    });
    return {
      payoutNo: p.payoutNo,
      status: p.status,
      fleetPartner: p.fleetPartner.companyName,
      period: { start: p.periodStart, end: p.periodEnd },
      lines,
      totals: { gross: usd(p.grossAmountUsd), claimDeduction: usd(p.claimDeductionUsd), net: usd(p.netAmountUsd) },
      channel: p.channel,
      bankReference: p.bankReference,
      paidAt: p.paidAt,
    };
  }

  /** Statement as CSV (formula-injection safe). */
  async statementCsv(id: string, scopeFleetPartnerId?: string): Promise<string> {
    const s = await this.statement(id, scopeFleetPartnerId);
    const rows: string[][] = [
      ['Payout', s.payoutNo, 'Status', s.status],
      ['Fleet partner', s.fleetPartner, 'Period', `${formatDiliDateTime(s.period.start)} – ${formatDiliDateTime(s.period.end)}`],
      [],
      ['Type', 'Waybill', 'Route', 'Transport', 'Chargeable kg', 'Arrived (Dili)', 'Description', 'Amount USD'],
      ...s.lines.map((l) => [l.kind, l.waybill ?? '', l.route ?? '', l.canal ?? '', String(l.chargeableKg ?? ''), l.arrivedAt ? formatDiliDateTime(l.arrivedAt) : '', l.description ?? '', l.amount]),
      [],
      ['', '', '', '', '', '', 'Gross', s.totals.gross ?? ''],
      ['', '', '', '', '', '', 'Claim deductions', `-${s.totals.claimDeduction}`],
      ['', '', '', '', '', '', 'Net payable', s.totals.net ?? ''],
      ['', '', '', '', '', '', 'Bank / MOSAN reference', s.bankReference ?? ''],
    ];
    return rows.map((r) => r.map(csvEscape).join(',')).join('\r\n') + '\r\n';
  }

  /** Per-trip earnings for the fleet owner portal (40 % share per parcel, paid or pending). */
  async earnings(actor: Actor, q: { limit: number; before?: string }) {
    if (!actor.fleetPartnerId || actor.driverId) throw Err.forbidden();
    const rows = await this.prisma.shipmentSettlement.findMany({
      where: { fleetPartnerId: actor.fleetPartnerId, ...(q.before ? { createdAt: { lt: new Date(q.before) } } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit,
      include: { shipment: { select: { id: true, waybillNumber: true, status: true, transportCanal: true, originMunicipality: { select: { name: true } }, destMunicipality: { select: { name: true } }, payoutItems: { where: { kind: 'EARNING' }, select: { payout: { select: { payoutNo: true, status: true } } } } } } },
    });
    return rows.map((r) => {
      const paid = r.shipment.payoutItems[0]?.payout;
      return {
        waybill: r.shipment.waybillNumber,
        route: `${r.shipment.originMunicipality.name} → ${r.shipment.destMunicipality.name}`,
        canal: r.shipment.transportCanal,
        share: usd(r.fleetShareUsd),
        state: paid?.status === 'PAID' ? 'PAID' : paid ? 'IN_PAYOUT' : r.fleetReleasedAt ? 'RELEASED' : 'PENDING_ARRIVAL',
        payoutNo: paid?.payoutNo ?? null,
        releasedAt: r.fleetReleasedAt,
      };
    });
  }
}

export { formatMoneyDb };
