import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { LedgerService, type WalletRef } from '../src/ledger/ledger.service';
import { createTestApp, type TestCtx } from './helpers';

const D = (v: string | number) => new Prisma.Decimal(v);
const CLEARING: WalletRef = LedgerService.systemWallet('EXTERNAL_CLEARING');
const REVENUE: WalletRef = LedgerService.systemWallet('PLATFORM_REVENUE');

describe('LedgerService (real PostgreSQL)', () => {
  let ctx: TestCtx;
  let ledger: LedgerService;

  beforeAll(async () => {
    ctx = await createTestApp();
    ledger = ctx.app.get(LedgerService);
  });
  afterAll(() => ctx.close());

  const newAgent = (): WalletRef => ({ ownerType: 'AGENT', ownerId: randomUUID(), walletType: 'DEPOSIT' });

  async function fund(wallet: WalletRef, amount: string) {
    return ledger.post({
      referenceType: 'DEPOSIT_TOPUP',
      idempotencyKey: `fund:${randomUUID()}`,
      lines: [
        { wallet: CLEARING, type: 'DEBIT', amount },
        { wallet, type: 'CREDIT', amount },
      ],
    });
  }
  // A given idempotency key always describes the SAME business event (same reference).
  const spend = (wallet: WalletRef, amount: string, key: string = `spend:${randomUUID()}`) =>
    ledger.post({
      referenceType: 'SHIPMENT_INTAKE',
      referenceId: `ref:${key}`,
      idempotencyKey: key,
      lines: [
        { wallet, type: 'DEBIT', amount },
        { wallet: REVENUE, type: 'CREDIT', amount },
      ],
    });

  it('creates the wallet on first use and records exact before/after balances', async () => {
    const w = newAgent();
    const res = await fund(w, '100.0000');
    expect(res.replayed).toBe(false);
    const credit = res.entries.find((e) => e.entryType === 'CREDIT')!;
    expect(credit.balanceBefore.toFixed(4)).toBe('0.0000');
    expect(credit.balanceAfter.toFixed(4)).toBe('100.0000');
    expect((await ledger.balanceOf(w)).balance.toFixed(4)).toBe('100.0000');
  });

  it('rejects an unbalanced posting before touching the database', async () => {
    const w = newAgent();
    await expect(
      ledger.post({
        referenceType: 'ADJUSTMENT',
        lines: [
          { wallet: CLEARING, type: 'DEBIT', amount: '10' },
          { wallet: w, type: 'CREDIT', amount: '9.9999' },
        ],
      }),
    ).rejects.toMatchObject({ code: 'ledger_unbalanced' });
  });

  it('rejects zero, negative and >4-decimal amounts', async () => {
    const w = newAgent();
    for (const bad of ['0', '-5', '1.00001']) {
      await expect(
        ledger.post({
          referenceType: 'ADJUSTMENT',
          lines: [
            { wallet: CLEARING, type: 'DEBIT', amount: bad },
            { wallet: w, type: 'CREDIT', amount: bad },
          ],
        }),
      ).rejects.toMatchObject({ code: 'validation_failed' });
    }
  });

  it('refuses to overdraw a wallet and leaves no trace of the failed posting', async () => {
    const w = newAgent();
    await fund(w, '10.0000');
    const key = `overdraw:${randomUUID()}`;
    await expect(spend(w, '10.0001', key)).rejects.toMatchObject({ code: 'insufficient_deposit' });
    expect((await ledger.balanceOf(w)).balance.toFixed(4)).toBe('10.0000');
    expect(await ctx.prisma.ledgerTransaction.count({ where: { idempotencyKey: key } })).toBe(0);
  });

  it('is idempotent: the same key posts exactly once and replays the original', async () => {
    const w = newAgent();
    await fund(w, '50.0000');
    const key = `idem:${randomUUID()}`;
    const first = await spend(w, '12.5000', key);
    const second = await spend(w, '12.5000', key);
    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.transactionId).toBe(first.transactionId);
    expect((await ledger.balanceOf(w)).balance.toFixed(4)).toBe('37.5000');
  });

  it('rejects the same idempotency key reused with a different amount', async () => {
    const w = newAgent();
    await fund(w, '50.0000');
    const key = `idem-conflict:${randomUUID()}`;
    await spend(w, '5.0000', key);
    await expect(spend(w, '6.0000', key)).rejects.toMatchObject({ code: 'idempotency_conflict' });
  });

  it('never lets concurrent debits overdraw: 12 parallel × $30 against $100 → exactly 3 succeed', async () => {
    const w = newAgent();
    await fund(w, '100.0000');
    const results = await Promise.allSettled(Array.from({ length: 12 }, () => spend(w, '30.0000')));
    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(ok).toHaveLength(3);
    expect(failed).toHaveLength(9);
    for (const f of failed) expect(f.reason).toMatchObject({ code: 'insufficient_deposit' });
    const bal = await ledger.balanceOf(w);
    expect(bal.balance.toFixed(4)).toBe('10.0000');
    // the wallet equals the sum of its immutable entries
    const entries = await ctx.prisma.ledgerEntry.findMany({ where: { walletId: bal.walletId } });
    const net = entries.reduce((a, e) => (e.entryType === 'CREDIT' ? a.plus(e.amount) : a.minus(e.amount)), D(0));
    expect(net.toFixed(4)).toBe('10.0000');
  });

  it('concurrent requests with the SAME key produce a single transaction', async () => {
    const w = newAgent();
    await fund(w, '100.0000');
    const key = `same-key:${randomUUID()}`;
    const results = await Promise.all(Array.from({ length: 6 }, () => spend(w, '20.0000', key)));
    expect(new Set(results.map((r) => r.transactionId)).size).toBe(1);
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    expect((await ledger.balanceOf(w)).balance.toFixed(4)).toBe('80.0000');
  });

  it('supports several lines on one wallet and multi-party splits that net to zero', async () => {
    const a = newAgent();
    const b = newAgent();
    await fund(a, '40.0000');
    const res = await ledger.post({
      referenceType: 'SHIPMENT_INTAKE',
      referenceId: randomUUID(),
      lines: [
        { wallet: a, type: 'DEBIT', amount: '3.4000' },
        { wallet: REVENUE, type: 'CREDIT', amount: '1.0000' },
        { wallet: b, type: 'CREDIT', amount: '1.6000' },
        { wallet: LedgerService.systemWallet('PENDING_SETTLEMENT'), type: 'CREDIT', amount: '0.6000' },
        { wallet: LedgerService.systemWallet('CLAIM_ESCROW_RESERVE'), type: 'CREDIT', amount: '0.2000' },
      ],
    });
    expect(res.entries).toHaveLength(5);
    expect((await ledger.balanceOf(a)).balance.toFixed(4)).toBe('36.6000');
    expect((await ledger.balanceOf(b)).balance.toFixed(4)).toBe('1.6000');
  });

  it('reverse() restores balances and is itself idempotent', async () => {
    const w = newAgent();
    await fund(w, '30.0000');
    const spent = await spend(w, '12.0000');
    expect((await ledger.balanceOf(w)).balance.toFixed(4)).toBe('18.0000');

    const rev1 = await ledger.reverse(spent.transactionId, { reason: 'test refund' });
    const rev2 = await ledger.reverse(spent.transactionId, { reason: 'test refund' });
    expect(rev1.replayed).toBe(false);
    expect(rev2.replayed).toBe(true);
    expect((await ledger.balanceOf(w)).balance.toFixed(4)).toBe('30.0000');
  });

  it('respects locked_balance (held funds cannot be spent)', async () => {
    const w = newAgent();
    await fund(w, '100.0000');
    const id = await ledger.resolveWalletId(w);
    await ctx.prisma.wallet.update({ where: { id }, data: { lockedBalance: D(40) } });
    await expect(spend(w, '70.0000')).rejects.toMatchObject({ code: 'insufficient_deposit' });
    await expect(spend(w, '60.0000')).resolves.toMatchObject({ replayed: false });
    expect((await ledger.balanceOf(w)).available.toFixed(4)).toBe('0.0000');
  });

  it('joins the caller transaction: a later failure rolls the posting back too', async () => {
    const w = newAgent();
    await fund(w, '25.0000');
    await expect(
      ctx.prisma.$transaction(async (tx) => {
        await ledger.post(
          {
            referenceType: 'SHIPMENT_INTAKE',
            lines: [
              { wallet: w, type: 'DEBIT', amount: '10.0000' },
              { wallet: REVENUE, type: 'CREDIT', amount: '10.0000' },
            ],
          },
          tx,
        );
        throw new Error('business step failed after the posting');
      }),
    ).rejects.toThrow('business step failed');
    expect((await ledger.balanceOf(w)).balance.toFixed(4)).toBe('25.0000');
  });

  it('entries are immutable at the database level', async () => {
    const w = newAgent();
    const res = await fund(w, '5.0000');
    await expect(
      ctx.prisma.$executeRaw`UPDATE ledger_entries SET amount = 999 WHERE id = ${res.entries[0]!.id}::uuid`,
    ).rejects.toThrow(/append-only/);
    await expect(
      ctx.prisma.$executeRaw`DELETE FROM ledger_entries WHERE id = ${res.entries[0]!.id}::uuid`,
    ).rejects.toThrow(/append-only/);
  });

  it('reconcile() reports a clean ledger after all of the above', async () => {
    const report = await ledger.reconcile();
    expect(report.mismatchedWallets).toEqual([]);
    expect(report.unbalancedTransactions).toEqual([]);
    expect(report.globalNet).toBe('0.0000');
    expect(report.ok).toBe(true);
  });
});
