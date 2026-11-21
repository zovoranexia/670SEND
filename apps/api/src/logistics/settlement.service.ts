import { Injectable } from '@nestjs/common';
import type { IntakeChannel, OriginShareMode, Prisma } from '@prisma/client';
import { STORAGE_POLICY, formatMoneyDb, parseMoney, splitAddon, splitBaseFee, type MoneyUnits } from '@670send/pricing';
import { SettingsService } from '../common/settings.service';
import { LedgerService, type PostingLine, type WalletRef } from '../ledger/ledger.service';
import type { AddonLine } from './pricing.service';

const D = formatMoneyDb;
const sys = LedgerService.systemWallet;

export interface IntakeMoney {
  channel: IntakeChannel;
  /** Wallet that physically collected the customer's cash (agent / courier deposit, or company clearing). */
  payer: WalletRef;
  base: MoneyUnits;
  premium: MoneyUnits;
  pickup: AddonLine | null;
  delivery: AddonLine | null;
}

export interface IntakeSettlementPlan {
  lines: PostingLine[];
  originMode: OriginShareMode;
  row: Omit<Prisma.ShipmentSettlementUncheckedCreateInput, 'shipmentId' | 'intakeLedgerTxnId'>;
  /** What the payer's wallet is debited by (cash collected minus what they legitimately keep). */
  payerDebit: MoneyUnits;
  totalCollected: MoneyUnits;
}

/**
 * Money flows of a shipment (SOP §6, brief §2C). All amounts are exact integers (1/10,000 USD).
 *
 *  INTAKE   customer pays cash F (+ insurance + add-ons) to whoever took the parcel.
 *           The collector's wallet is debited by everything EXCEPT what they keep in cash:
 *             agent kiosk   keeps its 15 % origin commission
 *             courier       keeps 80 % of the pick-up add-on
 *             company hub   keeps nothing (cash goes to the company; clearing wallet is debited)
 *           Credits:  PENDING_SETTLEMENT  fleet 40 % + destination 15 % + delivery-courier 80 % of add-on
 *                     PLATFORM_REVENUE    25 % + 20 % of add-ons          CLAIM_ESCROW_RESERVE 5 %
 *                     PLATFORM_HUB_OPS    origin 15 % when no agent kiosk took the parcel
 *                     INSURANCE_POOL      premium
 *  ARRIVAL  intact inbound scan   → fleet 40 %           PENDING_SETTLEMENT → FLEET_PAYABLE (fleet OWNER, never the driver)
 *  DELIVERY OTP + PoD verified    → destination 15 %     PENDING_SETTLEMENT → agent COMMISSION (or DEPOSIT)
 *                                   delivery courier 80 % PENDING_SETTLEMENT → COURIER_EARNINGS
 *  STORAGE  penalty collected at hand-over: collector keeps 70 %, platform's 30 % is debited from their deposit.
 */
@Injectable()
export class SettlementService {
  constructor(
    private readonly ledger: LedgerService,
    private readonly settings: SettingsService,
  ) {}

