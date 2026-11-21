import { bearer, createTestApp, type TestCtx } from './helpers';
import { createAgent, createCourier, createFleet, createNetwork, createStaff, inboundScan, shipInTransit, stagePhoto } from './scenario';

/** Endpoints added for the field PWA (agent / courier / driver app). */
describe('Field-app support: profile, kiosk list, driver incidents', () => {
  let ctx: TestCtx;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());

  describe('GET /v1/field/profile', () => {
    it('tells each field role where it works', async () => {
      const agent = await createAgent(ctx, 'BCU', '0');
      const a = await ctx.http.get('/v1/field/profile').set(bearer(agent.token));
      expect(a.status).toBe(200);
      expect(a.body).toMatchObject({ kind: 'AGENT', agentId: agent.agentId, municipality: { code: 'BCU', name: 'Baucau' } });
      expect(a.body.kioskName).toContain('Kios BCU');

      const courier = await createCourier(ctx, 'DIL', 'HUB_BECORA', '0');
      const c = await ctx.http.get('/v1/field/profile').set(bearer(courier.token));
      expect(c.body).toMatchObject({ kind: 'COURIER', courierId: courier.courierId, isAvailable: true, municipality: { code: 'DIL' }, hub: { code: 'HUB_BECORA' } });

      const fleet = await createFleet(ctx);
      const d = await ctx.http.get('/v1/field/profile').set(bearer(fleet.driver.token));
      expect(d.body).toMatchObject({ kind: 'DRIVER', driverId: fleet.driverId, fleetPartner: { id: fleet.partnerId } });
    });

    it('is for the field only: back-office staff get 403, anonymous 401, and nothing personal leaks', async () => {
      const staff = await createStaff(ctx, 'OPS_HUB_ADMIN');
      expect((await ctx.http.get('/v1/field/profile').set(bearer(staff.token))).status).toBe(403);
      expect((await ctx.http.get('/v1/field/profile')).status).toBe(401);
      const agent = await createAgent(ctx, 'DIL', '0');
      const body = JSON.stringify((await ctx.http.get('/v1/field/profile').set(bearer(agent.token))).body);
      expect(body).not.toMatch(/phone|pin|password|hash/i);
    });
  });

  describe('GET /v1/kiosks?municipalityCode=', () => {
    it('lists the ACTIVE kiosks of that municipality only, without phone numbers', async () => {
      const dili = await createAgent(ctx, 'DIL', '0');
      const bcuActive = await createAgent(ctx, 'BCU', '0');
      const bcuSuspended = await createAgent(ctx, 'BCU', '0');
      await ctx.prisma.agent.update({ where: { id: bcuSuspended.agentId }, data: { status: 'SUSPENDED' } });

      const res = await ctx.http.get('/v1/kiosks?municipalityCode=bcu').set(bearer(dili.token));
      expect(res.status).toBe(200);
      const ids = res.body.map((k: { id: string }) => k.id);
      expect(ids).toContain(bcuActive.agentId);
      expect(ids).not.toContain(bcuSuspended.agentId); // not accepting parcels
      expect(ids).not.toContain(dili.agentId); // other municipality
      expect(Object.keys(res.body[0]).sort()).toEqual(['address', 'agentCode', 'id', 'kioskName', 'openingHours']);
    });

    it('is available to everyone who can create shipments (agents, couriers) and nobody else; validates the code', async () => {
      const courier = await createCourier(ctx, 'DIL', 'HUB_BECORA', '0');
      expect((await ctx.http.get('/v1/kiosks?municipalityCode=BCU').set(bearer(courier.token))).status).toBe(200);
      const fleet = await createFleet(ctx);
      expect((await ctx.http.get('/v1/kiosks?municipalityCode=BCU').set(bearer(fleet.driver.token))).status).toBe(403);
      expect((await ctx.http.get('/v1/kiosks?municipalityCode=BCU')).status).toBe(401);
      const agent = await createAgent(ctx, 'DIL', '0');
      expect((await ctx.http.get('/v1/kiosks?municipalityCode=XXX').set(bearer(agent.token))).status).toBe(422);
      expect((await ctx.http.get('/v1/kiosks').set(bearer(agent.token))).status).toBe(422);
    });
  });

  describe('driver sees the incidents of their own trip', () => {
    it('manifest detail lists them with their ids, so the driver can confirm without incidents:read', async () => {
      const net = await createNetwork(ctx);
      const { parcels, bagCode, manifestCode } = await shipInTransit(ctx, net, 1);
      const before = await ctx.http.get(`/v1/manifests/${manifestCode}`).set(bearer(net.fleet.driver.token));
      expect(before.status).toBe(200);
      expect(before.body.incidents).toEqual([]);

      const photo = await stagePhoto(ctx, net.bcu.token, 'INBOUND_INCIDENT');
      const scan = await inboundScan(ctx, net.bcu.token, { code: bagCode, condition: 'WET', notes: 'Bag soaked', incidentPhotoUploadIds: [photo] });
      expect(scan.status).toBe(200);

      const detail = await ctx.http.get(`/v1/manifests/${manifestCode}`).set(bearer(net.fleet.driver.token));
      expect(detail.body.incidents).toEqual([
        { id: scan.body.incidents[0].id, waybill: parcels[0]!.waybill, condition: 'WET', status: 'OPEN', notes: 'Bag soaked', driverConfirmed: false },
      ]);
      // the driver cannot list incidents globally…
      expect((await ctx.http.get('/v1/incidents').set(bearer(net.fleet.driver.token))).status).toBe(403);
      // …but can confirm the one on their own trip, and the list reflects it
      const confirm = await ctx.http.post(`/v1/incidents/${detail.body.incidents[0].id}/driver-confirm`).set(bearer(net.fleet.driver.token));
      expect(confirm.status).toBe(200);
      const after = await ctx.http.get(`/v1/manifests/${manifestCode}`).set(bearer(net.fleet.driver.token));
      expect(after.body.incidents[0].driverConfirmed).toBe(true);
    });

    it('another driver cannot even open that manifest', async () => {
      const net = await createNetwork(ctx);
      const { manifestCode } = await shipInTransit(ctx, net, 1);
      const other = await createFleet(ctx);
      expect((await ctx.http.get(`/v1/manifests/${manifestCode}`).set(bearer(other.driver.token))).status).toBe(404);
    });
  });
});
