import { randomUUID } from 'node:crypto';
import { WAYBILL_REGEX } from '@670send/validation';
import { LedgerService } from '../src/ledger/ledger.service';
import { bearer, createTestApp, uniquePhone as uniquePhoneFor, type TestCtx } from './helpers';
import {
  agentIntake,
  createAgent,
  createCourier,
  createStaff,
  intakeBody,
  intakePhotos,
  messagesTo,
  postIntake,
  stagePhoto,
  sysWallet,
  walletBalance,
  type AgentCtx,
} from './scenario';

describe('Shipment intake (KYC + gates + price + canal + ledger, one transaction)', () => {
  let ctx: TestCtx;
  let dili: AgentCtx;
  let bcu: AgentCtx;
  let ledger: LedgerService;

  beforeAll(async () => {
    ctx = await createTestApp();
    ledger = ctx.app.get(LedgerService);
    dili = await createAgent(ctx, 'DIL', '500.0000');
    bcu = await createAgent(ctx, 'BCU', '10.0000');
  });
  afterAll(() => ctx.close());

  const sys = async () => ({
    pending: await walletBalance(ctx, sysWallet('PENDING_SETTLEMENT')),
    revenue: await walletBalance(ctx, sysWallet('PLATFORM_REVENUE')),
    escrow: await walletBalance(ctx, sysWallet('CLAIM_ESCROW_RESERVE')),
    insurance: await walletBalance(ctx, sysWallet('INSURANCE_POOL')),
    hubOps: await walletBalance(ctx, sysWallet('PLATFORM_HUB_OPS')),
    clearing: await walletBalance(ctx, sysWallet('EXTERNAL_CLEARING')),
  });
  const delta = (a: string, b: string) => (Number(b) - Number(a)).toFixed(4);

  /* ------------------------------------ the SOP worked example ------------------------------------ */
  it('Scheme A, 2 kg Díli → Baucau = $4.00 and the money lands exactly as the SOP says', async () => {
    const before = await sys();
    const agentBefore = await walletBalance(ctx, dili.wallet);
    const senderPhone = uniquePhoneFor();
    const recipientPhone = uniquePhoneFor();

    const { res } = await agentIntake(ctx, dili, { dest: 'BCU', destAgentId: bcu.agentId, senderPhone, recipientPhone, senderLang: 'pt', recipientLang: 'id' });
    expect(res.status).toBe(201);
    const s = res.body.shipment;

    // waybill + routing
    expect(s.waybillNumber).toMatch(WAYBILL_REGEX);
    expect(s.waybillNumber).toMatch(/^670S-DIL-BCU-\d{6}-\d{4}$/);
    expect(s.status).toBe('DROPPED_AT_ORIGIN');
    expect(s.transportCanal).toBe('BUS_BAGGAGE');
    expect(s.intakeChannel).toBe('AGENT_DROP_OFF');
    expect(s.fees.base.usd).toBe('4.0000');
    expect(s.fees.total.usd).toBe('4.0000');
    expect(res.body.quote.chargeableWeightKg).toBe(2);

    // origin agent: collected $4.00 cash, keeps 15% ($0.60) → deposit debited $3.40
    expect(delta(agentBefore, await walletBalance(ctx, dili.wallet))).toBe('-3.4000');
    const after = await sys();
    expect(delta(before.pending, after.pending)).toBe('2.2000'); // fleet 1.60 + destination 0.60 held until arrival / delivery
    expect(delta(before.revenue, after.revenue)).toBe('1.0000'); // platform 25%
    expect(delta(before.escrow, after.escrow)).toBe('0.2000'); // claim reserve 5%
    expect(delta(before.hubOps, after.hubOps)).toBe('0.0000'); // kiosk kept the origin share

    // settlement record
    const st = await ctx.prisma.shipmentSettlement.findUniqueOrThrow({ where: { shipmentId: s.id } });
    expect([st.fleetShareUsd, st.platformShareUsd, st.originShareUsd, st.destShareUsd, st.claimReserveUsd].map((d) => d.toFixed(4))).toEqual([
      '1.6000', '1.0000', '0.6000', '0.6000', '0.2000',
    ]);
    expect(st.status).toBe('HELD');
    expect(st.originMode).toBe('AGENT_CASH_RETAINED');

    // evidence + timeline
    expect(await ctx.prisma.shipmentPhoto.count({ where: { shipmentId: s.id } })).toBe(2);
    const events = await ctx.prisma.shipmentEvent.findMany({ where: { shipmentId: s.id } });
    expect(events.map((e) => e.status)).toEqual(['DROPPED_AT_ORIGIN']);

    // WhatsApp: sender in Portuguese, recipient in Indonesian, both carry the waybill
    const toSender = messagesTo(ctx, senderPhone);
    const toRecipient = messagesTo(ctx, recipientPhone);
    expect(toSender).toHaveLength(1);
    expect(toRecipient).toHaveLength(1);
    expect(toSender[0]!.body).toContain('Encomenda recebida!');
    expect(toSender[0]!.body).toContain(s.waybillNumber);
    expect(toRecipient[0]!.body).toContain('Paket diterima!');

    expect((await ledger.reconcile()).ok).toBe(true);
  });

  /* -------------------------------------------- idempotency -------------------------------------------- */
  it('a retried request (same Idempotency-Key) returns the same parcel and charges once', async () => {
    const photoIds = await intakePhotos(ctx, dili.token);
    const body = intakeBody({ dest: 'BCU', destAgentId: bcu.agentId, pin: dili.user.pin, photoIds });
    const key = randomUUID();
    const before = await walletBalance(ctx, dili.wallet);
    const a = await postIntake(ctx, dili.token, body, key);
    const b = await postIntake(ctx, dili.token, body, key);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.body.shipment.id).toBe(a.body.shipment.id);
    expect(b.headers['idempotent-replayed']).toBe('true');
    expect(Number(before) - Number(await walletBalance(ctx, dili.wallet))).toBeCloseTo(3.4, 4);
    expect(await ctx.prisma.shipment.count({ where: { id: a.body.shipment.id } })).toBe(1);
  });

  it('requires an Idempotency-Key', async () => {
    const photoIds = await intakePhotos(ctx, dili.token);
    const res = await ctx.http.post('/v1/shipments').set(bearer(dili.token)).send(intakeBody({ destAgentId: bcu.agentId, pin: dili.user.pin, photoIds }));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('idempotency_key_required');
  });

  /* ---------------------------------------------- the gates ---------------------------------------------- */
  describe('compliance gates', () => {
    const base = (photoIds: string[]) => intakeBody({ dest: 'BCU', destAgentId: bcu.agentId, pin: dili.user.pin, photoIds });

    it('blocks intake unless EVERY prohibited-item line is confirmed', async () => {
      const photoIds = await intakePhotos(ctx, dili.token);
      for (const key of ['narcotics', 'weapons_sharp', 'fuel_flammable', 'cash_gold_jewelry', 'protected_wildlife', 'untaxed_contraband', 'raw_perishables']) {
        const body = base(photoIds);
        (body.prohibitedChecklist as Record<string, boolean>)[key] = false;
        const res = await postIntake(ctx, dili.token, body);
        expect(res.status).toBe(422);
      }
      const missing = base(photoIds) as Record<string, unknown>;
      delete missing['prohibitedChecklist'];
      expect((await postIntake(ctx, dili.token, missing)).status).toBe(422);
    });

    it('refuses a waybill without BOTH mandatory photos — and burns nothing', async () => {
      const onlyOpen = [await stagePhoto(ctx, dili.token, 'OPEN_BOX_CONTENT'), await stagePhoto(ctx, dili.token, 'OPEN_BOX_CONTENT')];
      const before = await walletBalance(ctx, dili.wallet);
      const countBefore = await ctx.prisma.shipment.count();
      const res = await postIntake(ctx, dili.token, base(onlyOpen));
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('photos_required');
      expect(await walletBalance(ctx, dili.wallet)).toBe(before); // no money moved
      expect(await ctx.prisma.shipment.count()).toBe(countBefore); // no shipment
      expect((await ctx.prisma.stagedUpload.findMany({ where: { id: { in: onlyOpen } } })).every((u) => u.consumedAt === null)).toBe(true);
      expect((await postIntake(ctx, dili.token, base([onlyOpen[0]!]))).status).toBe(422); // fewer than 2 ids
    });

    it('rejects anonymous senders and invalid contacts', async () => {
      const photoIds = await intakePhotos(ctx, dili.token);
      const anon = base(photoIds) as { sender: Record<string, unknown> };
      anon.sender = { ...anon.sender, name: '', idNumber: '' };
      expect((await postIntake(ctx, dili.token, anon)).status).toBe(422);

      const badPhone = base(photoIds) as { recipient: Record<string, unknown> };
      badPhone.recipient = { ...badPhone.recipient, phone: '+6281234567890' };
      const res = await postIntake(ctx, dili.token, badPhone);
      expect(res.status).toBe(422);
    });

    it('requires the correct 6-digit PIN (step 5) — wrong PIN moves nothing', async () => {
      const photoIds = await intakePhotos(ctx, dili.token);
      const before = await walletBalance(ctx, dili.wallet);
      const res = await postIntake(ctx, dili.token, { ...base(photoIds), pin: '000001' });
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('pin_invalid');
      expect(await walletBalance(ctx, dili.wallet)).toBe(before);
    });

    it('refuses when the kiosk deposit cannot cover the collected amount — atomically', async () => {
      const poor = await createAgent(ctx, 'DIL', '1.0000');
      const photoIds = await intakePhotos(ctx, poor.token);
      const seqBefore = await ctx.prisma.waybillSequence.findMany();
      const res = await postIntake(ctx, poor.token, intakeBody({ dest: 'BCU', destAgentId: bcu.agentId, pin: poor.user.pin, photoIds }));
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('insufficient_deposit');
      expect(await walletBalance(ctx, poor.wallet)).toBe('1.0000');
      expect((await ctx.prisma.stagedUpload.findMany({ where: { id: { in: photoIds } } })).every((u) => u.consumedAt === null)).toBe(true);
      // the waybill sequence rolled back too: no gaps from failed intakes
      expect(await ctx.prisma.waybillSequence.findMany()).toEqual(seqBefore);
    });

    it('launch scope: a route must start or end in Díli', async () => {
      const photoIds = await intakePhotos(ctx, bcu.token);
      const res = await postIntake(ctx, bcu.token, intakeBody({ dest: 'VIQ', pin: bcu.user.pin, photoIds }));
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('route_not_supported');
    });

    it('a kiosk cannot start a courier-pickup scheme and vice versa', async () => {
      const photoIds = await intakePhotos(ctx, dili.token);
      const res = await postIntake(ctx, dili.token, intakeBody({ scheme: 'SCHEME_B', destAgentId: bcu.agentId, pin: dili.user.pin, photoIds }));
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('scheme_not_allowed');
    });

    it('needs an explicit destination agent when a municipality has several', async () => {
      await createAgent(ctx, 'BCU', '0'); // now two ACTIVE agents in Baucau
      const photoIds = await intakePhotos(ctx, dili.token);
      const res = await postIntake(ctx, dili.token, intakeBody({ dest: 'BCU', pin: dili.user.pin, photoIds }));
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('destination_agent_required');
    });

    it('fails clearly when the destination has no active agent', async () => {
      await ctx.prisma.agent.updateMany({ where: { municipality: { code: 'LAU' } }, data: { status: 'SUSPENDED' } });
      const photoIds = await intakePhotos(ctx, dili.token);
      const res = await postIntake(ctx, dili.token, intakeBody({ dest: 'LAU', pin: dili.user.pin, photoIds }));
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('no_destination_agent');
    });
  });

  /* ------------------------------------------ pricing & canal ------------------------------------------ */
  describe('pricing and canal through the real intake', () => {
    const go = (o: Parameters<typeof agentIntake>[2]) => agentIntake(ctx, dili, { destAgentId: bcu.agentId, ...o });

    it('document tier (≤ 0.5 kg) uses the document rate: Zone 2 = $3.00', async () => {
      const { res } = await go({ category: 'DOCUMENT', weight: 0.3, dims: [30, 20, 2], description: 'Ijazah' });
      expect(res.body.shipment.fees.base.usd).toBe('3.0000');
      expect(res.body.shipment.parcel.isDocumentTier).toBe(true);
    });

    it('3-10 kg adds per kg: 5 kg to Zone 2 = $4.00 + 3 × $1.00 = $7.00', async () => {
      const { res } = await go({ weight: 5 });
      expect(res.body.shipment.fees.base.usd).toBe('7.0000');
      expect(res.body.shipment.transportCanal).toBe('BUS_BAGGAGE');
    });

    it('volumetric weight is charged for big light boxes', async () => {
      const { res } = await go({ weight: 1, dims: [40, 30, 30] }); // 6 kg volumetric
      expect(res.body.shipment.parcel.chargeableWeightKg).toBe(6);
      expect(res.body.shipment.fees.base.usd).toBe('8.0000'); // 4 + 4 × 1
    });

    it('> 10 kg or oversize or fragile goes to cargo pickup and is priced on the cargo tier', async () => {
      const heavy = await go({ weight: 12, dims: [30, 30, 20] });
      expect(heavy.res.body.shipment.transportCanal).toBe('CARGO_TRUCK_PICKUP');
      expect(heavy.res.body.shipment.fees.base.usd).toBe('15.7000'); // 14.00 + 2 × 0.85
      const oversize = await go({ weight: 3, dims: [60, 20, 20] });
      expect(oversize.res.body.shipment.transportCanal).toBe('CARGO_TRUCK_PICKUP');
      const fragile = await go({ weight: 1, fragile: true });
      expect(fragile.res.body.shipment.transportCanal).toBe('CARGO_TRUCK_PICKUP');
      expect(fragile.res.body.shipment.fees.base.usd).toBe('14.0000');
    });

    it('> 500 kg is refused', async () => {
      const { res } = await go({ weight: 501 });
      expect(res.status).toBe(422);
    });

    it('insurance: 1% premium (min $1), credited to the insurance pool, declared value mandatory', async () => {
      const before = await sys();
      const { res } = await go({ category: 'ELECTRONICS', description: 'Phone', declared: '300', insure: true });
      expect(res.status).toBe(201);
      expect(res.body.shipment.insurance).toMatchObject({ isInsured: true, premium: { usd: '3.0000' }, insuredAmount: { usd: '300.0000' } });
      expect(res.body.shipment.fees.total.usd).toBe('7.0000'); // 4.00 + 3.00
      expect(delta(before.insurance, (await sys()).insurance)).toBe('3.0000');

      const noValue = await go({ category: 'ELECTRONICS', description: 'Laptop' });
      expect(noValue.res.status).toBe(422);
      expect(noValue.res.body.code).toBe('declared_value_required');
      const noValue2 = await go({ insure: true });
      expect(noValue2.res.body.code).toBe('declared_value_required');
    });

    it('coverage is capped at $500 and the minimum premium is $1', async () => {
      const big = await go({ category: 'ELECTRONICS', declared: '2000', insure: true, description: 'Laptops' });
      expect(big.res.body.shipment.insurance.insuredAmount.usd).toBe('500.0000');
      expect(big.res.body.shipment.insurance.premium.usd).toBe('5.0000');
      const small = await go({ category: 'ELECTRONICS', declared: '40', insure: true, description: 'Charger' });
      expect(small.res.body.shipment.insurance.premium.usd).toBe('1.0000');
    });

    it('food is flagged short-shelf-life', async () => {
      const { res, id } = await go({ category: 'FOOD', description: 'Kue' });
      expect(res.status).toBe(201);
      expect((await ctx.prisma.shipment.findUniqueOrThrow({ where: { id } })).isShortShelfLife).toBe(true);
    });

    it('Oecusse & Ataúro are forced onto the sea canal and priced on Zone 4', async () => {
      const oec = await go({ dest: 'OEC', destAgentId: undefined, override: { destAgentId: (await seaAgent('OEC')).agentId } });
      expect(oec.res.status).toBe(201);
      expect(oec.res.body.shipment.transportCanal).toBe('SEA_FERRY_CARGO');
      expect(oec.res.body.shipment.fees.base.usd).toBe('8.0000'); // $6 + $2 Oecusse surcharge
      const ata = await go({ dest: 'ATA', destAgentId: undefined, override: { destAgentId: (await seaAgent('ATA')).agentId } });
      expect(ata.res.body.shipment.transportCanal).toBe('SEA_FERRY_CARGO');
      expect(ata.res.body.shipment.fees.base.usd).toBe('6.0000');
      const doc = await go({ dest: 'OEC', category: 'DOCUMENT', weight: 0.2, dims: [30, 20, 2], destAgentId: undefined, override: { destAgentId: (await seaAgent('OEC')).agentId } });
      expect(doc.res.body.shipment.fees.base.usd).toBe('5.0000');
    });
  });

  /* ------------------------------------------- other schemes ------------------------------------------- */
  describe('door delivery (Scheme C) and courier pick-up (Scheme B)', () => {
    it('Scheme C adds the $1.50 delivery add-on; courier 80 % is held, platform 20 % booked', async () => {
      const before = await sys();
      const agentBefore = await walletBalance(ctx, dili.wallet);
      const noAddr = await agentIntake(ctx, dili, { scheme: 'SCHEME_C', destAgentId: bcu.agentId });
      expect(noAddr.res.status).toBe(422);
      expect(noAddr.res.body.code).toBe('delivery_address_required');

      const { res, id } = await agentIntake(ctx, dili, { scheme: 'SCHEME_C', destAgentId: bcu.agentId, recipientAddress: 'Rua Central 12, Baucau' });
      expect(res.status).toBe(201);
      expect(res.body.shipment.fees.deliveryAddon.usd).toBe('1.5000');
      expect(res.body.shipment.fees.total.usd).toBe('5.5000');
      // agent: collected 5.50, keeps 0.60 → debit 4.90
      expect(delta(agentBefore, await walletBalance(ctx, dili.wallet))).toBe('-4.9000');
      const after = await sys();
      expect(delta(before.pending, after.pending)).toBe('3.4000'); // 2.20 + 1.20 courier share
      expect(delta(before.revenue, after.revenue)).toBe('1.3000'); // 1.00 + 0.30
      const st = await ctx.prisma.shipmentSettlement.findUniqueOrThrow({ where: { shipmentId: id } });
      expect(st.courierShareUsd.toFixed(4)).toBe('1.2000');
      expect(st.addonPlatformUsd.toFixed(4)).toBe('0.3000');
    });

    it('cargo door delivery is only offered inside Díli', async () => {
      const { res } = await agentIntake(ctx, dili, { scheme: 'SCHEME_C', destAgentId: bcu.agentId, weight: 12, recipientAddress: 'Baucau' });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('addon_not_available');
    });

    it('courier pick-up: public booking → ops confirm → assign (WhatsApp) → on-site intake; the wholesale rule charges the pick-up once', async () => {
      const courier = await createCourier(ctx);
      const ops = await createStaff(ctx, 'OPS_HUB_ADMIN');
      const senderPhone = uniquePhoneFor();
      const booking = await ctx.http.post('/v1/public/pickup-bookings').send({
        senderName: 'Toko Lian', senderPhone, preferredLang: 'id', scheme: 'SCHEME_B', destMunicipalityCode: 'BCU', parcelCount: 3, pickupAddress: 'Rua Comoro 5, Díli', lat: -8.55, lng: 125.57,
      });
      expect(booking.status).toBe(201);
      expect(booking.body.batchCode).toMatch(/^PB-\d{6}-[0-9A-Z]{6}$/);
      const row = await ctx.prisma.pickupBooking.findUniqueOrThrow({ where: { batchCode: booking.body.batchCode } });

      // cannot dispatch an unconfirmed request
      const early = await ctx.http.post(`/v1/pickup-bookings/${row.id}/assign`).set(bearer(ops.token)).send({ courierId: courier.courierId });
      expect(early.body.code).toBe('booking_not_confirmed');
      expect((await ctx.http.post(`/v1/pickup-bookings/${row.id}/confirm`).set(bearer(ops.token))).status).toBe(200);
      const assigned = await ctx.http.post(`/v1/pickup-bookings/${row.id}/assign`).set(bearer(ops.token)).send({ courierId: courier.courierId });
      expect(assigned.status).toBe(200);
      const wa1 = messagesTo(ctx, senderPhone);
      expect(wa1).toHaveLength(1);
      expect(wa1[0]!.body).toContain('Kurir 670Send');
      expect(wa1[0]!.body).toContain(courier.user.phone.slice(0, 4)); // courier contact included

      const jobs = await ctx.http.get('/v1/courier/jobs').set(bearer(courier.token));
      expect(jobs.body.pickups).toHaveLength(1);

      const before = await sys();
      const courierBefore = await walletBalance(ctx, courier.wallet);
      const fees: string[] = [];
      for (let i = 0; i < 3; i++) {
        const photoIds = await intakePhotos(ctx, courier.token);
        const res = await postIntake(ctx, courier.token, intakeBody({ scheme: 'SCHEME_B', dest: 'BCU', destAgentId: bcu.agentId, pickupBookingId: row.id, pin: courier.user.pin, photoIds, senderPhone }));
        expect(res.status).toBe(201);
        expect(res.body.shipment.intakeChannel).toBe('COURIER_PICKUP');
        fees.push(res.body.shipment.fees.pickupAddon.usd);
      }
      expect(fees).toEqual(['1.5000', '0.0000', '0.0000']); // wholesale: ≥ 3 parcels → charged once
      expect((await ctx.prisma.pickupBooking.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('PICKED_UP');

      // 3 × base $4.00 + one pick-up $1.50. Courier physically collected 13.50, keeps 80 % of the pick-up fee ($1.20);
      // the rest (12.30) is debited from the deposit.
      expect(delta(courierBefore, await walletBalance(ctx, courier.wallet))).toBe('-12.3000');
      const after = await sys();
      expect(delta(before.hubOps, after.hubOps)).toBe('1.8000'); // origin 15% × 3: no kiosk took these parcels
      expect(delta(before.revenue, after.revenue)).toBe('3.3000'); // 3 × 1.00 + pick-up 20 % (0.30)
      expect((await ledger.reconcile()).ok).toBe(true);
    });

    it('a courier can only use a booking assigned to them', async () => {
      const a = await createCourier(ctx);
      const b = await createCourier(ctx);
      const ops = await createStaff(ctx, 'OPS_HUB_ADMIN');
      const bk = await ctx.http.post('/v1/public/pickup-bookings').send({ senderName: 'Someone Else', senderPhone: uniquePhoneFor(), scheme: 'SCHEME_B', pickupAddress: 'Rua X 1, Díli' });
      const id = (await ctx.prisma.pickupBooking.findUniqueOrThrow({ where: { batchCode: bk.body.batchCode } })).id;
      await ctx.http.post(`/v1/pickup-bookings/${id}/confirm`).set(bearer(ops.token));
      await ctx.http.post(`/v1/pickup-bookings/${id}/assign`).set(bearer(ops.token)).send({ courierId: a.courierId });
      const photoIds = await intakePhotos(ctx, b.token);
      const res = await postIntake(ctx, b.token, intakeBody({ scheme: 'SCHEME_B', destAgentId: bcu.agentId, pickupBookingId: id, pin: b.user.pin, photoIds }));
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('booking_invalid');
    });

    it('hub-desk intake (staff, no kiosk): cash goes to the company, origin 15 % to PLATFORM_HUB_OPS', async () => {
      const desk = await createStaff(ctx, 'SUPER_ADMIN');
      await ctx.prisma.user.update({ where: { id: desk.user.id }, data: { pinHash: await ctx.passwords.hash(desk.user.pin) } });
      const before = await sys();
      const photoIds = await intakePhotos(ctx, desk.token);
      const res = await postIntake(ctx, desk.token, intakeBody({ dest: 'BCU', destAgentId: bcu.agentId, pin: desk.user.pin, photoIds }));
      expect(res.status).toBe(201);
      expect(res.body.shipment.intakeChannel).toBe('HUB_DESK');
      const after = await sys();
      expect(delta(before.clearing, after.clearing)).toBe('-4.0000');
      expect(delta(before.hubOps, after.hubOps)).toBe('0.6000');
    });
  });

  /* ------------------------------------- concurrency, scope, public ------------------------------------- */
  it('5 parallel intakes get 5 distinct sequential waybills and the exact total debit', async () => {
    const busy = await createAgent(ctx, 'DIL', '100.0000');
    const photoSets = await Promise.all(Array.from({ length: 5 }, () => intakePhotos(ctx, busy.token)));
    const results = await Promise.all(
      photoSets.map((photoIds) => postIntake(ctx, busy.token, intakeBody({ dest: 'BCU', destAgentId: bcu.agentId, pin: busy.user.pin, photoIds }))),
    );
    expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
    const waybills = results.map((r) => r.body.shipment.waybillNumber as string);
    expect(new Set(waybills).size).toBe(5);
    const seqs = waybills.map((w) => Number(w.slice(-4))).sort((a, b) => a - b);
    for (let i = 1; i < seqs.length; i++) expect(seqs[i]! - seqs[i - 1]!).toBe(1); // no gaps, no duplicates
    expect(await walletBalance(ctx, busy.wallet)).toBe('83.0000'); // 100 − 5 × 3.40
  });

  describe('visibility', () => {
    it('origin agent sees everything; destination agent sees a masked sender; strangers get 404', async () => {
      const { id, waybill } = await agentIntake(ctx, dili, { destAgentId: bcu.agentId });
      const origin = await ctx.http.get(`/v1/shipments/${waybill}`).set(bearer(dili.token));
      expect(origin.status).toBe(200);
      expect(origin.body.sender.idNumber).toBe('BI123456');
      expect(origin.body.sender.name).toBe('Maria da Costa');

      const dest = await ctx.http.get(`/v1/shipments/${id}`).set(bearer(bcu.token));
      expect(dest.status).toBe(200);
      expect(dest.body.sender.name).toBe('M**** d* C****');
      expect(dest.body.sender.idNumber).toBeUndefined();
      expect(dest.body.sender.phone).toContain('**');

      const stranger = await createAgent(ctx, 'DIL', '0');
      expect((await ctx.http.get(`/v1/shipments/${waybill}`).set(bearer(stranger.token))).status).toBe(404);
      expect((await ctx.http.get('/v1/shipments/not-a-waybill').set(bearer(stranger.token))).status).toBe(404);

      const staff = await createStaff(ctx, 'CS_CLAIMS_ADMIN');
      expect((await ctx.http.get(`/v1/shipments/${waybill}`).set(bearer(staff.token))).body.sender.idNumber).toBe('BI123456');
    });

    it('lists are scoped to the actor', async () => {
      const lone = await createAgent(ctx, 'DIL', '50.0000');
      const mine = await agentIntake(ctx, lone, { destAgentId: bcu.agentId });
      const list = await ctx.http.get('/v1/shipments').set(bearer(lone.token));
      expect(list.body.items.map((s: { waybillNumber: string }) => s.waybillNumber)).toEqual([mine.waybill]);
      const empty = await createAgent(ctx, 'DIL', '0');
      expect((await ctx.http.get('/v1/shipments').set(bearer(empty.token))).body.items).toEqual([]);
    });

    it('drivers and fleet owners cannot read parcels', async () => {
      const { createFleet } = await import('./scenario');
      const fleet = await createFleet(ctx);
      expect((await ctx.http.get('/v1/shipments').set(bearer(fleet.driver.token))).status).toBe(403);
    });
  });

  describe('public endpoints', () => {
    it('quote: itemised, with the canal decision, for the website calculator', async () => {
      const res = await ctx.http.post('/v1/public/quote').send({ destMunicipalityCode: 'BCU', parcel: { actualWeightKg: 2, lengthCm: 30, widthCm: 20, heightCm: 10 } });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ canal: 'BUS_BAGGAGE', zone: 'ZONE_2', chargeableWeightKg: 2, baseShippingFee: { usd: '4.0000', display: '$4.00' }, total: { display: '$4.00' } });

      const sea = await ctx.http.post('/v1/public/quote').send({ destMunicipalityCode: 'OEC', scheme: 'SCHEME_D', parcel: { actualWeightKg: 2, lengthCm: 30, widthCm: 20, heightCm: 10 } });
      expect(sea.body.canal).toBe('SEA_FERRY_CARGO');
      expect(sea.body.isSeaRoute).toBe(true);
      expect(sea.body.total.usd).toBe('11.0000'); // 8 + pick-up 1.50 + delivery 1.50

      expect((await ctx.http.post('/v1/public/quote').send({ destMunicipalityCode: 'XXX', parcel: { actualWeightKg: 1, lengthCm: 1, widthCm: 1, heightCm: 1 } })).status).toBe(422);
      expect((await ctx.http.post('/v1/public/quote').send({ originMunicipalityCode: 'BCU', destMunicipalityCode: 'VIQ', parcel: { actualWeightKg: 1, lengthCm: 10, widthCm: 10, heightCm: 10 } })).body.code).toBe('route_not_supported');
    });

    it('track: masked names, no personal data, same 404 for unknown and malformed numbers', async () => {
      const { waybill } = await agentIntake(ctx, dili, { destAgentId: bcu.agentId });
      const res = await ctx.http.get(`/v1/public/track/${waybill}`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ waybill, status: 'DROPPED_AT_ORIGIN', origin: 'Díli', destination: 'Baucau', sender: 'M**** d* C****', recipient: 'J*** G*****', kiosk: null, exception: null });
      expect(JSON.stringify(res.body)).not.toMatch(/\+670|BI123456|idNumber|phone|fee/i);
      expect(res.body.steps.find((s: { status: string }) => s.status === 'DROPPED_AT_ORIGIN').reachedAt).not.toBeNull();
      expect((await ctx.http.get('/v1/public/track/670S-DIL-BCU-261121-9999')).status).toBe(404);
      expect((await ctx.http.get('/v1/public/track/garbage')).status).toBe(404);
    });
  });

  /* helper: agent in a sea municipality, created lazily and reused */
  const seaCache = new Map<string, AgentCtx>();
  async function seaAgent(code: string): Promise<AgentCtx> {
    if (!seaCache.has(code)) {
      await ctx.prisma.agent.updateMany({ where: { municipality: { code } }, data: { status: 'SUSPENDED' } });
      seaCache.set(code, await createAgent(ctx, code, '0'));
    }
    return seaCache.get(code)!;
  }
});
