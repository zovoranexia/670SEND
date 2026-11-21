import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { diliStartOfDayUtc, diliStartOfMonthUtc, formatDiliDateTime } from '@670send/pricing';
import { LedgerService } from '../ledger/ledger.service';
import { PrismaService } from '../prisma/prisma.service';
import { toCsv } from './csv';

const DAY = 86_400_000;
const D0 = new Prisma.Decimal(0);
const fx = (d: Prisma.Decimal | null | undefined) => (d ?? D0).toFixed(4);
const n = (v: bigint | number | null | undefined) => Number(v ?? 0);

/**
 * GMV = shipping charges (base fee + pick-up + delivery add-ons) of shipments created in the period —
 * insurance premiums and storage penalties are not shipping revenue. All periods are Dili calendar periods.
 */
@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
  ) {}

  private async gmv(from: Date, to?: Date): Promise<Prisma.Decimal> {
    const a = await this.prisma.shipment.aggregate({
      _sum: { baseShippingFeeUsd: true, pickupAddonFeeUsd: true, deliveryAddonFeeUsd: true },
      where: { createdAt: { gte: from, ...(to ? { lt: to } : {}) } },
    });
    return (a._sum.baseShippingFeeUsd ?? D0).plus(a._sum.pickupAddonFeeUsd ?? D0).plus(a._sum.deliveryAddonFeeUsd ?? D0);
  }

  /** Net credits to PLATFORM_REVENUE (credits − refunds) since `from`. */
  private async platformRevenueSince(from: Date): Promise<Prisma.Decimal> {
    const r = await this.prisma.$queryRaw<Array<{ v: Prisma.Decimal }>>`
      SELECT COALESCE(SUM(CASE e.entry_type WHEN 'CREDIT' THEN e.amount ELSE -e.amount END), 0) AS v
        FROM ledger_entries e JOIN wallets w ON w.id = e.wallet_id
       WHERE w.owner_type = 'SYSTEM' AND w.wallet_type = 'PLATFORM_REVENUE' AND e.created_at >= ${from}`;
    return r[0]?.v ?? D0;
  }

  async executive(now = new Date()) {
    const todayStart = diliStartOfDayUtc(now);
    const monthStart = diliStartOfMonthUtc(now);
    const unclaimedBefore = new Date(todayStart.getTime() - 4 * DAY); // arrival date ≤ today − 5 → storage Day ≥ 6

    const [gmvToday, gmvMonth, revMonth, statusGroups, unclaimed, openClaims, pendingDeposits, payoutsAwaiting, openIncidents, rtsPending, pool, escrow, revWallet, hubOps, pending, byCorridor, series] = await Promise.all([
      this.gmv(todayStart),
      this.gmv(monthStart),
      this.platformRevenueSince(monthStart),
      this.prisma.shipment.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.shipment.count({ where: { status: 'ARRIVED_AT_DEST_AGENT', arrivedDestAt: { lt: unclaimedBefore } } }),
      this.prisma.claim.count({ where: { status: { in: ['OPEN', 'INVESTIGATING', 'APPROVED'] } } }),
      this.prisma.depositRequest.aggregate({ _count: { _all: true }, _sum: { amountUsd: true }, where: { status: 'PENDING' } }),
      this.prisma.fleetPayout.count({ where: { status: { in: ['PENDING_APPROVAL', 'APPROVED'] } } }),
      this.prisma.inboundIncident.count({ where: { status: { in: ['OPEN', 'UNDER_REVIEW'] } } }),
      this.prisma.shipment.count({ where: { status: 'RETURN_TO_SENDER', rtsHandedBackAt: null } }),
      this.ledger.balanceOf(LedgerService.systemWallet('INSURANCE_POOL')),
      this.ledger.balanceOf(LedgerService.systemWallet('CLAIM_ESCROW_RESERVE')),
      this.ledger.balanceOf(LedgerService.systemWallet('PLATFORM_REVENUE')),
      this.ledger.balanceOf(LedgerService.systemWallet('PLATFORM_HUB_OPS')),
      this.ledger.balanceOf(LedgerService.systemWallet('PENDING_SETTLEMENT')),
      this.prisma.$queryRaw<Array<{ corridor: string; parcels: bigint; gmv: Prisma.Decimal }>>`
        SELECT CASE WHEN dm.code = 'DIL' THEN om.corridor ELSE dm.corridor END::text AS corridor,
               COUNT(*) AS parcels,
               COALESCE(SUM(s.base_shipping_fee_usd + s.pickup_addon_fee_usd + s.delivery_addon_fee_usd), 0) AS gmv
          FROM shipments s
          JOIN municipalities om ON om.id = s.origin_municipality_id
          JOIN municipalities dm ON dm.id = s.dest_municipality_id
         WHERE s.created_at >= ${new Date(now.getTime() - 30 * DAY)}
         GROUP BY 1 ORDER BY 2 DESC`,
      this.dailySeries(new Date(todayStart.getTime() - 13 * DAY), new Date(todayStart.getTime() + DAY)),
    ]);

    const byStatus = Object.fromEntries(statusGroups.map((g) => [g.status, g._count._all]));
    return {
      asOf: now,
      gmv: { today: fx(gmvToday), month: fx(gmvMonth) },
      platformRevenue: { month: fx(revMonth), walletBalance: fx(revWallet.balance) },
      reserves: { claimEscrow: fx(escrow.balance), insurancePool: fx(pool.balance), hubOps: fx(hubOps.balance), pendingSettlement: fx(pending.balance) },
      shipments: {
        byStatus,
        inTransit: byStatus['IN_TRANSIT'] ?? 0,
        atHub: byStatus['CONSOLIDATED_AT_HUB'] ?? 0,
        atKiosk: byStatus['ARRIVED_AT_DEST_AGENT'] ?? 0,
        onHold: byStatus['ON_HOLD_ISSUE'] ?? 0,
        unclaimedOver5Days: unclaimed,
        returnToSenderPending: rtsPending,
      },
      queues: {
        openClaims,
        openIncidents,
        pendingDeposits: { count: pendingDeposits._count._all, amount: fx(pendingDeposits._sum.amountUsd) },
        payoutsAwaitingApproval: payoutsAwaiting,
      },
      byCorridor: byCorridor.map((r) => ({ corridor: r.corridor, parcels: n(r.parcels), gmv: fx(r.gmv) })),
      last14Days: series,
    };
  }

  /** Parcels and GMV per Dili calendar day. */
  private async dailySeries(from: Date, to: Date) {
    const rows = await this.prisma.$queryRaw<Array<{ d: Date; parcels: bigint; gmv: Prisma.Decimal }>>`
      SELECT (s.created_at AT TIME ZONE 'Asia/Dili')::date AS d,
             COUNT(*) AS parcels,
             COALESCE(SUM(s.base_shipping_fee_usd + s.pickup_addon_fee_usd + s.delivery_addon_fee_usd), 0) AS gmv
        FROM shipments s
       WHERE s.created_at >= ${from} AND s.created_at < ${to}
       GROUP BY 1 ORDER BY 1`;
    const byDay = new Map(rows.map((r) => [r.d.toISOString().slice(0, 10), r]));
    const out: Array<{ date: string; parcels: number; gmv: string }> = [];
    for (let t = from.getTime(); t < to.getTime(); t += DAY) {
      // `from` is Dili midnight in UTC; +9h lands on the Dili calendar date
      const date = new Date(t + 9 * 3_600_000).toISOString().slice(0, 10);
      const r = byDay.get(date);
      out.push({ date, parcels: n(r?.parcels), gmv: fx(r?.gmv) });
    }
    return out;
  }

  async volume(q: { from: Date; to: Date; groupBy: 'day' | 'municipality' }) {
    if (q.groupBy === 'day') return { groupBy: 'day', rows: await this.dailySeries(diliStartOfDayUtc(q.from), diliStartOfDayUtc(q.to)) };
    const rows = await this.prisma.$queryRaw<Array<{ code: string; name: string; parcels: bigint; gmv: Prisma.Decimal }>>`
      SELECT m.code, m.name, COUNT(*) AS parcels,
             COALESCE(SUM(s.base_shipping_fee_usd + s.pickup_addon_fee_usd + s.delivery_addon_fee_usd), 0) AS gmv
        FROM shipments s
        JOIN municipalities m ON m.id = CASE WHEN s.dest_municipality_id = (SELECT id FROM municipalities WHERE code = 'DIL') THEN s.origin_municipality_id ELSE s.dest_municipality_id END
       WHERE s.created_at >= ${q.from} AND s.created_at < ${q.to}
       GROUP BY m.code, m.name ORDER BY parcels DESC`;
    return { groupBy: 'municipality', rows: rows.map((r) => ({ code: r.code, name: r.name, parcels: n(r.parcels), gmv: fx(r.gmv) })) };
  }

  /* ======================================== CSV ======================================== */

  async shipmentsCsv(q: { from: Date; to: Date }, cap = 50_000): Promise<string> {
    const rows = await this.prisma.shipment.findMany({
      where: { createdAt: { gte: q.from, lt: q.to } },
      orderBy: { createdAt: 'asc' },
      take: cap,
      include: { originMunicipality: { select: { code: true } }, destMunicipality: { select: { code: true } } },
    });
    return toCsv(
      ['Waybill', 'Created (Dili)', 'Scheme', 'Canal', 'From', 'To', 'Status', 'Chargeable kg', 'Base USD', 'Pick-up USD', 'Delivery USD', 'Insurance USD', 'Storage USD', 'Total USD', 'Sender', 'Recipient'],
      rows.map((s) => [s.waybillNumber, formatDiliDateTime(s.createdAt), s.serviceScheme, s.transportCanal, s.originMunicipality.code, s.destMunicipality.code, s.status, s.chargeableWeightKg, fx(s.baseShippingFeeUsd), fx(s.pickupAddonFeeUsd), fx(s.deliveryAddonFeeUsd), fx(s.insuranceFeeUsd), fx(s.storagePenaltyUsd), fx(s.totalFeeUsd), s.senderName, s.recipientName]),
    );
  }

  async ledgerCsv(q: { from: Date; to: Date }, cap = 100_000): Promise<string> {
    const rows = await this.prisma.ledgerEntry.findMany({
      where: { createdAt: { gte: q.from, lt: q.to } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: cap,
      include: { wallet: { select: { ownerType: true, ownerId: true, walletType: true } } },
    });
    return toCsv(
      ['Time (Dili)', 'Transaction', 'Wallet owner', 'Wallet type', 'Entry', 'Reference', 'Reference id', 'Amount USD', 'Balance after USD', 'Description'],
      rows.map((e) => [formatDiliDateTime(e.createdAt), e.transactionId, `${e.wallet.ownerType}:${e.wallet.ownerId}`, e.wallet.walletType, e.entryType, e.referenceType, e.referenceId, fx(e.amount), fx(e.balanceAfter), e.description]),
    );
  }

  async claimsCsv(q: { from: Date; to: Date }): Promise<string> {
    const rows = await this.prisma.claim.findMany({ where: { createdAt: { gte: q.from, lt: q.to } }, orderBy: { createdAt: 'asc' }, take: 50_000, include: { shipment: { select: { waybillNumber: true } } } });
    return toCsv(
      ['Claim', 'Filed (Dili)', 'Waybill', 'Type', 'Status', 'Requested USD', 'Max eligible USD', 'Approved USD', 'Liable party', 'Recovered USD', 'Paid at'],
      rows.map((c) => [c.claimNo, formatDiliDateTime(c.createdAt), c.shipment.waybillNumber, c.claimType, c.status, fx(c.requestedAmountUsd), fx(c.maxEligibleLiabilityUsd), c.approvedAmountUsd ? fx(c.approvedAmountUsd) : '', c.liableParty ?? '', fx(c.recoveredAmountUsd), c.paidAt ? formatDiliDateTime(c.paidAt) : '']),
    );
  }

  async depositsCsv(q: { from: Date; to: Date }): Promise<string> {
    const rows = await this.prisma.depositRequest.findMany({ where: { createdAt: { gte: q.from, lt: q.to } }, orderBy: { createdAt: 'asc' }, take: 50_000 });
    return toCsv(
      ['Requested (Dili)', 'Owner', 'Channel', 'Reference', 'Amount USD', 'Status', 'Reviewed at'],
      rows.map((r) => [formatDiliDateTime(r.createdAt), r.agentId ? `AGENT:${r.agentId}` : `COURIER:${r.courierId}`, r.channel, r.referenceNo, fx(r.amountUsd), r.status, r.reviewedAt ? formatDiliDateTime(r.reviewedAt) : '']),
    );
  }
}