  plan(m: IntakeMoney): IntakeSettlementPlan {
    const split = splitBaseFee(m.base);
    const pickupFee = m.pickup?.fee ?? 0n;
    const deliveryFee = m.delivery?.fee ?? 0n;
    const pickupSplit = m.pickup ? { partner: m.pickup.courierShare, platform: m.pickup.platformShare } : splitAddon(0n);
    const deliverySplit = m.delivery ? { partner: m.delivery.courierShare, platform: m.delivery.platformShare } : splitAddon(0n);

    const originMode: OriginShareMode = m.channel === 'AGENT_DROP_OFF' ? 'AGENT_CASH_RETAINED' : 'HUB_OPS';
    const totalCollected = m.base + m.premium + pickupFee + deliveryFee;
    const originRetained = originMode === 'AGENT_CASH_RETAINED' ? split.originAgent : 0n;
    const pickupRetained = m.channel === 'COURIER_PICKUP' ? pickupSplit.partner : 0n;
    const payerDebit = totalCollected - originRetained - pickupRetained;

    const lines: PostingLine[] = [
      { wallet: m.payer, type: 'DEBIT', amount: D(payerDebit), referenceType: 'SHIPMENT_INTAKE', description: 'Cash collected at intake (net of kept share)' },
      { wallet: sys('PENDING_SETTLEMENT'), type: 'CREDIT', amount: D(split.fleet), referenceType: 'FLEET_SHARE', description: 'Fleet 40% held until intact arrival' },
      { wallet: sys('PENDING_SETTLEMENT'), type: 'CREDIT', amount: D(split.destAgent), referenceType: 'DEST_COMMISSION', description: 'Destination agent 15% held until delivery' },
      { wallet: sys('PLATFORM_REVENUE'), type: 'CREDIT', amount: D(split.platform + pickupSplit.platform + deliverySplit.platform), referenceType: 'SHIPMENT_INTAKE', description: 'Platform revenue' },
      { wallet: sys('CLAIM_ESCROW_RESERVE'), type: 'CREDIT', amount: D(split.claimReserve), referenceType: 'ESCROW_ALLOCATION', description: 'Claim reserve 5%' },
    ];
    if (deliverySplit.partner > 0n) {
      lines.push({ wallet: sys('PENDING_SETTLEMENT'), type: 'CREDIT', amount: D(deliverySplit.partner), referenceType: 'COURIER_ADDON_SHARE', description: 'Delivery courier share held until delivery' });
    }
    if (m.premium > 0n) {
      lines.push({ wallet: sys('INSURANCE_POOL'), type: 'CREDIT', amount: D(m.premium), referenceType: 'INSURANCE_PREMIUM', description: 'Insurance premium' });
    }
    if (originMode === 'HUB_OPS') {
      lines.push({ wallet: sys('PLATFORM_HUB_OPS'), type: 'CREDIT', amount: D(split.originAgent), referenceType: 'ORIGIN_COMMISSION', description: 'Origin 15% (no agent kiosk)' });
    }

    return {
      lines: lines.filter((l) => parseMoney(String(l.amount)) > 0n),
      originMode,
      payerDebit,
      totalCollected,
      row: {
        baseFeeUsd: D(m.base),
        fleetShareUsd: D(split.fleet),
        platformShareUsd: D(split.platform),
        originShareUsd: D(split.originAgent),
        destShareUsd: D(split.destAgent),
        claimReserveUsd: D(split.claimReserve),
        insuranceFeeUsd: D(m.premium),
        courierShareUsd: D(deliverySplit.partner),
        addonPlatformUsd: D(pickupSplit.platform + deliverySplit.platform),
        pickupCourierRetainedUsd: D(pickupRetained),
        originMode,
        status: 'HELD',
      },
    };
  }

  /** Fleet 40 % → the OWNER's FLEET_PAYABLE wallet, once the parcel arrived intact. Idempotent. */
  async releaseFleetShare(tx: Prisma.TransactionClient, shipmentId: string, actorId?: string): Promise<boolean> {
    const s = await tx.shipmentSettlement.findUnique({ where: { shipmentId } });
    if (!s || s.fleetReleasedAt) return false;
    if (!s.fleetPartnerId) return false; // not yet manifested — nothing to release
    const amount = s.fleetShareUsd;
    if (amount.isZero()) {
      await tx.shipmentSettlement.update({ where: { id: s.id }, data: { fleetReleasedAt: new Date() } });
      return true;
    }
    const res = await this.ledger.post(
      {
        referenceType: 'FLEET_SHARE',
        referenceId: shipmentId,
        idempotencyKey: `fleet-release:${shipmentId}`,
        description: 'Fleet share released: parcel arrived intact',
        createdBy: actorId,
        lines: [
          { wallet: sys('PENDING_SETTLEMENT'), type: 'DEBIT', amount },
          { wallet: { ownerType: 'FLEET_OWNER', ownerId: s.fleetPartnerId, walletType: 'FLEET_PAYABLE' }, type: 'CREDIT', amount },
        ],
      },
      tx,
    );
    await tx.shipmentSettlement.update({
      where: { id: s.id },
      data: { fleetReleasedAt: new Date(), fleetReleaseLedgerTxnId: res.transactionId },
    });
    return true;
  }

