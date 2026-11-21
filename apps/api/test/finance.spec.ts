import { randomUUID } from 'node:crypto';
import { LedgerService } from '../src/ledger/ledger.service';
import { bearer, createTestApp, type TestCtx } from './helpers';
import { agentIntake, createAgent, createCourier, createNetwork, fund, messagesTo, stagePhoto, sysWallet, walletBalance, type Network } from './scenario';
import { arrivedParcels, cs, finance, multiRole, ops } from './admin-helpers';


describe('Finance centre: deposits (maker-checker), wallets, ledger, reconciliation, refunds', () => {
  let ctx: TestCtx;
  let net: Network;
  beforeAll(async () => {
    ctx = await createTestApp();
    net = await createNetwork(ctx);
  });
  afterAll(() => ctx.close());

  const ref = () => `TRF-${randomUUID().slice(0, 8)}`;
  const req = async (token: string, body: Partial<{ amountUsd: string; channel: string; referenceNo: string; proofUploadId: string; note: string }> = {}, key: string = randomUUID()) =>
    ctx.http.post('/v1/deposits/requests').set(bearer(token)).set('Idempotency-Key', key).send({ amountUsd: '50.00', channel: 'BNCTL', referenceNo: ref(), ...body });
  const withProof = async (token: string) => ({ proofUploadId: await stagePhoto(ctx, token, 'DEPOSIT_PROOF') });

  /* ----------------------------------------- requesting ----------------------------------------- */
  describe('deposit request', () => {
    it('an agent files a top-up with a proof photo; it waits PENDING and moves no money yet', async () => {
      const a = await createAgent(ctx, 'DIL', '0');
      const before = await walletBalance(ctx, a.wallet);
      const r = await req(a.token, await withProof(a.token));
      expect(r.status).toBe(201);
      expect(r.body).toMatchObject({ status: 'PENDING', amount: '50.0000', channel: 'BNCTL', hasProof: true, owner: { type: 'AGENT', id: a.agentId } });
      expect(await walletBalance(ctx, a.wallet)).toBe(before);
    });

    it('couriers can top up too', async () => {
      const c = await createCourier(ctx, 'DIL', 'HUB_BECORA', '0');
      const r = await req(c.token, { channel: 'CASH' });
      expect(r.status).toBe(201);
      expect(r.body.owner.type).toBe('COURIER');
    });

    it('bank / MOSAN / T-Pay need a slip photo; cash needs only a reference; a retried request is not duplicated', async () => {
      const a = await createAgent(ctx, 'DIL', '0');
      const noProof = await req(a.token, { channel: 'MOSAN' });
      expect(noProof.status).toBe(422);
      expect(noProof.body.code).toBe('deposit_proof_required');
      expect((await req(a.token, { channel: 'CASH', referenceNo: 'R1' })).status).toBe(422); // reference too short
      const cash = await req(a.token, { channel: 'CASH' }, 'cash-key-0001');
      expect(cash.status).toBe(201);
      const replay = await req(a.token, { channel: 'CASH', referenceNo: cash.body.referenceNo, amountUsd: '50.00' }, 'cash-key-0001');
      expect(replay.body.id).toBe(cash.body.id);
      expect(replay.headers['idempotent-replayed']).toBe('true');
    });

    it('rejects absurd amounts and photos that are not the caller’s own DEPOSIT_PROOF', async () => {
      const a = await createAgent(ctx, 'DIL', '0');
      const b = await createAgent(ctx, 'DIL', '0');
      for (const amountUsd of ['0', '-5', '10000.01', '1.00001']) expect((await req(a.token, { amountUsd, channel: 'CASH' })).status).toBe(422);
      const foreign = await stagePhoto(ctx, b.token, 'DEPOSIT_PROOF');
      expect((await req(a.token, { proofUploadId: foreign })).body.code).toBe('upload_not_found');
      const wrongType = await stagePhoto(ctx, a.token, 'OPEN_BOX_CONTENT');
      expect((await req(a.token, { proofUploadId: wrongType })).body.code).toBe('upload_not_found');
    });

    it('the same bank reference cannot fund two deposits (a rejected one frees it)', async () => {
      const a = await createAgent(ctx, 'DIL', '0');
      const reference = ref();
      const first = await req(a.token, { referenceNo: reference, ...(await withProof(a.token)) });
      expect(first.status).toBe(201);
      const dup = await req(a.token, { referenceNo: reference.toLowerCase(), ...(await withProof(a.token)) });
      expect(dup.status).toBe(409);
      expect(dup.body.code).toBe('duplicate_reference');
      // another channel is a different payment
      expect((await req(a.token, { referenceNo: reference, channel: 'BNU', ...(await withProof(a.token)) })).status).toBe(201);
      const fin = await finance(ctx);
      await ctx.http.post(`/v1/finance/deposits/${first.body.id}/reject`).set(bearer(fin.token)).send({ reason: 'Slip unreadable' });
      expect((await req(a.token, { referenceNo: reference, ...(await withProof(a.token)) })).status).toBe(201);
    });

    it('only agents and couriers can request', async () => {
      const f = await finance(ctx);
      expect((await req(f.token, { channel: 'CASH' })).status).toBe(403);
      expect((await req(net.fleet.driver.token, { channel: 'CASH' })).status).toBe(403);
    });
  });

  /* ------------------------------------------ approving ------------------------------------------ */
  describe('approval (Finance only, never the requester)', () => {
    it('approval credits the deposit through the ledger exactly once', async () => {
      const a = await createAgent(ctx, 'DIL', '0');
      const fin = await finance(ctx);
      const r = await req(a.token, { amountUsd: '75.50', ...(await withProof(a.token)) });
      const clearingBefore = Number(await walletBalance(ctx, sysWallet('EXTERNAL_CLEARING')));

      const ok = await ctx.http.post(`/v1/finance/deposits/${r.body.id}/approve`).set(bearer(fin.token));
      expect(ok.status).toBe(200);
      expect(ok.body).toMatchObject({ status: 'APPROVED', reviewedBy: 'Test User' });
      expect(await walletBalance(ctx, a.wallet)).toBe('75.5000');
      expect(clearingBefore - Number(await walletBalance(ctx, sysWallet('EXTERNAL_CLEARING')))).toBeCloseTo(75.5, 4);
      const row = await ctx.prisma.depositRequest.findUniqueOrThrow({ where: { id: r.body.id } });
      expect(row.ledgerTxnId).not.toBeNull();

      // approving again (or rejecting an approved one) is refused and moves nothing
      expect((await ctx.http.post(`/v1/finance/deposits/${r.body.id}/approve`).set(bearer(fin.token))).status).toBe(409);
      expect((await ctx.http.post(`/v1/finance/deposits/${r.body.id}/reject`).set(bearer(fin.token)).send({ reason: 'too late' })).status).toBe(409);
      expect(await walletBalance(ctx, a.wallet)).toBe('75.5000');
    });

    it('4 finance clerks clicking Approve at the same instant credit the wallet once', async () => {
      const a = await createAgent(ctx, 'DIL', '0');
      const clerks = await Promise.all([finance(ctx), finance(ctx), finance(ctx), finance(ctx)]);
      const r = await req(a.token, { amountUsd: '20', ...(await withProof(a.token)) });
      const results = await Promise.all(clerks.map((c) => ctx.http.post(`/v1/finance/deposits/${r.body.id}/approve`).set(bearer(c.token))));
      expect(results.filter((x) => x.status === 200)).toHaveLength(1);
      expect(results.filter((x) => x.status === 409)).toHaveLength(3);
      expect(await walletBalance(ctx, a.wallet)).toBe('20.0000');
    });

    it('maker-checker is about people: someone holding both roles cannot approve their own request', async () => {
      const both = await multiRole(ctx, ['AGENT', 'FINANCE_ADMIN']);
      const dil = await ctx.prisma.municipality.findUniqueOrThrow({ where: { code: 'DIL' } });
      await ctx.prisma.agent.create({ data: { userId: both.user.id, municipalityId: dil.id, agentCode: `AG-S-${randomUUID().slice(0, 6)}`, kioskName: 'Both', address: 'x', status: 'ACTIVE' } });
      const { ActorService } = await import('../src/rbac/actor.service');
      ctx.app.get(ActorService).invalidate(both.user.id);
      const mine = await req(both.token, { channel: 'CASH' });
      expect(mine.status).toBe(201);
      const self = await ctx.http.post(`/v1/finance/deposits/${mine.body.id}/approve`).set(bearer(both.token));
      expect(self.status).toBe(403);
      expect(self.body.code).toBe('self_approval_forbidden');
      expect((await ctx.http.post(`/v1/finance/deposits/${mine.body.id}/reject`).set(bearer(both.token)).send({ reason: 'sneaky' })).body.code).toBe('self_approval_forbidden');
      expect((await ctx.http.post(`/v1/finance/deposits/${mine.body.id}/approve`).set(bearer((await finance(ctx)).token))).status).toBe(200);
    });

    it('Ops, CS and the requester role cannot approve (segregation of duties)', async () => {
      const a = await createAgent(ctx, 'DIL', '0');
      const r = await req(a.token, { channel: 'CASH' });
      for (const who of [await ops(ctx), await cs(ctx)]) {
        expect((await ctx.http.post(`/v1/finance/deposits/${r.body.id}/approve`).set(bearer(who.token))).status).toBe(403);
      }
      expect((await ctx.http.post(`/v1/finance/deposits/${r.body.id}/approve`).set(bearer(a.token))).status).toBe(403);
      expect(await walletBalance(ctx, a.wallet)).toBe('0.0000');
    });

    it('rejection records the reason and never touches the wallet', async () => {
      const a = await createAgent(ctx, 'DIL', '0');
      const fin = await finance(ctx);
      const r = await req(a.token, { channel: 'CASH' });
      expect((await ctx.http.post(`/v1/finance/deposits/${r.body.id}/reject`).set(bearer(fin.token)).send({})).status).toBe(422); // reason mandatory
      const rej = await ctx.http.post(`/v1/finance/deposits/${r.body.id}/reject`).set(bearer(fin.token)).send({ reason: 'Receipt number does not exist' });
      expect(rej.body).toMatchObject({ status: 'REJECTED', rejectReason: 'Receipt number does not exist' });
      expect(await walletBalance(ctx, a.wallet)).toBe('0.0000');
      expect((await ctx.http.post(`/v1/finance/deposits/${r.body.id}/approve`).set(bearer(fin.token))).status).toBe(409);
    });
  });

  describe('visibility', () => {
    it('requesters see only their own; Finance sees all with filters; only Finance can open the slip', async () => {
      const a = await createAgent(ctx, 'DIL', '0');
      const b = await createAgent(ctx, 'DIL', '0');
      const fin = await finance(ctx);
      const ra = await req(a.token, { channel: 'CASH' });
      await req(b.token, { channel: 'CASH' });
      const mine = await ctx.http.get('/v1/deposits/requests').set(bearer(a.token));
      expect(mine.body.map((x: { id: string }) => x.id)).toEqual([ra.body.id]);
      const all = await ctx.http.get('/v1/deposits/requests?status=PENDING&ownerType=AGENT').set(bearer(fin.token));
      expect(all.body.length).toBeGreaterThanOrEqual(2);
      expect(all.body.every((x: { status: string; owner: { type: string } }) => x.status === 'PENDING' && x.owner.type === 'AGENT')).toBe(true);

      const slip = await withProof(a.token);
      const withSlip = await req(a.token, slip);
      const url = await ctx.http.get(`/v1/finance/deposits/${withSlip.body.id}/proof`).set(bearer(fin.token));
      expect(url.status).toBe(200);
      expect(url.body.url).toContain('signed.test');
      expect((await ctx.http.get(`/v1/finance/deposits/${withSlip.body.id}/proof`).set(bearer(a.token))).status).toBe(403);
      expect((await ctx.http.get(`/v1/finance/deposits/${ra.body.id}/proof`).set(bearer(fin.token))).status).toBe(404); // no slip (cash)
    });
  });

  /* ------------------------------------------- wallets ------------------------------------------- */
  describe('wallets and statements', () => {
    it('/wallets/me shows the caller’s own wallets only', async () => {
      const a = await createAgent(ctx, 'DIL', '12.5');
      const me = await ctx.http.get('/v1/wallets/me').set(bearer(a.token));
      expect(me.status).toBe(200);
      expect(me.body.map((w: { type: string; balance: string }) => `${w.type}=${w.balance}`)).toContain('DEPOSIT=12.5000');
      expect(me.body.every((w: { ownerId: string }) => w.ownerId === a.agentId)).toBe(true);
      expect((await ctx.http.get('/v1/wallets/me').set(bearer(net.fleet.driver.token))).status).toBe(403);
      const owner = await ctx.http.post('/v1/auth/login').send({ email: net.fleet.owner.email, password: net.fleet.owner.password });
      const fw = await ctx.http.get('/v1/wallets/me').set(bearer(owner.body.accessToken));
      expect(fw.body.map((w: { type: string }) => w.type)).toEqual(['FLEET_PAYABLE']);
    });

    it('a statement is visible to the owner and to Finance — strangers get 404', async () => {
      const a = await createAgent(ctx, 'DIL', '30');
      const b = await createAgent(ctx, 'DIL', '0');
      const fin = await finance(ctx);
      const wallet = (await ctx.http.get('/v1/wallets/me').set(bearer(a.token))).body.find((w: { type: string }) => w.type === 'DEPOSIT');
      const mine = await ctx.http.get(`/v1/wallets/${wallet.id}/statement`).set(bearer(a.token));
      expect(mine.status).toBe(200);
      expect(mine.body.entries[0]).toMatchObject({ type: 'CREDIT', amount: '30.0000', balanceAfter: '30.0000', reference: 'DEPOSIT_TOPUP' });
      expect((await ctx.http.get(`/v1/wallets/${wallet.id}/statement`).set(bearer(fin.token))).status).toBe(200);
      expect((await ctx.http.get(`/v1/wallets/${wallet.id}/statement`).set(bearer(b.token))).status).toBe(404);
    });

    it('Finance lists wallets (with owner names) and filters the ledger', async () => {
      const fin = await finance(ctx);
      const a = await createAgent(ctx, 'DIL', '5');
      // Filter by owner: the shared test database holds hundreds of agent wallets by now, far more than one page.
      const wallets = await ctx.http.get(`/v1/finance/wallets?ownerType=AGENT&walletType=DEPOSIT&ownerId=${a.agentId}`).set(bearer(fin.token));
      expect(wallets.body).toHaveLength(1);
      expect(wallets.body[0]).toMatchObject({ balance: '5.0000', owner: expect.stringContaining('Kios DIL') });
      expect((await ctx.http.get('/v1/finance/wallets?ownerId=not-a-uuid').set(bearer(fin.token))).status).toBe(422);
      const sys = await ctx.http.get('/v1/finance/wallets?ownerType=SYSTEM').set(bearer(fin.token));
      expect(sys.body.map((w: { type: string }) => w.type)).toEqual(expect.arrayContaining(['PLATFORM_REVENUE', 'PENDING_SETTLEMENT', 'CLAIM_ESCROW_RESERVE']));
      const walletId = wallets.body.find((w: { ownerId: string }) => w.ownerId === a.agentId).id;
      const led = await ctx.http.get(`/v1/finance/ledger?walletId=${walletId}&referenceType=DEPOSIT_TOPUP`).set(bearer(fin.token));
      expect(led.body).toHaveLength(1);
      expect(led.body[0]).toMatchObject({ amount: '5.0000', type: 'CREDIT', wallet: 'AGENT/DEPOSIT' });
      expect((await ctx.http.get('/v1/finance/ledger').set(bearer((await ops(ctx)).token))).status).toBe(403);
    });
  });

  /* --------------------------------------- reconciliation --------------------------------------- */
  describe('reconciliation', () => {
    it('is clean after real flows — and the settlement invariant (pending pool = unreleased shares) holds', async () => {
      const n = await createNetwork(ctx);
      const { parcels } = await arrivedParcels(ctx, n, 2); // fleet released, destination still pending
      void parcels;
      const fin = await finance(ctx);
      const res = await ctx.http.get('/v1/finance/reconciliation').set(bearer(fin.token));
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.ledger).toMatchObject({ ok: true, globalNet: '0.0000', mismatchedWallets: [], unbalancedTransactions: [] });
      expect(res.body.pendingSettlement.ok).toBe(true);
      expect(res.body.pendingSettlement.wallet).toBe(res.body.pendingSettlement.expectedFromSettlements);
      expect(Number(res.body.pendingSettlement.wallet)).toBeGreaterThan(0);
      expect((await ctx.http.get('/v1/finance/reconciliation').set(bearer((await cs(ctx)).token))).status).toBe(403);
    });

    it('DETECTS a broken invariant (a settlement edited behind the ledger’s back)', async () => {
      const n = await createNetwork(ctx);
      const { parcels } = await arrivedParcels(ctx, n, 1);
      const fin = await finance(ctx);
      const st = await ctx.prisma.shipmentSettlement.findUniqueOrThrow({ where: { shipmentId: parcels[0]!.id } });
      await ctx.prisma.shipmentSettlement.update({ where: { id: st.id }, data: { releasedAt: new Date() } }); // "released" on paper, never in the ledger
      try {
        const bad = await ctx.http.get('/v1/finance/reconciliation').set(bearer(fin.token));
        expect(bad.body.ok).toBe(false);
        expect(bad.body.pendingSettlement.ok).toBe(false);
        expect(bad.body.ledger.ok).toBe(true); // the ledger itself is intact — the mismatch is between books and settlements
      } finally {
        await ctx.prisma.shipmentSettlement.update({ where: { id: st.id }, data: { releasedAt: null } });
      }
      expect((await ctx.http.get('/v1/finance/reconciliation').set(bearer(fin.token))).body.ok).toBe(true);
    });

    it('lists agents running low on deposit', async () => {
      const low = await createAgent(ctx, 'DIL', '3');
      const res = await ctx.http.get('/v1/finance/reconciliation').set(bearer((await finance(ctx)).token));
      expect(res.body.lowFloatAgents.map((x: { agentId: string }) => x.agentId)).toContain(low.agentId);
    });
  });

  /* ---------------------------------------- refund of add-on ---------------------------------------- */
  describe('refund of an unused door-delivery add-on', () => {
    async function deliveredAtKioskInsteadOfDoor() {
      const n = await createNetwork(ctx);
      const p = await agentIntake(ctx, n.dili, { scheme: 'SCHEME_C', destAgentId: n.bcu.agentId, recipientAddress: 'Rua Central 12, Baucau' });
      const { bagAndManifest, driverHandover, inboundScan } = await import('./scenario');
      const { bagCode, manifestCode } = await bagAndManifest(ctx, n, [p.waybill]);
      await driverHandover(ctx, n, manifestCode);
      await inboundScan(ctx, n.bcu.token, { code: bagCode, condition: 'INTACT' });
      const courier = await createCourier(ctx, 'BCU', 'HUB_BECORA', '0');
      await ctx.http.post(`/v1/shipments/${p.waybill}/out-for-delivery`).set(bearer(courier.token));
      await ctx.http.post(`/v1/shipments/${p.waybill}/delivery-failed`).set(bearer(courier.token)).send({});
      await ctx.http.post(`/v1/shipments/${p.waybill}/delivery-failed`).set(bearer(courier.token)).send({});
      const shipment = await ctx.prisma.shipment.findUniqueOrThrow({ where: { waybillNumber: p.waybill } });
      const { deliverAtKiosk } = await import('./admin-helpers');
      expect((await deliverAtKiosk(ctx, n, { waybill: p.waybill, recipientPhone: shipment.recipientPhone })).status).toBe(200);
      return { n, waybill: p.waybill };
    }

    it('Finance refunds exactly the add-on that was paid, once, out of platform revenue', async () => {
      const { waybill } = await deliveredAtKioskInsteadOfDoor();
      const fin = await finance(ctx);
      const revenueBefore = Number(await walletBalance(ctx, sysWallet('PLATFORM_REVENUE')));
      const clearingBefore = Number(await walletBalance(ctx, sysWallet('EXTERNAL_CLEARING')));
      const key = randomUUID();
      const body = { waybill, reason: 'Recipient collected at the kiosk', reference: 'CASH-R-001' };
      const r = await ctx.http.post('/v1/finance/refunds').set(bearer(fin.token)).set('Idempotency-Key', key).send(body);
      expect(r.status).toBe(200);
      expect(r.body.refunded.usd).toBe('1.5000');
      expect(revenueBefore - Number(await walletBalance(ctx, sysWallet('PLATFORM_REVENUE')))).toBeCloseTo(1.5, 4);
      expect(Number(await walletBalance(ctx, sysWallet('EXTERNAL_CLEARING'))) - clearingBefore).toBeCloseTo(1.5, 4);

      expect((await ctx.http.post('/v1/finance/refunds').set(bearer(fin.token)).set('Idempotency-Key', key).send(body)).headers['idempotent-replayed']).toBe('true');
      const again = await ctx.http.post('/v1/finance/refunds').set(bearer(fin.token)).set('Idempotency-Key', randomUUID()).send(body);
      expect(again.status).toBe(422);
      expect(again.body.code).toBe('refund_not_applicable');
      expect((await ctx.app.get(LedgerService).reconcile()).ok).toBe(true);
    });

    it('is refused for parcels without an unused add-on and for non-Finance users', async () => {
      const n = await createNetwork(ctx);
      const { parcels } = await arrivedParcels(ctx, n, 1);
      const { deliverAtKiosk } = await import('./admin-helpers');
      await deliverAtKiosk(ctx, n, parcels[0]!);
      const fin = await finance(ctx);
      const r = await ctx.http.post('/v1/finance/refunds').set(bearer(fin.token)).set('Idempotency-Key', randomUUID()).send({ waybill: parcels[0]!.waybill, reason: 'just because' });
      expect(r.body.code).toBe('refund_not_applicable'); // Scheme A: no delivery add-on was ever sold
      expect((await ctx.http.post('/v1/finance/refunds').set(bearer((await cs(ctx)).token)).set('Idempotency-Key', randomUUID()).send({ waybill: parcels[0]!.waybill, reason: 'x y z w' })).status).toBe(403);
    });
  });

  it('sanity: WhatsApp was not used for finance events and the helper works', async () => {
    expect(messagesTo(ctx, '+670000').length).toBe(0);
    await fund(ctx, sysWallet('CLAIM_ESCROW_RESERVE'), '1.0000');
  });
});
