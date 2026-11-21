import { createTestApp, bearer, type TestCtx } from './helpers';
import {
  agentIntake,
  createAgent,
  createFleet,
  createNetwork,
  hubReceive,
  inboundScan,
  messagesTo,
  otpSentTo,
  stagePhoto,
  walletBalance,
  type Network,
} from './scenario';

describe('Fleet eligibility (MoU, DNTT, KIR, licence) and the Oecusse / Ataúro sea rule', () => {
  let ctx: TestCtx;
  let net: Network;
  beforeAll(async () => {
    ctx = await createTestApp();
    net = await createNetwork(ctx);
  });
  afterAll(() => ctx.close());

  const past = new Date(Date.now() - 3 * 86_400_000);

  async function parcelAtHub() {
    const p = await agentIntake(ctx, net.dili, { destAgentId: net.bcu.agentId, weight: 12, dims: [30, 30, 30] }); // cargo → loose on a truck
    await hubReceive(ctx, net.ops.token, 'HUB_BECORA', [p.waybill]);
    return p.waybill;
  }
  const manifestBody = (fleet: { partnerId: string; vehicles: { truck: string }; driverId: string }, waybill: string) => ({
    hubCode: 'HUB_BECORA', destMunicipalityCode: 'BCU', canal: 'CARGO_TRUCK_PICKUP', fleetPartnerId: fleet.partnerId, vehicleId: fleet.vehicles.truck, driverId: fleet.driverId, waybills: [waybill],
  });

  describe('a manifest cannot be built with an ineligible fleet', () => {
    const cases: Array<[string, Parameters<typeof createFleet>[1], string]> = [
      ['expired MoU', { mouValidUntil: past }, 'mou_expired'],
      ['no MoU date', { mouValidUntil: null }, 'mou_expired'],
      ['expired DNTT permit', { permitExpiry: past }, 'vehicle_permit_expired'],
      ['expired KIR inspection', { kirExpiry: past }, 'vehicle_permit_expired'],
      ['expired driving licence', { licenseExpiry: past }, 'driver_license_expired'],
      ['suspended partner', { status: 'SUSPENDED' }, 'partner_inactive'],
    ];
    for (const [name, opts, code] of cases) {
      it(name, async () => {
        const fleet = await createFleet(ctx, opts);
        const w = await parcelAtHub();
        const res = await ctx.http.post('/v1/manifests').set(bearer(net.ops.token)).send(manifestBody(fleet, w));
        expect(res.status).toBe(422);
        expect(res.body.code).toBe(code);
      });
    }

    it("a vehicle or driver from another company cannot be mixed in", async () => {
      const other = await createFleet(ctx);
      const w = await parcelAtHub();
      const res = await ctx.http.post('/v1/manifests').set(bearer(net.ops.token)).send({ ...manifestBody(net.fleet, w), vehicleId: other.vehicles.truck });
      expect(res.body.code).toBe('manifest_invalid');
    });

    it('permits that lapse AFTER drafting stop the trip at "ready" and at handover', async () => {
      const fleet = await createFleet(ctx);
      const w = await parcelAtHub();
      const man = await ctx.http.post('/v1/manifests').set(bearer(net.ops.token)).send(manifestBody(fleet, w));
      expect(man.status).toBe(201);
      await ctx.prisma.vehicle.update({ where: { id: fleet.vehicles.truck }, data: { kirExpiry: past } });
      const ready = await ctx.http.post(`/v1/manifests/${man.body.manifestCode}/ready`).set(bearer(net.ops.token)).send({});
      expect(ready.body.code).toBe('vehicle_permit_expired');
      await ctx.prisma.vehicle.update({ where: { id: fleet.vehicles.truck }, data: { kirExpiry: new Date(Date.now() + 86_400_000 * 100) } });
      expect((await ctx.http.post(`/v1/manifests/${man.body.manifestCode}/ready`).set(bearer(net.ops.token)).send({})).status).toBe(200);
      await ctx.prisma.fleetPartner.update({ where: { id: fleet.partnerId }, data: { mouValidUntil: past } });
      const ho = await ctx.http.post(`/v1/manifests/${man.body.manifestCode}/handover`).set(bearer(fleet.driver.token)).send({});
      expect(ho.body.code).toBe('mou_expired');
    });
  });

  describe('Oecusse (RAEOA) and Ataúro: sea manifest only — never by bus, never through Indonesian territory', () => {
    let seaAgent: Awaited<ReturnType<typeof createAgent>>;
    beforeAll(async () => {
      await ctx.prisma.agent.updateMany({ where: { municipality: { code: 'OEC' } }, data: { status: 'SUSPENDED' } });
      seaAgent = await createAgent(ctx, 'OEC', '0');
    });

    async function seaParcelAtPort() {
      const p = await agentIntake(ctx, net.dili, { dest: 'OEC', destAgentId: seaAgent.agentId });
      expect(p.res.status).toBe(201);
      expect(p.res.body.shipment.transportCanal).toBe('SEA_FERRY_CARGO');
      const r = await hubReceive(ctx, net.ops.token, 'HUB_DILI_PORT', [p.waybill]);
      expect(r.body.received).toEqual([p.waybill]);
      return p.waybill;
    }

    it('the port hub receives them; the Becora land hub refuses them', async () => {
      const p = await agentIntake(ctx, net.dili, { dest: 'OEC', destAgentId: seaAgent.agentId });
      const wrong = await hubReceive(ctx, net.ops.token, 'HUB_BECORA', [p.waybill]);
      expect(wrong.body.failed[0].code).toBe('wrong_hub');
    });

    it('a bus / truck manifest to Oecusse is refused with the compliance message, in every language', async () => {
      const w = await seaParcelAtPort();
      for (const [lang, fragment] of [['tet', 'Oecusse'], ['pt', 'Oecusse'], ['en', 'sea cargo'], ['id', 'kargo laut']] as const) {
        for (const canal of ['BUS_BAGGAGE', 'CARGO_TRUCK_PICKUP'] as const) {
          const res = await ctx.http.post('/v1/manifests').set(bearer(net.ops.token)).set('X-Lang', lang).send({
            hubCode: 'HUB_DILI_PORT', destMunicipalityCode: 'OEC', canal, fleetPartnerId: net.fleet.partnerId,
            vehicleId: canal === 'BUS_BAGGAGE' ? net.fleet.vehicles.bus : net.fleet.vehicles.truck, driverId: net.fleet.driverId, waybills: [w],
          });
          expect(res.status).toBe(422);
          expect(res.body.code).toBe('sea_route_bus_forbidden');
          expect(res.body.message).toContain(fragment);
        }
      }
    });

    it('a sea manifest needs a ferry vehicle and the official port manifest number, then runs end to end', async () => {
      const w = await seaParcelAtPort();
      const body = { hubCode: 'HUB_DILI_PORT', destMunicipalityCode: 'OEC', canal: 'SEA_FERRY_CARGO', fleetPartnerId: net.fleet.partnerId, driverId: net.fleet.driverId, waybills: [w] };

      const onBus = await ctx.http.post('/v1/manifests').set(bearer(net.ops.token)).send({ ...body, vehicleId: net.fleet.vehicles.bus });
      expect(onBus.body.code).toBe('manifest_invalid'); // a passenger bus is not a ferry

      const man = await ctx.http.post('/v1/manifests').set(bearer(net.ops.token)).send({ ...body, vehicleId: net.fleet.vehicles.ferry });
      expect(man.status).toBe(201);
      const noPort = await ctx.http.post(`/v1/manifests/${man.body.manifestCode}/ready`).set(bearer(net.ops.token)).send({});
      expect(noPort.body.code).toBe('manifest_invalid');
      const ready = await ctx.http.post(`/v1/manifests/${man.body.manifestCode}/ready`).set(bearer(net.ops.token)).send({ portManifestNo: 'PORT-2026-0142' });
      expect(ready.body).toMatchObject({ status: 'READY', portManifestNo: 'PORT-2026-0142' });

      // ferries need no bus-baggage photo
      expect((await ctx.http.post(`/v1/manifests/${man.body.manifestCode}/handover`).set(bearer(net.fleet.driver.token)).send({})).status).toBe(200);
      const fleetBefore = Number(await walletBalance(ctx, net.fleet.payable));
      const scan = await inboundScan(ctx, seaAgent.token, { code: w, condition: 'INTACT' });
      expect(scan.status).toBe(200);
      expect(scan.body.manifest.status).toBe('COMPLETED');
      expect(Number(await walletBalance(ctx, net.fleet.payable)) - fleetBefore).toBeCloseTo(3.2, 4); // 40 % of $8.00 (Oecusse)
      expect(otpSentTo(ctx, (await ctx.prisma.shipment.findUniqueOrThrow({ where: { waybillNumber: w } })).recipientPhone)).toMatch(/^\d{6}$/);
    });

    it('master bags work on the ferry too, but cannot mix bus and sea parcels', async () => {
      const sea = await seaParcelAtPort();
      const bag = await ctx.http.post('/v1/master-bags').set(bearer(net.ops.token)).send({ hubCode: 'HUB_DILI_PORT', destMunicipalityCode: 'OEC' });
      expect(bag.status).toBe(201);
      expect((await ctx.http.post(`/v1/master-bags/${bag.body.bagCode}/items`).set(bearer(net.ops.token)).send({ waybill: sea })).status).toBe(200);
      // a Baucau parcel can't go in an Oecusse bag
      const bcu = await agentIntake(ctx, net.dili, { destAgentId: net.bcu.agentId });
      await hubReceive(ctx, net.ops.token, 'HUB_BECORA', [bcu.waybill]);
      expect((await ctx.http.post(`/v1/master-bags/${bag.body.bagCode}/items`).set(bearer(net.ops.token)).send({ waybill: bcu.waybill })).status).toBe(422);
    });

    it('the database itself refuses a bus canal on a sea route (defence in depth)', async () => {
      const p = await agentIntake(ctx, net.dili, { dest: 'OEC', destAgentId: seaAgent.agentId });
      await expect(ctx.prisma.shipment.update({ where: { waybillNumber: p.waybill }, data: { transportCanal: 'BUS_BAGGAGE' } })).rejects.toThrow(/SEA_ROUTE_BUS_FORBIDDEN/);
    });
  });

  it('sanity: messages for fleet flows never leak the OTP to the sender', async () => {
    const { shipInTransit } = await import('./scenario');
    const n = await createNetwork(ctx);
    const { parcels, bagCode } = await shipInTransit(ctx, n, 1);
    await inboundScan(ctx, n.bcu.token, { code: bagCode, condition: 'INTACT' });
    expect(messagesTo(ctx, parcels[0]!.senderPhone).some((m) => /\*\d{6}\*/.test(m.body))).toBe(false);
    expect(messagesTo(ctx, parcels[0]!.recipientPhone).some((m) => /\*\d{6}\*/.test(m.body))).toBe(true);
    void stagePhoto;
  });
});
