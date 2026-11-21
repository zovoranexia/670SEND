import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { LedgerEntry, LedgerEntryType, LedgerReferenceType, Wallet, WalletOwnerType, WalletType } from '@prisma/client';
import { Err } from '../common/errors';
import { stableStringify } from '../idempotency/idempotency.interceptor';
import { PrismaService } from '../prisma/prisma.service';

export const SYSTEM_OWNER_ID = 'SYSTEM';

export type WalletRef =
  | { id: string }
  | { ownerType: WalletOwnerType; ownerId: string; walletType: WalletType };

export interface PostingLine {
  wallet: WalletRef;
  type: LedgerEntryType;
  /** Always positive; the direction is `type`. Max 4 decimals (NUMERIC(14,4)). */
  amount: Prisma.Decimal.Value;
  description?: string;
  /** Finer-grained label for this entry (FLEET_SHARE, DEST_COMMISSION…); defaults to the posting's referenceType. */
  referenceType?: LedgerReferenceType;
}

export interface PostInput {
  referenceType: LedgerReferenceType;
  referenceId?: string;
  /** Same key + same lines → the original transaction is returned (replayed = true). */
  idempotencyKey?: string;
  description?: string;
  metadata?: Record<string, unknown>;
  createdBy?: string;
  lines: PostingLine[];
}

export interface PostResult {
  transactionId: string;
  replayed: boolean;
  entries: LedgerEntry[];
}

interface NormalisedLine {
  wallet: WalletRef;
  type: LedgerEntryType;
  amount: Prisma.Decimal;
  description?: string;
  referenceType?: LedgerReferenceType;
}

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const MAX_RETRIES = 3;

const systemWallet = (walletType: WalletType): WalletRef => ({
  ownerType: 'SYSTEM',
  ownerId: SYSTEM_OWNER_ID,
  walletType,
});

/**
 * Banking-grade double-entry ledger.
 *
 *  • every posting is a LedgerTransaction whose entries net to exactly zero
 *    (checked here AND by a deferred DB trigger);
 *  • wallets are locked with SELECT … FOR UPDATE in id order → no lost updates, no deadlocks;
 *  • no wallet (except EXTERNAL_CLEARING) can go negative or dip into `lockedBalance`;
 *  • an Idempotency key guarantees a retried request never posts twice;
 *  • entries are immutable (DB trigger) — a mistake is fixed with reverse(), never an UPDATE.
 */
@Injectable()
export class LedgerService {
  private readonly log = new Logger('Ledger');

  constructor(private readonly prisma: PrismaService) {}

  static systemWallet = systemWallet;

  /* ------------------------------ posting ------------------------------ */

  /**
   * Post a balanced set of lines. Pass `tx` to make the posting part of the caller's business
   * transaction (e.g. shipment intake: shipment + settlement + ledger commit or fail together);
   * otherwise a transaction is opened here (and retried on deadlock / serialization failure).
   */
  async post(input: PostInput, tx?: Prisma.TransactionClient): Promise<PostResult> {
    const lines = this.normalise(input.lines);
    const payloadHash = createHash('sha256')
      .update(
        stableStringify({
          type: input.referenceType,
          ref: input.referenceId ?? null,
          lines: lines.map((l) => ({ w: this.walletKey(l.wallet), t: l.type, a: l.amount.toFixed(4), r: l.referenceType ?? null })),
        }),
      )
      .digest('hex');

    // Wallets are created outside the money transaction: an empty wallet is harmless if it rolls back.
    const walletIds = new Map<string, string>();
    for (const l of lines) {
      const key = this.walletKey(l.wallet);
      if (!walletIds.has(key)) walletIds.set(key, await this.resolveWalletId(l.wallet));
    }

    const run = (client: Prisma.TransactionClient) => this.postInTx(client, input, lines, walletIds, payloadHash);
    if (tx) return run(tx);

    for (let attempt = 1; ; attempt++) {
      try {
        return await this.prisma.$transaction(run, { timeout: 15_000, maxWait: 5_000 });
      } catch (err) {
        const retryable = err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034';
        if (!retryable || attempt >= MAX_RETRIES) throw err;
        this.log.warn(`Ledger posting retry ${attempt} (deadlock / write conflict)`);
        await new Promise((r) => setTimeout(r, 25 * attempt + Math.random() * 25));
      }
    }
  }

