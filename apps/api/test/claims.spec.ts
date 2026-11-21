import { randomUUID } from 'node:crypto';
import { LedgerService } from '../src/ledger/ledger.service';
import { bearer, createTestApp, type TestCtx } from './helpers';
import { createNetwork, fund, sysWallet, walletBalance, stagePhoto, type Network } from './scenario';
import { arrivedParcels, cs, deliverAtKiosk, finance, multiRole } from './admin-helpers';

const num = (v: string | number) => Number(v);

describe('Claims engine: liability cap, deadline, approvals, escrow payout, recovery, evidence', () => {
  let ctx: TestCtx;
  let net: Network;
  let ledger: LedgerService;

  beforeAll(async () => {
    ctx = await createTestApp();
    ledger = ctx.app.get(LedgerService);
    net = await createNetwork(ctx);
    await fund(ctx, sysWallet('CLAIM_ESCROW_RESERVE'), '1000.0000');
  });
  afterAll(() => ctx.close());

  const parcel = async (opts: Parameters<typeof arrivedParcels>[3] = {}, network: Network = net) => (await arrivedParcels(ctx, network, 1, opts)).parcels[0]!;
  const insuredOpts = { category: 'ELECTRONICS', description: 'Telefone', declared: '300', insure: true } as const;
  const fileClaim = (token: string, waybill: string, body: Record<string, unknown> = {}) =>
    ctx.http.post('/v1/claims').set(bearer(token)).set('Idempotency-Key', randomUUID()).send({ waybill, claimType: 'DAMAGED', requestedAmountUsd: '10.00', description: 'Box crushed', ...body });
  const decide = (token: string, id: string, body: Record<string, unknown>) => ctx.http.post(`/v1/claims/${id}/decision`).set(bearer(token)).send(body);
  const pay = (token: string, id: string, reference = 'CASH-001') => ctx.http.post(`/v1/claims/${id}/pay`).set(bearer(token)).send({ reference });
  const drain = (wallet: Parameters<typeof walletBalance>[1], amount: string) =>
    ledger.post({ referenceType: 'ADJUSTMENT', idempotencyKey: `drain:${randomUUID()}`, lines: [{ wallet, type: 'DEBIT', amount }, { wallet: sysWallet('PLATFORM_REVENUE'), type: 'CREDIT', amount }] });

  /* --------------------------------------- liability cap --------------------------------------- */
  describe('liability cap (SOP §7.3)', () => {
    it('uninsured: min(10 × base fee, $50) — $4 base → $40; $6 base → $50 cap', async () => {
      const p4 = await parcel();
      const prev = await ctx.http.get(`/v1/claims/liability/${p4.waybill}`).set(bearer(net.bcu.token));
      expect(prev.body).toMatchObject({ isInsured: false, basis: 'UNINSURED_10X_BASE_FEE_MAX_50', maxEligible: '40.0000', remaining: '40.0000' });
      const p6 = await parcel({ weight: 3 }); // 3 kg Zone 2 = $5 → 10 × 5 = 50
      expect((await ctx.http.get(`/v1/claims/liability/${p6.waybill}`).set(bearer(net.bcu.token))).body.maxEligible).toBe('50.0000');
      const p8 = await parcel({ weight: 5 }); // $7 → 70 → capped at 50
      expect((await ctx.http.get(`/v1/claims/liability/${p8.waybill}`).set(bearer(net.bcu.token))).body.maxEligible).toBe('50.0000');
    });

    it('insured: declared value up to $500', async () => {
      const p = await parcel(insuredOpts);
      expect((await ctx.http.get(`/v1/claims/liability/${p.waybill}`).set(bearer(net.bcu.token))).body).toMatchObject({ isInsured: true, maxEligible: '300.0000' });
      const big = await parcel({ ...insuredOpts, declared: '2000' });
      expect((await ctx.http.get(`/v1/claims/liability/${big.waybill}`).set(bearer(net.bcu.token))).body.maxEligible).toBe('500.0000');
    });

    it('a stranger cannot even preview someone else’s parcel', async () => {
      const p = await parcel();
      const other = await createNetwork(ctx);
      expect((await ctx.http.get(`/v1/claims/liability/${p.waybill}`).set(bearer(other.bcu.token))).status).toBe(404);
    });
  });

  /* ------------------------------------------- filing ------------------------------------------- */
  describe('filing', () => {
    it('the destination kiosk files a claim; the cap is computed, the number follows CLM-YYMMDD-NNNN', async () => {
      const p = await parcel();
      const r = await fileClaim(net.bcu.token, p.waybill, { requestedAmountUsd: '12.50', claimantName: 'José Guterres', claimantPhone: '+67077123456' });
      expect(r.status).toBe(201);
      expect(r.body).toMatchObject({ status: 'OPEN', type: 'DAMAGED', requested: '12.5000', maxEligible: '40.0000', approved: null, waybill: p.waybill });
      expect(r.body.claimNo).toMatch(/^CLM-\d{6}-\d{4}$/);
      const mine = await ctx.http.get('/v1/claims?mine=true').set(bearer(net.bcu.token));
      expect(mine.body.map((c: { id: string }) => c.id)).toContain(r.body.id);
    });

    it('only people who handled the parcel (or CS) may file — others get 404', async () => {
      const p = await parcel();
      const other = await createNetwork(ctx);
      expect((await fileClaim(other.bcu.token, p.waybill)).status).toBe(404);
      const desk = await cs(ctx);
      expect((await fileClaim(desk.token, p.waybill)).status).toBe(201);
      expect((await fileClaim(net.fleet.driver.token, p.waybill)).status).toBe(403);
    });

    it('requires an Idempotency-Key and a positive amount; evidence photos must be the filer’s own CLAIM_EVIDENCE', async () => {
      const p = await parcel();
      expect((await ctx.http.post('/v1/claims').set(bearer(net.bcu.token)).send({ waybill: p.waybill, claimType: 'DAMAGED', requestedAmountUsd: '5' })).status).toBe(400);
      expect((await fileClaim(net.bcu.token, p.waybill, { requestedAmountUsd: '0' })).status).toBe(422);
      expect((await fileClaim(net.bcu.token, p.waybill, { evidenceUploadIds: [randomUUID()] })).body.code).toBe('upload_not_found');
      const photo = await stagePhoto(ctx, net.bcu.token, 'CLAIM_EVIDENCE');
      const ok = await fileClaim(net.bcu.token, p.waybill, { evidenceUploadIds: [photo] });
      expect(ok.status).toBe(201);
      expect(ok.body.evidenceCount).toBe(1);
      // same photo can't be reused on another claim
      expect((await fileClaim(net.bcu.token, p.waybill, { evidenceUploadIds: [photo] })).body.code).toBe('upload_not_found');
      // more evidence later
      const more = await stagePhoto(ctx, net.bcu.token, 'CLAIM_EVIDENCE');
      expect((await ctx.http.post(`/v1/claims/${ok.body.id}/evidence`).set(bearer(net.bcu.token)).send({ uploadIds: [more] })).body.evidenceCount).toBe(2);
    });

    describe('"claims after the parcel has been taken home are not valid"', () => {
      it('damage claims are accepted at hand-over, refused later; LOST never on a delivered parcel', async () => {
        const p = await parcel();
        expect((await deliverAtKiosk(ctx, net, p)).status).toBe(200);
        expect((await fileClaim(net.bcu.token, p.waybill)).status).toBe(201); // within the hand-over window
        expect((await fileClaim(net.bcu.token, p.waybill, { claimType: 'LOST' })).body.code).toBe('claim_deadline_passed');

        const row = await ctx.prisma.shipment.findUniqueOrThrow({ where: { waybillNumber: p.waybill } });
        await ctx.prisma.shipment.update({ where: { id: row.id }, data: { deliveredAt: new Date(Date.now() - 2 * 3_600_000) } });
        const late = await fileClaim(net.bcu.token, p.waybill);
        expect(late.status).toBe(422);
        expect(late.body.code).toBe('claim_deadline_passed');
        // the kiosk can't talk its way around it, even with a reason
        expect((await fileClaim(net.bcu.token, p.waybill, { lateFilingReason: 'Customer called back' })).body.code).toBe('claim_deadline_passed');
        // an approver (CS) can accept a documented exception — and only with a reason
        const desk = await cs(ctx);
        expect((await fileClaim(desk.token, p.waybill)).body.code).toBe('claim_deadline_passed');
        const exc = await fileClaim(desk.token, p.waybill, { lateFilingReason: 'Customer showed video of damage on the day' });
        expect(exc.status).toBe(201);
        expect(exc.body.lateFilingReason).toContain('video');
      });
    });
  });

  /* ------------------------------------------ decisions ------------------------------------------ */
  describe('decisions', () => {
    it('CS reviews and approves up to the limit ($25): amount, cap and liable party are enforced', async () => {
      const p = await parcel();
      const desk = await cs(ctx);
      const c = (await fileClaim(net.bcu.token, p.waybill, { requestedAmountUsd: '30.00' })).body;
      expect((await ctx.http.post(`/v1/claims/${c.id}/review`).set(bearer(desk.token))).body.status).toBe('INVESTIGATING');

      expect((await decide(desk.token, c.id, { decision: 'APPROVE', approvedAmountUsd: '31', liableParty: 'PLATFORM_ESCROW' })).body.code).toBe('claim_over_limit'); // more than requested
      expect((await decide(desk.token, c.id, { decision: 'APPROVE', approvedAmountUsd: '20' })).status).toBe(422); // no liable party
      expect((await decide(desk.token, c.id, { decision: 'APPROVE', approvedAmountUsd: '20', liableParty: 'COURIER' })).status).toBe(422); // nobody to be liable
      const big = (await fileClaim(net.bcu.token, p.waybill, { requestedAmountUsd: '45.00' })).body;
      expect((await decide(desk.token, big.id, { decision: 'APPROVE', approvedAmountUsd: '45', liableParty: 'PLATFORM_ESCROW' })).body.code).toBe('claim_over_limit'); // exceeds the $40 cap

      const ok = await decide(desk.token, c.id, { decision: 'APPROVE', approvedAmountUsd: '20.00', liableParty: 'DEST_AGENT', notes: 'Kiosk dropped it' });
      expect(ok.status).toBe(200);
      expect(ok.body).toMatchObject({ status: 'APPROVED', approved: '20.0000', liableParty: 'DEST_AGENT', needsFinanceApproval: false, reviewedBy: 'Test User' });
    });

    it('the total of all claims on one parcel can never exceed its cap', async () => {
      const p = await parcel(); // cap $40
      const desk = await cs(ctx);
      const a = (await fileClaim(net.bcu.token, p.waybill, { requestedAmountUsd: '25' })).body;
      const b = (await fileClaim(net.bcu.token, p.waybill, { requestedAmountUsd: '25' })).body;
      expect((await decide(desk.token, a.id, { decision: 'APPROVE', approvedAmountUsd: '25', liableParty: 'PLATFORM_ESCROW' })).status).toBe(200);
      const second = await decide(desk.token, b.id, { decision: 'APPROVE', approvedAmountUsd: '25', liableParty: 'PLATFORM_ESCROW' });
      expect(second.status).toBe(422);
      expect(second.body.code).toBe('claim_total_exceeded');
      expect((await decide(desk.token, b.id, { decision: 'APPROVE', approvedAmountUsd: '15', liableParty: 'PLATFORM_ESCROW' })).status).toBe(200); // the remaining 15 fits
    });

    it('rejection needs a reason and ends the claim', async () => {
      const p = await parcel();
      const desk = await cs(ctx);
      const c = (await fileClaim(net.bcu.token, p.waybill)).body;
      expect((await decide(desk.token, c.id, { decision: 'REJECT' })).status).toBe(422);
      const rej = await decide(desk.token, c.id, { decision: 'REJECT', reason: 'Packaging inadequate — excluded by T&C' });
      expect(rej.body).toMatchObject({ status: 'REJECTED', rejectionReason: 'Packaging inadequate — excluded by T&C' });
      expect((await decide(desk.token, c.id, { decision: 'APPROVE', approvedAmountUsd: '5', liableParty: 'PLATFORM_ESCROW' })).status).toBe(409);
      expect((await pay((await finance(ctx)).token, c.id)).status).toBe(409);
    });

    it('above the CS limit Finance must co-approve — and it must be a DIFFERENT person than the reviewer', async () => {
      const p = await parcel(insuredOpts); // cap $300
      const desk = await cs(ctx);
      const fin = await finance(ctx);
      const c = (await fileClaim(net.bcu.token, p.waybill, { requestedAmountUsd: '100' })).body;
      const proposed = await decide(desk.token, c.id, { decision: 'APPROVE', approvedAmountUsd: '100', liableParty: 'PLATFORM_ESCROW' });
      expect(proposed.body).toMatchObject({ status: 'INVESTIGATING', approved: '100.0000', needsFinanceApproval: true });
      expect((await pay(fin.token, c.id)).status).toBe(409); // cannot be paid before co-approval
      expect((await ctx.http.post(`/v1/claims/${c.id}/finance-approve`).set(bearer(desk.token))).status).toBe(403); // CS cannot co-approve

      const both = await multiRole(ctx, ['CS_CLAIMS_ADMIN', 'FINANCE_ADMIN']);
      const c2 = (await fileClaim(net.bcu.token, p.waybill, { requestedAmountUsd: '100' })).body;
      await decide(both.token, c2.id, { decision: 'APPROVE', approvedAmountUsd: '100', liableParty: 'PLATFORM_ESCROW' });
      const self = await ctx.http.post(`/v1/claims/${c2.id}/finance-approve`).set(bearer(both.token));
      expect(self.status).toBe(403);
      expect(self.body.code).toBe('self_approval_forbidden');

      const ok = await ctx.http.post(`/v1/claims/${c.id}/finance-approve`).set(bearer(fin.token));
      expect(ok.body).toMatchObject({ status: 'APPROVED', needsFinanceApproval: false, financeApprovedBy: 'Test User' });
      expect((await ctx.http.post(`/v1/claims/${c.id}/finance-approve`).set(bearer(fin.token))).status).toBe(409); // not twice
    });

    it('the CS limit is a setting', async () => {
      const { SettingsService } = await import('../src/common/settings.service');
      const original = await ctx.prisma.systemSetting.findUniqueOrThrow({ where: { key: 'claim_cs_approval_limit_usd' } });
      try {
        await ctx.prisma.systemSetting.update({ where: { key: 'claim_cs_approval_limit_usd' }, data: { value: '5.00' } });
        ctx.app.get(SettingsService).invalidate();
        const p = await parcel();
        const c = (await fileClaim(net.bcu.token, p.waybill, { requestedAmountUsd: '8' })).body;
        const r = await decide((await cs(ctx)).token, c.id, { decision: 'APPROVE', approvedAmountUsd: '8', liableParty: 'PLATFORM_ESCROW' });
        expect(r.body.needsFinanceApproval).toBe(true);
      } finally {
        await ctx.prisma.systemSetting.update({ where: { key: 'claim_cs_approval_limit_usd' }, data: { value: original.value as string } });
        ctx.app.get(SettingsService).invalidate();
      }
    });
  });

  /* -------------------------------------------- payout -------------------------------------------- */
  describe('one-click payout from the claim escrow reserve', () => {
    async function approvedClaim(opts: { amount: string; liable: string; parcelOpts?: Parameters<typeof arrivedParcels>[3]; network?: Network }) {
      const n = opts.network ?? net;
      const p = await parcel(opts.parcelOpts ?? {}, n);
      const c = (await fileClaim(n.bcu.token, p.waybill, { requestedAmountUsd: opts.amount })).body;
      const desk = await cs(ctx);
      const d = await decide(desk.token, c.id, { decision: 'APPROVE', approvedAmountUsd: opts.amount, liableParty: opts.liable });
      expect(['APPROVED', 'INVESTIGATING']).toContain(d.body.status); // above the CS limit it waits for Finance
      return { claim: d.body, parcel: p, network: n };
    }

    it('debits the escrow, credits EXTERNAL_CLEARING, stores the reference — and pays only once', async () => {
      const { claim } = await approvedClaim({ amount: '20', liable: 'PLATFORM_ESCROW' });
      const fin = await finance(ctx);
      const escrowBefore = num(await walletBalance(ctx, sysWallet('CLAIM_ESCROW_RESERVE')));
      const clearingBefore = num(await walletBalance(ctx, sysWallet('EXTERNAL_CLEARING')));

      const paid = await pay(fin.token, claim.id, 'CASH-REC-77');
      expect(paid.status).toBe(200);
      expect(paid.body.status).toBe('PAID');
      expect(paid.body.paid).toMatchObject({ reference: 'CASH-REC-77', fromEscrow: '20.0000', fromInsurancePool: '0.0000' });
      expect(escrowBefore - num(await walletBalance(ctx, sysWallet('CLAIM_ESCROW_RESERVE')))).toBeCloseTo(20, 4);
      expect(num(await walletBalance(ctx, sysWallet('EXTERNAL_CLEARING'))) - clearingBefore).toBeCloseTo(20, 4);
      expect(paid.body.recovery).toBeNull(); // the platform absorbs it

      expect((await pay(fin.token, claim.id)).status).toBe(409);
      expect(num(await walletBalance(ctx, sysWallet('CLAIM_ESCROW_RESERVE')))).toBeCloseTo(escrowBefore - 20, 4);
      expect((await ledger.reconcile()).ok).toBe(true);
    });

    it('only Finance can pay (CS cannot), and a bad reference is rejected', async () => {
      const { claim } = await approvedClaim({ amount: '5', liable: 'PLATFORM_ESCROW' });
      expect((await pay((await cs(ctx)).token, claim.id)).status).toBe(403);
      expect((await ctx.http.post(`/v1/claims/${claim.id}/pay`).set(bearer((await finance(ctx)).token)).send({ reference: 'x' })).status).toBe(422);
    });

    it('refuses to overdraw the reserve (and leaves the claim APPROVED)', async () => {
      const { claim } = await approvedClaim({ amount: '20', liable: 'PLATFORM_ESCROW' });
      const escrow = await ledger.balanceOf(sysWallet('CLAIM_ESCROW_RESERVE'));
      const parked = escrow.balance.toFixed(4);
      await drain(sysWallet('CLAIM_ESCROW_RESERVE'), parked);
      try {
        const r = await pay((await finance(ctx)).token, claim.id);
        expect(r.status).toBe(422);
        expect(r.body.code).toBe('escrow_insufficient');
        expect((await ctx.http.get(`/v1/claims/${claim.id}`).set(bearer((await finance(ctx)).token))).body.status).toBe('APPROVED');
      } finally {
        await ledger.post({ referenceType: 'ADJUSTMENT', idempotencyKey: `restore:${randomUUID()}`, lines: [{ wallet: sysWallet('PLATFORM_REVENUE'), type: 'DEBIT', amount: parked }, { wallet: sysWallet('CLAIM_ESCROW_RESERVE'), type: 'CREDIT', amount: parked }] });
      }
      expect((await pay((await finance(ctx)).token, claim.id)).status).toBe(200);
    });

    it('insured claims are paid from the insurance pool first, the escrow covers any shortfall', async () => {
      const { claim } = await approvedClaim({ amount: '100', liable: 'PLATFORM_ESCROW', parcelOpts: insuredOpts });
      // 100 > CS limit → Finance co-approval first
      await ctx.http.post(`/v1/claims/${claim.id}/finance-approve`).set(bearer((await finance(ctx)).token));
      const poolBefore = num(await walletBalance(ctx, sysWallet('INSURANCE_POOL')));
      const escrowBefore = num(await walletBalance(ctx, sysWallet('CLAIM_ESCROW_RESERVE')));
      const paid = await pay((await finance(ctx)).token, claim.id);
      expect(paid.status).toBe(200);
      const fromPool = num(paid.body.paid.fromInsurancePool);
      const fromEscrow = num(paid.body.paid.fromEscrow);
      expect(fromPool).toBeCloseTo(Math.min(100, poolBefore), 4);
      expect(fromPool + fromEscrow).toBeCloseTo(100, 4);
      expect(poolBefore - num(await walletBalance(ctx, sysWallet('INSURANCE_POOL')))).toBeCloseTo(fromPool, 4);
      expect(escrowBefore - num(await walletBalance(ctx, sysWallet('CLAIM_ESCROW_RESERVE')))).toBeCloseTo(fromEscrow, 4);
    });
  });

  /* -------------------------------------------- recovery -------------------------------------------- */
  describe('charging the liable party back', () => {
    it('a liable kiosk is charged from its deposit and the money returns to the reserve', async () => {
      const n = await createNetwork(ctx); // bcu deposit = 50
      const p = await parcel({}, n);
      const c = (await fileClaim(n.bcu.token, p.waybill, { requestedAmountUsd: '20' })).body;
      await decide((await cs(ctx)).token, c.id, { decision: 'APPROVE', approvedAmountUsd: '20', liableParty: 'DEST_AGENT' });
      const depositBefore = num(await walletBalance(ctx, n.bcu.wallet));
      const escrowBefore = num(await walletBalance(ctx, sysWallet('CLAIM_ESCROW_RESERVE')));

      const paid = await pay((await finance(ctx)).token, c.id);
      expect(paid.body.recovery).toMatchObject({ recovered: '20.0000', outstanding: '0.0000' });
      expect(depositBefore - num(await walletBalance(ctx, n.bcu.wallet))).toBeCloseTo(20, 4);
      expect(num(await walletBalance(ctx, sysWallet('CLAIM_ESCROW_RESERVE'))) - escrowBefore).toBeCloseTo(0, 4); // paid out 20, got 20 back
      expect((await ledger.reconcile()).ok).toBe(true);
    });

    it('when the kiosk cannot cover it all, the rest stays outstanding and can be retried after a top-up', async () => {
      const n = await createNetwork(ctx);
      const p = await parcel({}, n);
      const c = (await fileClaim(n.bcu.token, p.waybill, { requestedAmountUsd: '20' })).body;
      await decide((await cs(ctx)).token, c.id, { decision: 'APPROVE', approvedAmountUsd: '20', liableParty: 'DEST_AGENT' });
      const bal = await ledger.balanceOf(n.bcu.wallet);
      await drain(n.bcu.wallet, bal.balance.minus(8).toFixed(4)); // leave $8
      const fin = await finance(ctx);

      const paid = await pay(fin.token, c.id);
      expect(paid.body.recovery).toMatchObject({ recovered: '8.0000', outstanding: '12.0000' });
      expect(await walletBalance(ctx, n.bcu.wallet)).toBe('0.0000'); // never negative

      expect((await ctx.http.post(`/v1/claims/${c.id}/recover`).set(bearer(fin.token))).body.recovery.outstanding).toBe('12.0000'); // nothing available yet
      await fund(ctx, n.bcu.wallet, '30.0000');
      const retry = await ctx.http.post(`/v1/claims/${c.id}/recover`).set(bearer(fin.token));
      expect(retry.body.recovery).toMatchObject({ recovered: '20.0000', outstanding: '0.0000' });
      expect(await walletBalance(ctx, n.bcu.wallet)).toBe('18.0000');
      expect((await ctx.http.post(`/v1/claims/${c.id}/recover`).set(bearer(fin.token))).body.recovery.recovered).toBe('20.0000'); // idempotent
      expect((await ledger.reconcile()).ok).toBe(true);
    });
  });

  /* --------------------------------------------- evidence --------------------------------------------- */
  describe('evidence desk', () => {
    it('CS sees open-box → sealed → baggage → incident photos, claim evidence and the timeline as signed URLs', async () => {
      const n = await createNetwork(ctx);
      const p = await parcel({}, n);
      const photo = await stagePhoto(ctx, n.bcu.token, 'CLAIM_EVIDENCE');
      const c = (await fileClaim(n.bcu.token, p.waybill, { evidenceUploadIds: [photo] })).body;
      const desk = await cs(ctx);
      const ev = await ctx.http.get(`/v1/claims/${c.id}/evidence`).set(bearer(desk.token));
      expect(ev.status).toBe(200);
      expect(ev.body.shipmentPhotos.map((x: { type: string }) => x.type)).toEqual(['OPEN_BOX_CONTENT', 'SEALED_PARCEL', 'BAGGAGE_PLACEMENT']);
      for (const x of ev.body.shipmentPhotos) {
        expect(x.url).toContain('signed.test');
        expect(x.expiresIn).toBe(300);
        expect(x.sha256).toMatch(/^[0-9a-f]{64}$/);
      }
      expect(ev.body.claimEvidence).toHaveLength(1);
      expect(ev.body.timeline.map((t: { status: string }) => t.status)).toContain('IN_TRANSIT');
    });

    it('Finance and the filing kiosk cannot open evidence (needs evidence:read)', async () => {
      const p = await parcel();
      const c = (await fileClaim(net.bcu.token, p.waybill)).body;
      expect((await ctx.http.get(`/v1/claims/${c.id}/evidence`).set(bearer((await finance(ctx)).token))).status).toBe(403);
      expect((await ctx.http.get(`/v1/claims/${c.id}/evidence`).set(bearer(net.bcu.token))).status).toBe(403);
    });

    it('a filer sees only their own claims; CS and Finance see all', async () => {
      const p = await parcel();
      const c = (await fileClaim(net.bcu.token, p.waybill)).body;
      const other = await createNetwork(ctx);
      expect((await ctx.http.get(`/v1/claims/${c.id}`).set(bearer(other.bcu.token))).status).toBe(404);
      expect((await ctx.http.get(`/v1/claims/${c.id}`).set(bearer((await finance(ctx)).token))).status).toBe(200);
      const list = await ctx.http.get('/v1/claims?status=OPEN').set(bearer((await cs(ctx)).token));
      expect(list.body.map((x: { id: string }) => x.id)).toContain(c.id);
      expect((await ctx.http.get('/v1/claims?mine=true').set(bearer(other.bcu.token))).body).toEqual([]);
    });
  });

  it('claims CSV export is formula-injection safe', async () => {
    const p = await parcel();
    await fileClaim(net.bcu.token, p.waybill, { description: '=HYPERLINK("http://evil","x")' });
    const fin = await finance(ctx);
    const day = new Date().toISOString().slice(0, 10);
    const csv = await ctx.http.get(`/v1/reports/claims.csv?from=${day}&to=${day}`).set(bearer(fin.token));
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.headers['content-disposition']).toContain('claims.csv');
    expect(csv.text).toContain('Claim,Filed (Dili),Waybill');
    expect((await ctx.http.get(`/v1/reports/claims.csv?from=${day}&to=${day}`).set(bearer((await cs(ctx)).token))).status).toBe(403); // reports:export is Finance's
  });
});