  /** Destination 15 % + delivery courier share, on DELIVERED (OTP + PoD). Also closes the settlement. */
  async releaseDestinationShares(
    tx: Prisma.TransactionClient,
    shipment: { id: string; destAgentId: string | null; deliveryCourierId: string | null },
    actorId?: string,
  ): Promise<void> {
    await this.releaseFleetShare(tx, shipment.id, actorId); // safety net: never leave the fleet unpaid
    const s = await tx.shipmentSettlement.findUnique({ where: { shipmentId: shipment.id } });
    if (!s || s.releasedAt) return;

    const lines: PostingLine[] = [];
    const walletType = await this.settings.destCommissionWallet();
    if (s.destShareUsd.greaterThan(0)) {
      if (!shipment.destAgentId) throw new Error('Shipment without destination agent cannot release commission');
      lines.push(
        { wallet: sys('PENDING_SETTLEMENT'), type: 'DEBIT', amount: s.destShareUsd, referenceType: 'DEST_COMMISSION' },
        { wallet: { ownerType: 'AGENT', ownerId: shipment.destAgentId, walletType }, type: 'CREDIT', amount: s.destShareUsd, referenceType: 'DEST_COMMISSION' },
      );
    }
    if (s.courierShareUsd.greaterThan(0)) {
      lines.push({ wallet: sys('PENDING_SETTLEMENT'), type: 'DEBIT', amount: s.courierShareUsd, referenceType: 'COURIER_ADDON_SHARE' });
      lines.push(
        shipment.deliveryCourierId
          ? { wallet: { ownerType: 'COURIER', ownerId: shipment.deliveryCourierId, walletType: 'COURIER_EARNINGS' }, type: 'CREDIT', amount: s.courierShareUsd, referenceType: 'COURIER_ADDON_SHARE' }
          // Customer paid for door delivery but collected at the kiosk instead: no courier earned it.
          // Parked in platform revenue for finance to refund (open item, see ARCHITECTURE.md).
          : { wallet: sys('PLATFORM_REVENUE'), type: 'CREDIT', amount: s.courierShareUsd, referenceType: 'ADJUSTMENT', description: 'Unused delivery add-on (collected at kiosk)' },
      );
    }

    let txnId: string | undefined;
    if (lines.length > 0) {
      const res = await this.ledger.post(
        {
          referenceType: 'DEST_COMMISSION',
          referenceId: shipment.id,
          idempotencyKey: `dest-release:${shipment.id}`,
          description: 'Delivered: destination commission and courier share released',
          createdBy: actorId,
          lines,
        },
        tx,
      );
      txnId = res.transactionId;
    }
    await tx.shipmentSettlement.update({
      where: { id: s.id },
      data: { status: 'RELEASED', releasedAt: new Date(), releaseLedgerTxnId: txnId },
    });
  }

  /**
   * Storage penalty collected in cash by the person handing the parcel over. They keep the
   * destination agent's 70 %; the platform's 30 % is debited from their deposit.
   */
  async collectStoragePenalty(
    tx: Prisma.TransactionClient,
    args: { shipmentId: string; amount: MoneyUnits; collector: WalletRef; actorId?: string },
  ): Promise<{ platformShare: MoneyUnits; collectorKeeps: MoneyUnits }> {
    const policy = await this.settings.storagePolicy();
    const platformShare = (args.amount * BigInt(policy.platformBps)) / 10_000n;
    const collectorKeeps = args.amount - platformShare;
    if (platformShare > 0n) {
      await this.ledger.post(
        {
          referenceType: 'STORAGE_PENALTY',
          referenceId: args.shipmentId,
          idempotencyKey: `storage-penalty:${args.shipmentId}`,
          description: `Storage penalty ${D(args.amount)} collected (collector keeps ${D(collectorKeeps)})`,
          createdBy: args.actorId,
          lines: [
            { wallet: args.collector, type: 'DEBIT', amount: D(platformShare) },
            { wallet: sys('PLATFORM_REVENUE'), type: 'CREDIT', amount: D(platformShare) },
          ],
        },
        tx,
      );
    }
    return { platformShare, collectorKeeps };
  }
}

export { STORAGE_POLICY };