  private async postInTx(
    tx: Prisma.TransactionClient,
    input: PostInput,
    lines: NormalisedLine[],
    walletIds: Map<string, string>,
    payloadHash: string,
  ): Promise<PostResult> {
    if (input.idempotencyKey) {
      // Serialise concurrent requests that carry the same key.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${input.idempotencyKey}, 0))`;
      const existing = await tx.ledgerTransaction.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        include: { entries: true },
      });
      if (existing) {
        const stored = (existing.metadata as { _payloadHash?: string } | null)?._payloadHash;
        if (stored !== payloadHash) throw Err.idempotencyConflict();
        return { transactionId: existing.id, replayed: true, entries: existing.entries };
      }
    }

    // Pessimistic lock, always in id order (consistent order ⇒ no deadlock between postings).
    const ids = [...new Set(walletIds.values())].sort();
    await tx.$queryRaw`SELECT id FROM wallets WHERE id = ANY(${ids}::uuid[]) ORDER BY id FOR UPDATE`;
    const wallets = new Map<string, Wallet>(
      (await tx.wallet.findMany({ where: { id: { in: ids } } })).map((w) => [w.id, w]),
    );
    if (wallets.size !== ids.length) throw Err.walletNotFound();

    // Debits first (readability), then credits; running balances handle several lines on one wallet.
    const ordered = [...lines].sort((a, b) => (a.type === b.type ? 0 : a.type === 'DEBIT' ? -1 : 1));
    const running = new Map<string, Prisma.Decimal>(ids.map((id) => [id, wallets.get(id)!.balance]));

    const entryRows: Prisma.LedgerEntryCreateManyInput[] = [];
    const transactionId = (
      await tx.ledgerTransaction.create({
        data: {
          referenceType: input.referenceType,
          referenceId: input.referenceId,
          idempotencyKey: input.idempotencyKey,
          description: input.description,
          createdBy: input.createdBy,
          metadata: { ...(input.metadata as Prisma.InputJsonObject | undefined), _payloadHash: payloadHash },
        },
        select: { id: true },
      })
    ).id;

    for (const line of ordered) {
      const walletId = walletIds.get(this.walletKey(line.wallet))!;
      const wallet = wallets.get(walletId)!;
      const before = running.get(walletId)!;
      const after = line.type === 'CREDIT' ? before.plus(line.amount) : before.minus(line.amount);

      if (line.type === 'DEBIT' && wallet.walletType !== 'EXTERNAL_CLEARING' && after.lessThan(wallet.lockedBalance)) {
        throw Err.insufficientDeposit();
      }
      running.set(walletId, after);
      entryRows.push({
        transactionId,
        walletId,
        entryType: line.type,
        referenceType: line.referenceType ?? input.referenceType,
        referenceId: input.referenceId,
        amount: line.amount,
        balanceBefore: before,
        balanceAfter: after,
        description: line.description ?? input.description,
        createdBy: input.createdBy,
      });
    }

    const entries = await tx.ledgerEntry.createManyAndReturn({ data: entryRows });
    for (const [walletId, balance] of running) {
      await tx.wallet.update({ where: { id: walletId }, data: { balance, version: { increment: 1 } } });
    }
    return { transactionId, replayed: false, entries };
  }

  /* ------------------------------ helpers ------------------------------ */

  private normalise(lines: PostingLine[]): NormalisedLine[] {
    if (lines.length < 2) throw Err.ledgerUnbalanced();
    let credits = D(0);
    let debits = D(0);
    const out = lines.map((l) => {
      const amount = D(l.amount);
      if (!amount.isFinite() || amount.lessThanOrEqualTo(0) || amount.decimalPlaces() > 4) {
        throw Err.validation([{ path: 'amount', message: 'errors.validation_failed' }]);
      }
      if (l.type === 'CREDIT') credits = credits.plus(amount);
      else debits = debits.plus(amount);
      return { wallet: l.wallet, type: l.type, amount, description: l.description, referenceType: l.referenceType };
    });
    if (!credits.equals(debits)) throw Err.ledgerUnbalanced();
    return out;
  }

  private walletKey(ref: WalletRef): string {
    return 'id' in ref ? `id:${ref.id}` : `${ref.ownerType}:${ref.ownerId}:${ref.walletType}`;
  }

  /** Find or create the wallet for an owner reference (race-safe). */
  async resolveWalletId(ref: WalletRef): Promise<string> {
    if ('id' in ref) {
      const w = await this.prisma.wallet.findUnique({ where: { id: ref.id }, select: { id: true } });
      if (!w) throw Err.walletNotFound();
      return w.id;
    }
    const where = { ownerType_ownerId_walletType: { ownerType: ref.ownerType, ownerId: ref.ownerId, walletType: ref.walletType } };
    const existing = await this.prisma.wallet.findUnique({ where, select: { id: true } });
    if (existing) return existing.id;
    try {
      return (await this.prisma.wallet.create({ data: { ownerType: ref.ownerType, ownerId: ref.ownerId, walletType: ref.walletType }, select: { id: true } })).id;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return (await this.prisma.wallet.findUniqueOrThrow({ where, select: { id: true } })).id;
      }
      throw err;
    }
  }

  /* ----------------------------- corrections ---------------------------- */

  /** Immutable history is corrected by posting the exact opposite entries (idempotent per original). */
  async reverse(
    transactionId: string,
    opts: { reason: string; createdBy?: string; idempotencyKey?: string },
    tx?: Prisma.TransactionClient,
  ): Promise<PostResult> {
    const client = tx ?? this.prisma;
    const original = await client.ledgerTransaction.findUnique({ where: { id: transactionId }, include: { entries: true } });
    if (!original) throw Err.notFound();
    return this.post(
      {
        referenceType: 'ADJUSTMENT',
        referenceId: transactionId,
        idempotencyKey: opts.idempotencyKey ?? `reverse:${transactionId}`,
        description: `Reversal of ${transactionId}: ${opts.reason}`,
        metadata: { reverses: transactionId, reason: opts.reason },
        createdBy: opts.createdBy,
        lines: original.entries.map((e) => ({
          wallet: { id: e.walletId },
          type: e.entryType === 'CREDIT' ? ('DEBIT' as const) : ('CREDIT' as const),
          amount: e.amount,
          description: `Reversal: ${opts.reason}`,
        })),
      },
      tx,
    );
  }

  /* ------------------------------- queries ------------------------------ */

  async balanceOf(ref: WalletRef): Promise<{ walletId: string; balance: Prisma.Decimal; locked: Prisma.Decimal; available: Prisma.Decimal }> {
    const id = await this.resolveWalletId(ref);
    const w = await this.prisma.wallet.findUniqueOrThrow({ where: { id } });
    return { walletId: w.id, balance: w.balance, locked: w.lockedBalance, available: w.balance.minus(w.lockedBalance) };
  }

  async statement(walletId: string, opts: { limit?: number; before?: Date } = {}): Promise<LedgerEntry[]> {
    return this.prisma.ledgerEntry.findMany({
      where: { walletId, ...(opts.before ? { createdAt: { lt: opts.before } } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: Math.min(opts.limit ?? 50, 200),
    });
  }

  /**
   * Integrity report for the Finance reconciliation screen (Phase 4) and for ops:
   *  - globalNet            Σ all wallet balances (must be exactly 0.0000)
   *  - mismatchedWallets    wallets whose balance ≠ Σ(credits − debits) of their entries
   *  - unbalancedTransactions  ledger transactions that do not net to zero
   */
  async reconcile(): Promise<{
    ok: boolean;
    globalNet: string;
    mismatchedWallets: Array<{ walletId: string; balance: string; ledger: string }>;
    unbalancedTransactions: Array<{ transactionId: string; net: string }>;
  }> {
    const [row] = await this.prisma.$queryRaw<Array<{ net: Prisma.Decimal }>>`SELECT COALESCE(SUM(balance), 0) AS net FROM wallets`;
    const net = row?.net ?? D(0);

    const mismatched = await this.prisma.$queryRaw<Array<{ id: string; balance: Prisma.Decimal; ledger: Prisma.Decimal }>>`
      SELECT w.id, w.balance,
             COALESCE(SUM(CASE e.entry_type WHEN 'CREDIT' THEN e.amount ELSE -e.amount END), 0) AS ledger
        FROM wallets w LEFT JOIN ledger_entries e ON e.wallet_id = w.id
       GROUP BY w.id, w.balance
      HAVING w.balance <> COALESCE(SUM(CASE e.entry_type WHEN 'CREDIT' THEN e.amount ELSE -e.amount END), 0)`;

    const unbalanced = await this.prisma.$queryRaw<Array<{ transaction_id: string; net: Prisma.Decimal }>>`
      SELECT transaction_id, SUM(CASE entry_type WHEN 'CREDIT' THEN amount ELSE -amount END) AS net
        FROM ledger_entries GROUP BY transaction_id
      HAVING SUM(CASE entry_type WHEN 'CREDIT' THEN amount ELSE -amount END) <> 0`;

    return {
      ok: net.equals(0) && mismatched.length === 0 && unbalanced.length === 0,
      globalNet: net.toFixed(4),
      mismatchedWallets: mismatched.map((m) => ({ walletId: m.id, balance: m.balance.toFixed(4), ledger: m.ledger.toFixed(4) })),
      unbalancedTransactions: unbalanced.map((u) => ({ transactionId: u.transaction_id, net: u.net.toFixed(4) })),
    };
  }
}

