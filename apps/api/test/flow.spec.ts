import { randomUUID } from 'node:crypto';
import { LedgerService } from '../src/ledger/ledger.service';
import { SettingsService } from '../src/common/settings.service';
import { bearer, createTestApp, uniquePhone, type TestCtx } from './helpers';
import {
  agentIntake,
  bagAndManifest,
  createAgent,
  createFleet,
  createNetwork,
  driverHandover,
  hubReceive,
  inboundScan,
  messagesTo,
  otpSentTo,
  shipInTransit,
  shipmentRow,
  stagePhoto,
  sysWallet,
  walletBalance,
  type Network,
} from './scenario';

describe('End-to-end: intake → hub → master bag → manifest → handover → inbound → OTP → PoD', () => {
  let ctx: TestCtx;
  let net: Network;
  beforeAll(async () => {
    ctx = await createTestApp();
    net = await createNetwork(ctx);
  });
  afterAll(() => ctx.close());

  it('walks two parcels through the whole chain and settles every cent', async () => {
    const ledger = ctx.app.get(LedgerService);
    const pendingBefore = Number(await walletBalance(ctx, sysWallet('PENDING_SETTLEMENT')));
    const rA = uniquePhone();
    const rB = uniquePhone();
    const sA = uniquePhone();

    // 1. intake at the Díli kiosk ($4.00 each)
    const a = await agentIntake(ctx, net.dili, { destAgentId: net.bcu.agentId, recipientPhone: rA, senderPhone: sA, recipientLang: 'pt', senderLang: 'en' });
    const b = await agentIntake(ctx, net.dili, { destAgentId: net.bcu.agentId, recipientPhone: rB });
    expect([a.res.status, b.res.status]).toEqual([201, 201]);

    // 2. hub scan — the wrong corridor hub refuses them, the right one accepts
    const wrong = await hubReceive(ctx, net.ops.token, 'HUB_TAIBESI', [a.waybill]);
    expect(wrong.body.failed).toEqual([{ waybill: a.waybill, code: 'wrong_hub' }]);
    const right = await hubReceive(ctx, net.ops.token, 'HUB_BECORA', [a.waybill, b.waybill]);
    expect(right.body.received).toHaveLength(2);
    expect((await shipmentRow(ctx, a.waybill)).status).toBe('CONSOLIDATED_AT_HUB');
    expect(messagesTo(ctx, sA).some((m) => m.body.includes('Hub'))).toBe(true);

    // 3. master bag
    const bag = await ctx.http.post('/v1/master-bags').set(bearer(net.ops.token)).send({ hubCode: 'HUB_BECORA', destMunicipalityCode: 'BCU' });
    expect(bag.status).toBe(201);
    expect(bag.body.bagCode).toMatch(/^MB-\d{6}-[0-9A-Z]{6}$/);
    expect((await ctx.http.post('/v1/master-bags').set(bearer(net.ops.token)).send({ hubCode: 'HUB_BECORA', destMunicipalityCode: 'AIL' })).body.code).toBe('wrong_hub'); // Aileu is on the South corridor
    for (const w of [a.waybill, b.waybill]) {
      expect((await ctx.http.post(`/v1/master-bags/${bag.body.bagCode}/items`).set(bearer(net.ops.token)).send({ waybill: w })).status).toBe(200);
    }
    // can't be put in a second bag
    const bag2 = await ctx.http.post('/v1/master-bags').set(bearer(net.ops.token)).send({ hubCode: 'HUB_BECORA', destMunicipalityCode: 'BCU' });
    expect((await ctx.http.post(`/v1/master-bags/${bag2.body.bagCode}/items`).set(bearer(net.ops.token)).send({ waybill: a.waybill })).body.code).toBe('parcel_already_assigned');
    expect((await ctx.http.post(`/v1/master-bags/${bag.body.bagCode}/seal`).set(bearer(net.ops.token)).send({ plasticSealNumber: 'PS-FLOW-0001' })).body.status).toBe('SEALED');
    // sealed bags are closed
    expect((await ctx.http.post(`/v1/master-bags/${bag.body.bagCode}/items`).set(bearer(net.ops.token)).send({ waybill: a.waybill })).body.code).toBe('master_bag_invalid');

    // 4. manifest
    const man = await ctx.http.post('/v1/manifests').set(bearer(net.ops.token)).send({
      hubCode: 'HUB_BECORA', destMunicipalityCode: 'BCU', canal: 'BUS_BAGGAGE', fleetPartnerId: net.fleet.partnerId,
      vehicleId: net.fleet.vehicles.bus, driverId: net.fleet.driverId, masterBagCodes: [bag.body.bagCode],
    });
    expect(man.status).toBe(201);
    expect(man.body).toMatchObject({ status: 'DRAFT', parcelCount: 2, masterBagCount: 1, canal: 'BUS_BAGGAGE' });
    expect((await ctx.http.post(`/v1/manifests/${man.body.manifestCode}/ready`).set(bearer(net.ops.token)).send({})).body.status).toBe('READY');

    // 5. driver handover: no baggage photo → refused; with photo → IN_TRANSIT
    const noPhoto = await ctx.http.post(`/v1/manifests/${man.body.manifestCode}/handover`).set(bearer(net.fleet.driver.token)).send({});
    expect(noPhoto.body.code).toBe('baggage_photo_required');
    expect((await ctx.http.post(`/v1/manifests/${man.body.manifestCode}/handover`).set(bearer(net.bcu.token)).send({})).status).toBe(403); // not a driver
    const otherDriver = await createFleet(ctx);
    const photo = await stagePhoto(ctx, otherDriver.driver.token, 'BAGGAGE_PLACEMENT');
    expect((await ctx.http.post(`/v1/manifests/${man.body.manifestCode}/handover`).set(bearer(otherDriver.driver.token)).send({ baggagePhotoUploadId: photo })).status).toBe(404); // someone else's manifest
    const h = await driverHandover(ctx, net, man.body.manifestCode);
    expect(h.status).toBe(200);
    expect(h.body).toMatchObject({ status: 'IN_TRANSIT', hasBaggagePhoto: true });
    expect((await shipmentRow(ctx, a.waybill)).status).toBe('IN_TRANSIT');
    expect(await ctx.prisma.shipmentPhoto.count({ where: { shipmentId: a.id, photoType: 'BAGGAGE_PLACEMENT' } })).toBe(1);
    expect(messagesTo(ctx, rA).some((m) => m.body.includes('partiu de Díli'))).toBe(true); // recipient language pt
    const st = await ctx.prisma.shipmentSettlement.findUniqueOrThrow({ where: { shipmentId: a.id } });
    expect(st.fleetPartnerId).toBe(net.fleet.partnerId);
    expect((await ctx.prisma.masterBag.findUniqueOrThrow({ where: { bagCode: bag.body.bagCode } })).status).toBe('DISPATCHED');

    // 6. destination inbound scan — only the destination agent may do it, in front of the driver
    const stranger = await createAgent(ctx, 'BCU', '0');
    expect((await inboundScan(ctx, stranger.token, { code: bag.body.bagCode, condition: 'INTACT' })).status).toBe(404);
    expect((await inboundScan(ctx, net.dili.token, { code: bag.body.bagCode, condition: 'INTACT' })).status).toBe(404);
    const fleetBefore = Number(await walletBalance(ctx, net.fleet.payable));
    const scan = await inboundScan(ctx, net.bcu.token, { code: bag.body.bagCode, condition: 'INTACT' });
    expect(scan.status).toBe(200);
    expect(scan.body.processed.map((p: { status: string }) => p.status)).toEqual(['ARRIVED_AT_DEST_AGENT', 'ARRIVED_AT_DEST_AGENT']);
    expect(scan.body.manifest.status).toBe('COMPLETED');
    expect(scan.body.driverConfirmationRequired).toBe(false);

    // the OTP exists only as an HMAC, the recipient got it by WhatsApp in their language
    const arrived = await shipmentRow(ctx, a.waybill);
    expect(arrived.status).toBe('ARRIVED_AT_DEST_AGENT');
    expect(arrived.pickupOtpHash).toMatch(/^[0-9a-f]{64}$/);
    const otpA = otpSentTo(ctx, rA);
    const otpB = otpSentTo(ctx, rB);
    expect(otpA).toMatch(/^\d{6}$/);
    expect(arrived.pickupOtpHash).not.toContain(otpA);
    expect(messagesTo(ctx, rA).at(-1)!.body).toContain('Leve o BI e o OTP');
    expect(JSON.stringify(await ctx.prisma.notificationLog.findMany({ where: { shipmentId: a.id } }))).not.toContain(otpA); // masked in logs

    // fleet OWNER is paid on intact arrival: 2 × $1.60
    expect(Number(await walletBalance(ctx, net.fleet.payable)) - fleetBefore).toBeCloseTo(3.2, 4);

    // 7. proof of delivery: wrong OTP locks after 5 tries; collector must identify; PoD photo mandatory
    const collector = { name: 'José Guterres', idType: 'BI', idNumber: 'BI998877', isRepresentative: false };
    const pod = async (waybill: string, otp: string, photoId?: string, extra: object = {}) =>
      ctx.http.post('/v1/pod/verify').set(bearer(net.bcu.token)).send({ waybill, otp, collector, photoUploadId: photoId ?? (await stagePhoto(ctx, net.bcu.token, 'PROOF_OF_DELIVERY')), ...extra });
    const wrongOtp = otpA === '123456' ? '654321' : '123456';
    for (let i = 0; i < 4; i++) {
      const r = await pod(a.waybill, wrongOtp);
      expect([r.status, r.body.code]).toEqual([422, 'invalid_otp']);
    }
    const fifth = await pod(a.waybill, wrongOtp);
    expect([fifth.status, fifth.body.code]).toEqual([423, 'otp_locked']);
    expect((await pod(a.waybill, otpA)).body.code).toBe('otp_locked'); // even the right code is refused while locked
    await ctx.prisma.shipment.update({ where: { id: a.id }, data: { pickupOtpLockedUntil: new Date(Date.now() - 1000) } }); // lock expires
    expect((await pod(b.waybill, otpA)).body.code).toBe('invalid_otp'); // B's code ≠ A's code (bound to the shipment)

    const commissionBefore = Number(await walletBalance(ctx, net.bcu.commission));
    const pendingMid = Number(await walletBalance(ctx, sysWallet('PENDING_SETTLEMENT')));
    const delivered = await pod(a.waybill, otpA);
    expect(delivered.status).toBe(200);
    expect(delivered.body.status).toBe('DELIVERED');
    const done = await shipmentRow(ctx, a.waybill);
    expect(done).toMatchObject({ status: 'DELIVERED', collectorName: 'José Guterres', collectorIdNumber: 'BI998877', pickupOtpHash: null });
    expect(await ctx.prisma.shipmentPhoto.count({ where: { shipmentId: a.id, photoType: 'PROOF_OF_DELIVERY' } })).toBe(1);
    expect(Number(await walletBalance(ctx, net.bcu.commission)) - commissionBefore).toBeCloseTo(0.6, 4); // destination agent 15 %
    expect(pendingMid - Number(await walletBalance(ctx, sysWallet('PENDING_SETTLEMENT')))).toBeCloseTo(0.6, 4);
    expect(messagesTo(ctx, sA).some((m) => m.body.includes('received by José Guterres'))).toBe(true);
    expect((await ctx.prisma.shipmentSettlement.findUniqueOrThrow({ where: { shipmentId: a.id } })).status).toBe('RELEASED');

    // delivering twice is impossible
    expect((await pod(a.waybill, otpA)).status).toBe(409);

    // deliver B too → the pending pool is fully drained for these two parcels
    expect((await pod(b.waybill, otpB)).status).toBe(200);
    expect(Number(await walletBalance(ctx, sysWallet('PENDING_SETTLEMENT')))).toBeCloseTo(pendingBefore, 4);
    expect(Number(await walletBalance(ctx, net.bcu.commission))).toBeCloseTo(1.2, 4);

    // full timeline, in order, with actors
    const events = await ctx.http.get(`/v1/shipments/${a.waybill}/events`).set(bearer(net.dili.token));
    expect(events.body.map((e: { status: string }) => e.status)).toEqual([
      'DROPPED_AT_ORIGIN', 'CONSOLIDATED_AT_HUB', 'IN_TRANSIT', 'ARRIVED_AT_DEST_AGENT', 'DELIVERED',
    ]);

    // the books are still perfectly balanced
    const rec = await ledger.reconcile();
    expect(rec.ok).toBe(true);
    expect(rec.unbalancedTransactions).toEqual([]);
  });

  it('the public tracker follows the parcel and reveals the kiosk once it has arrived', async () => {
    const { parcels } = await shipInTransit(ctx, net, 1);
    const w = parcels[0]!.waybill;
    const before = await ctx.http.get(`/v1/public/track/${w}`);
    expect(before.body).toMatchObject({ status: 'IN_TRANSIT', kiosk: null });
    await inboundScan(ctx, net.bcu.token, { code: w, condition: 'INTACT' }).then((r) => expect(r.status).toBe(422)); // in a bag → scan the bag
    const row = await shipmentRow(ctx, w);
    const bag = await ctx.prisma.masterBagItem.findUniqueOrThrow({ where: { shipmentId: row.id }, include: { masterBag: true } });
    await inboundScan(ctx, net.bcu.token, { code: bag.masterBag.bagCode, condition: 'INTACT' });
    const after = await ctx.http.get(`/v1/public/track/${w}`);
    expect(after.body.status).toBe('ARRIVED_AT_DEST_AGENT');
    expect(after.body.kiosk).toMatchObject({ address: 'Rua Teste, BCU', openingHours: '08:00-18:00' });
    expect(JSON.stringify(after.body)).not.toMatch(/otp/i);
  });

  it('loose cargo travels on a truck manifest, needs no baggage photo, and settles the same way', async () => {
    const heavy = await agentIntake(ctx, net.dili, { destAgentId: net.bcu.agentId, weight: 15, dims: [40, 30, 30] });
    expect(heavy.res.body.shipment.transportCanal).toBe('CARGO_TRUCK_PICKUP');
    await hubReceive(ctx, net.ops.token, 'HUB_BECORA', [heavy.waybill]);

    // heavy freight can't be bagged
    const bag = await ctx.http.post('/v1/master-bags').set(bearer(net.ops.token)).send({ hubCode: 'HUB_BECORA', destMunicipalityCode: 'BCU' });
    expect((await ctx.http.post(`/v1/master-bags/${bag.body.bagCode}/items`).set(bearer(net.ops.token)).send({ waybill: heavy.waybill })).body.code).toBe('master_bag_invalid');

    // a bus can't carry it
    const onBus = await ctx.http.post('/v1/manifests').set(bearer(net.ops.token)).send({
      hubCode: 'HUB_BECORA', destMunicipalityCode: 'BCU', canal: 'BUS_BAGGAGE', fleetPartnerId: net.fleet.partnerId, vehicleId: net.fleet.vehicles.bus, driverId: net.fleet.driverId, waybills: [heavy.waybill],
    });
    expect(onBus.body.code).toBe('manifest_invalid');
    // and a truck manifest can't use a bus vehicle
    const wrongVehicle = await ctx.http.post('/v1/manifests').set(bearer(net.ops.token)).send({
      hubCode: 'HUB_BECORA', destMunicipalityCode: 'BCU', canal: 'CARGO_TRUCK_PICKUP', fleetPartnerId: net.fleet.partnerId, vehicleId: net.fleet.vehicles.bus, driverId: net.fleet.driverId, waybills: [heavy.waybill],
    });
    expect(wrongVehicle.body.code).toBe('manifest_invalid');

    const man = await ctx.http.post('/v1/manifests').set(bearer(net.ops.token)).send({
      hubCode: 'HUB_BECORA', destMunicipalityCode: 'BCU', canal: 'CARGO_TRUCK_PICKUP', fleetPartnerId: net.fleet.partnerId, vehicleId: net.fleet.vehicles.truck, driverId: net.fleet.driverId, waybills: [heavy.waybill],
    });
    expect(man.status).toBe(201);
    await ctx.http.post(`/v1/manifests/${man.body.manifestCode}/ready`).set(bearer(net.ops.token)).send({});
    const ho = await ctx.http.post(`/v1/manifests/${man.body.manifestCode}/handover`).set(bearer(net.fleet.driver.token)).send({});
    expect(ho.status).toBe(200);
    expect((await ctx.http.post(`/v1/manifests/${man.body.manifestCode}/arrive`).set(bearer(net.fleet.driver.token))).body.status).toBe('ARRIVED');

    const fleetBefore = Number(await walletBalance(ctx, net.fleet.payable));
    const scan = await inboundScan(ctx, net.bcu.token, { code: heavy.waybill, condition: 'INTACT' });
    expect(scan.status).toBe(200);
    expect(scan.body.manifest.status).toBe('COMPLETED');
    // 15 kg cargo, Zone 2: $14.00 + 5 × $0.85 = $18.25 → fleet 40 % = $7.30
    expect(Number(await walletBalance(ctx, net.fleet.payable)) - fleetBefore).toBeCloseTo(7.3, 4);
  });

  it('a parcel on an active manifest cannot be manifested again; cancelled manifests free their parcels', async () => {
    const a = await agentIntake(ctx, net.dili, { destAgentId: net.bcu.agentId, weight: 12, dims: [30, 30, 30] });
    await hubReceive(ctx, net.ops.token, 'HUB_BECORA', [a.waybill]);
    const mk = () =>
      ctx.http.post('/v1/manifests').set(bearer(net.ops.token)).send({
        hubCode: 'HUB_BECORA', destMunicipalityCode: 'BCU', canal: 'CARGO_TRUCK_PICKUP', fleetPartnerId: net.fleet.partnerId, vehicleId: net.fleet.vehicles.truck, driverId: net.fleet.driverId, waybills: [a.waybill],
      });
    const first = await mk();
    expect(first.status).toBe(201);
    expect((await mk()).body.code).toBe('parcel_already_assigned');
    await ctx.http.post(`/v1/manifests/${first.body.manifestCode}/cancel`).set(bearer(net.ops.token));
    expect((await mk()).status).toBe(201);
  });

  describe('bus safety cap (DNTT / PNTL)', () => {
    it('blocks manifests above the configured baggage limits', async () => {
      const settings = ctx.app.get(SettingsService);
      const original = await ctx.prisma.systemSetting.findUniqueOrThrow({ where: { key: 'bus_capacity' } });
      const set = async (v: object) => {
        await ctx.prisma.systemSetting.update({ where: { key: 'bus_capacity' }, data: { value: v } });
        settings.invalidate();
      };
      try {
        const n = await createNetwork(ctx);
        const parcels = [await agentIntake(ctx, n.dili, { destAgentId: n.bcu.agentId }), await agentIntake(ctx, n.dili, { destAgentId: n.bcu.agentId }), await agentIntake(ctx, n.dili, { destAgentId: n.bcu.agentId })];
        await hubReceive(ctx, n.ops.token, 'HUB_BECORA', parcels.map((p) => p.waybill));
        const bag = await ctx.http.post('/v1/master-bags').set(bearer(n.ops.token)).send({ hubCode: 'HUB_BECORA', destMunicipalityCode: 'BCU' });
        for (const p of parcels) await ctx.http.post(`/v1/master-bags/${bag.body.bagCode}/items`).set(bearer(n.ops.token)).send({ waybill: p.waybill });
        await ctx.http.post(`/v1/master-bags/${bag.body.bagCode}/seal`).set(bearer(n.ops.token)).send({ plasticSealNumber: `PS-${randomUUID().slice(0, 8)}` });
        const body = { hubCode: 'HUB_BECORA', destMunicipalityCode: 'BCU', canal: 'BUS_BAGGAGE', fleetPartnerId: n.fleet.partnerId, vehicleId: n.fleet.vehicles.bus, driverId: n.fleet.driverId, masterBagCodes: [bag.body.bagCode] };

        await set({ maxSmallParcels: 2, maxMasterBags: 2 }); // 3 parcels > 2
        const tooMany = await ctx.http.post('/v1/manifests').set(bearer(n.ops.token)).set('X-Lang', 'pt').send(body);
        expect(tooMany.status).toBe(422);
        expect(tooMany.body.code).toBe('bus_capacity_exceeded');
        expect(tooMany.body.message).toContain('bagageira');

        await set({ maxSmallParcels: 20, maxMasterBags: 0 }); // no bags allowed at all
        expect((await ctx.http.post('/v1/manifests').set(bearer(n.ops.token)).send(body)).body.code).toBe('bus_capacity_exceeded');

        await set({ maxSmallParcels: 20, maxMasterBags: 2 });
        expect((await ctx.http.post('/v1/manifests').set(bearer(n.ops.token)).send(body)).status).toBe(201);
      } finally {
        await ctx.prisma.systemSetting.update({ where: { key: 'bus_capacity' }, data: { value: original.value as object } });
        settings.invalidate();
      }
    });
  });

  it('bagAndManifest helper sanity: the standard chain works for a fresh network', async () => {
    const n = await createNetwork(ctx);
    const a = await agentIntake(ctx, n.dili, { destAgentId: n.bcu.agentId });
    const r = await bagAndManifest(ctx, n, [a.waybill]);
    expect(r.manifestCode).toMatch(/^MF-/);
    expect((await driverHandover(ctx, n, r.manifestCode)).status).toBe(200);
  });
});
