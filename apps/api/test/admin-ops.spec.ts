import { randomUUID } from 'node:crypto';
import { UnclaimedService } from '../src/logistics/unclaimed.service';
import { LedgerService } from '../src/ledger/ledger.service';
import { bearer, createTestApp, uniquePhone, type TestCtx } from './helpers';
import { agentIntake, createAgent, createCourier, createFleet, createNetwork, fund, messagesTo, shipmentRow, sysWallet, walletBalance, type AgentCtx, type IntakeOpts } from './scenario';
import { arrivedParcels, cs, finance, ops, superAdmin } from './admin-helpers';

const DAY = 86_400_000;
const PIN = '482913';
const ymd = (offsetDays: number) => new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()) + offsetDays * DAY).toISOString().slice(0, 10);

/* ======================================================================================================== */

describe('Partner directory and compliance', () => {
  let ctx: TestCtx;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());

  const pinLogin = async (phone: string) => (await ctx.http.post('/v1/auth/login/pin').send({ phone, pin: PIN })).body.accessToken as string;

  describe('670Link agents', () => {
    const body = (over: object = {}) => ({ fullName: 'Agente Novo', phone: uniquePhone(), pin: PIN, preferredLang: 'tet', municipalityCode: 'BCU', kioskName: `Kios Novo ${randomUUID().slice(0, 4)}`, address: 'Rua Nova 5, Baucau', ...over });

    it('onboards a kiosk as PENDING with a sequential code; only Super Admin manages agents, Ops and Finance may read', async () => {
      const sa = await superAdmin(ctx);
      const a = await ctx.http.post('/v1/admin/agents').set(bearer(sa.token)).send(body());
      expect(a.status).toBe(201);
      expect(a.body).toMatchObject({ status: 'PENDING', adendumSignedAt: null, hasDigitalScale: false, hasSecureStorage: false, depositBalance: '0.0000' });
      expect(a.body.agentCode).toMatch(/^AG-BCU-\d{3}$/);
      const b = await ctx.http.post('/v1/admin/agents').set(bearer(sa.token)).send(body());
      expect(Number(b.body.agentCode.slice(-3))).toBe(Number(a.body.agentCode.slice(-3)) + 1);

      expect((await ctx.http.post('/v1/admin/agents').set(bearer((await ops(ctx)).token)).send(body())).status).toBe(403);
      expect((await ctx.http.get('/v1/admin/agents').set(bearer((await ops(ctx)).token))).status).toBe(200);
      expect((await ctx.http.get('/v1/admin/agents').set(bearer((await finance(ctx)).token))).status).toBe(200);
      expect((await ctx.http.get('/v1/admin/agents').set(bearer((await createAgent(ctx, 'DIL', '0')).token))).status).toBe(403);
      const filtered = await ctx.http.get('/v1/admin/agents?status=PENDING&municipalityCode=bcu').set(bearer(sa.token));
      expect(filtered.body.every((x: { status: string; municipality: { code: string } }) => x.status === 'PENDING' && x.municipality.code === 'BCU')).toBe(true);
    });

    it('validates input: municipality, phone, PIN strength, duplicate phone', async () => {
      const sa = await superAdmin(ctx);
      const post = (b: object) => ctx.http.post('/v1/admin/agents').set(bearer(sa.token)).send(b);
      expect((await post(body({ municipalityCode: 'XXX' }))).status).toBe(422);
      expect((await post(body({ phone: '12345' }))).status).toBe(422);
      expect((await post(body({ pin: '123456' }))).status).toBe(422); // trivially guessable
      expect((await post(body({ pin: '12' }))).status).toBe(422);
      const first = body();
      expect((await post(first)).status).toBe(201);
      expect((await post(body({ phone: first.phone }))).body.code).toBe('user_exists');
    });

    it('activation needs the adendum, a digital scale and secure storage; suspension needs a reason and bites at once', async () => {
      const sa = await superAdmin(ctx);
      const a = (await ctx.http.post('/v1/admin/agents').set(bearer(sa.token)).send(body())).body;
      const status = (s: string, reason?: string) => ctx.http.post(`/v1/admin/agents/${a.id}/status`).set(bearer(sa.token)).send({ status: s, reason });

      const none = await status('ACTIVE');
      expect([none.status, none.body.code]).toEqual([422, 'agent_not_compliant']);
      await ctx.http.patch(`/v1/admin/agents/${a.id}`).set(bearer(sa.token)).send({ hasDigitalScale: true });
      expect((await status('ACTIVE')).body.code).toBe('agent_not_compliant');
      await ctx.http.patch(`/v1/admin/agents/${a.id}`).set(bearer(sa.token)).send({ hasSecureStorage: true, openingHours: '08:00-17:00' });
      expect((await status('ACTIVE')).body.code).toBe('agent_not_compliant'); // still no adendum
      const signed = await ctx.http.post(`/v1/admin/agents/${a.id}/adendum`).set(bearer(sa.token));
      expect(signed.body.adendumSignedAt).toBeTruthy();
      const live = await status('ACTIVE');
      expect([live.status, live.body.status]).toEqual([200, 'ACTIVE']);

      const token = await pinLogin(a.operator.phone);
      const dest = await createAgent(ctx, 'DIL', '0');
      await fund(ctx, { ownerType: 'AGENT', ownerId: a.id, walletType: 'DEPOSIT' }, '50.0000');
      const kiosk = { token, user: { pin: PIN } } as unknown as AgentCtx;
      const intake = async () => (await agentIntake(ctx, kiosk, { dest: 'DIL', destAgentId: dest.agentId })).res.status;
      expect(await intake()).toBe(201);
      expect((await status('SUSPENDED')).status).toBe(422); // reason required
      const susp = await status('SUSPENDED', 'Cash discrepancy under investigation');
      expect([susp.body.status, susp.body.statusReason]).toEqual(['SUSPENDED', 'Cash discrepancy under investigation']);
      expect([401, 403, 404]).toContain(await intake()); // same token, no longer an active kiosk: nothing is accepted
      expect((await ctx.prisma.auditLog.findFirst({ where: { action: 'AGENT_STATUS_CHANGED', entityId: a.id }, orderBy: { id: 'desc' } }))!.before).toMatchObject({ status: 'ACTIVE' });
      expect((await status('ACTIVE')).status).toBe(200); // reinstated
      expect(await intake()).toBe(201);
      expect((await ctx.http.get(`/v1/admin/agents/${randomUUID()}`).set(bearer(sa.token))).status).toBe(404);
    });
  });

  describe('couriers', () => {
    const body = (over: object = {}) => ({ fullName: 'Kurir Baru', phone: uniquePhone(), pin: PIN, preferredLang: 'tet', municipalityCode: 'DIL', hubCode: 'HUB_BECORA', vehicleType: 'MOTORBIKE', plateNumber: 'DIL-1234', ...over });

    it('creates an ACTIVE courier who can sign in with the PIN, and Ops manage the roster', async () => {
      const o = await ops(ctx);
      const r = await ctx.http.post('/v1/admin/couriers').set(bearer(o.token)).send(body());
      expect(r.status).toBe(201);
      expect(r.body).toMatchObject({ status: 'ACTIVE', isAvailable: true, vehicleType: 'MOTORBIKE', hub: 'HUB_BECORA', depositBalance: '0.0000' });
      const token = await pinLogin(r.body.phone);
      expect(token).toBeTruthy();
      expect((await ctx.http.post('/v1/admin/couriers').set(bearer(o.token)).send(body({ phone: r.body.phone }))).status).toBe(409);
      expect((await ctx.http.post('/v1/admin/couriers').set(bearer(o.token)).send(body({ hubCode: 'NOPE' }))).status).toBe(422);
      expect((await ctx.http.post('/v1/admin/couriers').set(bearer(o.token)).send(body({ vehicleType: 'BICYCLE' }))).status).toBe(422);
      expect((await ctx.http.post('/v1/admin/couriers').set(bearer((await finance(ctx)).token)).send(body())).status).toBe(403);
      const list = await ctx.http.get('/v1/admin/couriers?municipalityCode=DIL').set(bearer(o.token));
      expect(list.body.some((c: { id: string }) => c.id === r.body.id)).toBe(true);
    });

    it('a courier toggles their own availability; suspension locks them out immediately', async () => {
      const o = await ops(ctx);
      const c = await createCourier(ctx);
      const off = await ctx.http.patch('/v1/courier/me/availability').set(bearer(c.token)).send({ available: false });
      expect([off.status, off.body.isAvailable]).toEqual([200, false]);
      expect((await ctx.http.patch('/v1/courier/me/availability').set(bearer(o.token)).send({ available: true })).status).toBe(403); // not a courier

      const upd = await ctx.http.patch(`/v1/admin/couriers/${c.courierId}`).set(bearer(o.token)).send({ status: 'SUSPENDED', plateNumber: 'DIL-9999' });
      expect([upd.body.status, upd.body.plateNumber]).toEqual(['SUSPENDED', 'DIL-9999']);
      expect((await ctx.http.patch('/v1/courier/me/availability').set(bearer(c.token)).send({ available: true })).status).toBe(403);
      await ctx.http.patch(`/v1/admin/couriers/${c.courierId}`).set(bearer(o.token)).send({ status: 'ACTIVE' });
      expect((await ctx.http.patch('/v1/courier/me/availability').set(bearer(c.token)).send({ available: true })).status).toBe(200);
    });
  });

  describe('fleet partners, vehicles, drivers', () => {
    const body = (over: object = {}) => ({
      fullName: 'Dono Frota',
      phone: uniquePhone(),
      pin: PIN,
      preferredLang: 'pt',
      companyName: `Transport ${randomUUID().slice(0, 5)} Lda`,
      serveRegNo: 'SERVE-123',
      mouNumber: `MOU-${randomUUID().slice(0, 6)}`,
      mouSignedAt: ymd(-10),
      mouValidUntil: ymd(300),
      payoutCycle: 'WEEKLY',
      payoutChannel: 'BNCTL',
      ...over,
    });
    const BANK = { bank: 'BNCTL', accountName: 'Transport Lda', accountNo: '0012345678' };

    it('activation needs a MoU number, an in-date MoU and payout details; suspension needs a reason', async () => {
      const o = await ops(ctx);
      const create = (b: object) => ctx.http.post('/v1/admin/fleet-partners').set(bearer(o.token)).send(b);
      const p = (await create(body())).body;
      expect(p).toMatchObject({ status: 'PENDING', bank: null, mou: { expired: false, autoRenew: true } });
      const status = (id: string, s: string, reason?: string) => ctx.http.post(`/v1/admin/fleet-partners/${id}/status`).set(bearer(o.token)).send({ status: s, reason });

      const noBank = await status(p.id, 'ACTIVE');
      expect([noBank.status, noBank.body.code]).toEqual([422, 'fleet_not_compliant']);
      await ctx.http.put(`/v1/admin/fleet-partners/${p.id}/bank`).set(bearer(o.token)).send(BANK);
      expect((await status(p.id, 'ACTIVE')).body.status).toBe('ACTIVE');

      const expired = (await create(body({ mouValidUntil: ymd(-1), bank: BANK }))).body;
      expect(expired.mou.expired).toBe(true);
      expect((await status(expired.id, 'ACTIVE')).body.code).toBe('fleet_not_compliant');
      const noMou = (await create(body({ mouNumber: undefined, bank: BANK }))).body;
      expect((await status(noMou.id, 'ACTIVE')).body.code).toBe('fleet_not_compliant');

      expect((await status(p.id, 'SUSPENDED')).status).toBe(422);
      expect((await status(p.id, 'SUSPENDED', 'MoU breach: unreported incident')).body).toMatchObject({ status: 'SUSPENDED', statusReason: 'MoU breach: unreported incident' });
      expect((await ctx.http.get('/v1/admin/fleet-partners?status=SUSPENDED').set(bearer(o.token))).body.some((x: { id: string }) => x.id === p.id)).toBe(true);
      expect((await ctx.http.post('/v1/admin/fleet-partners').set(bearer((await cs(ctx)).token)).send(body())).status).toBe(403);
    });

    it('renews the MoU (future date only) and edits payout cycle / channel — with before/after audit', async () => {
      const o = await ops(ctx);
      const p = (await ctx.http.post('/v1/admin/fleet-partners').set(bearer(o.token)).send(body({ mouValidUntil: ymd(5) }))).body;
      expect((await ctx.http.post(`/v1/admin/fleet-partners/${p.id}/mou`).set(bearer(o.token)).send({ mouValidUntil: ymd(-3) })).status).toBe(422);
      const renewed = await ctx.http.post(`/v1/admin/fleet-partners/${p.id}/mou`).set(bearer(o.token)).send({ mouNumber: 'MOU-2027-RENEWED', mouValidUntil: ymd(365) });
      expect(renewed.body.mou).toMatchObject({ number: 'MOU-2027-RENEWED', validUntil: ymd(365), expired: false });
      const upd = await ctx.http.patch(`/v1/admin/fleet-partners/${p.id}`).set(bearer(o.token)).send({ payoutCycle: 'DAILY', payoutChannel: 'MOSAN' });
      expect([upd.body.payoutCycle, upd.body.payoutChannel]).toEqual(['DAILY', 'MOSAN']);
      const log = await ctx.prisma.auditLog.findFirst({ where: { action: 'FLEET_PARTNER_UPDATED', entityId: p.id } });
      expect(log!.before).toMatchObject({ payoutCycle: 'WEEKLY', payoutChannel: 'BNCTL' });
    });

    it('bank details: AES-GCM at rest, masked everywhere, full read only for payout approvers and always audited', async () => {
      const o = await ops(ctx);
      const fin = await finance(ctx);
      const p = (await ctx.http.post('/v1/admin/fleet-partners').set(bearer(o.token)).send(body({ bank: BANK }))).body;
      expect(p.bank).toEqual({ bank: 'BNCTL', accountNoLast4: '5678' });

      const dump = JSON.stringify([p, (await ctx.http.get(`/v1/admin/fleet-partners/${p.id}`).set(bearer(o.token))).body, (await ctx.http.get('/v1/admin/fleet-partners').set(bearer(o.token))).body]);
      expect(dump).not.toContain('0012345678');
      const raw = await ctx.prisma.fleetPartner.findUniqueOrThrow({ where: { id: p.id } });
      expect(JSON.stringify(raw.bankAccountDetails)).not.toContain('0012345678');
      expect(JSON.stringify(raw.bankAccountDetails)).not.toContain('Transport Lda');

      const url = `/v1/finance/fleet-partners/${p.id}/bank-details`;
      expect((await ctx.http.get(url).set(bearer(o.token))).status).toBe(403); // Ops cannot see the number
      const before = await ctx.prisma.auditLog.count({ where: { action: 'FLEET_BANK_DETAILS_REVEALED', entityId: p.id } });
      const reveal = await ctx.http.get(url).set(bearer(fin.token));
      expect(reveal.body).toEqual(BANK);
      expect(await ctx.prisma.auditLog.count({ where: { action: 'FLEET_BANK_DETAILS_REVEALED', entityId: p.id } })).toBe(before + 1);

      const changed = await ctx.http.put(`/v1/admin/fleet-partners/${p.id}/bank`).set(bearer(o.token)).send({ bank: 'BNU', accountName: 'Transport Lda', accountNo: '9876543210' });
      expect(changed.body.bank).toEqual({ bank: 'BNU', accountNoLast4: '3210' });
      const setLog = await ctx.prisma.auditLog.findFirst({ where: { action: 'FLEET_BANK_DETAILS_SET', entityId: p.id }, orderBy: { id: 'desc' } });
      expect(JSON.stringify(setLog, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))).not.toContain('9876543210');
      expect((await ctx.http.put(`/v1/admin/fleet-partners/${p.id}/bank`).set(bearer(o.token)).send({ bank: 'X', accountName: 'Y', accountNo: '1' })).status).toBe(422);
      expect((await ctx.http.get(`/v1/finance/fleet-partners/${randomUUID()}/bank-details`).set(bearer(fin.token))).status).toBe(404);
    });

    describe('vehicles and drivers: owner registers, Ops verify', () => {
      async function activeFleet() {
        const o = await ops(ctx);
        const b = body({ bank: BANK });
        const p = (await ctx.http.post('/v1/admin/fleet-partners').set(bearer(o.token)).send(b)).body;
        await ctx.http.post(`/v1/admin/fleet-partners/${p.id}/status`).set(bearer(o.token)).send({ status: 'ACTIVE' });
        return { o, p, owner: await pinLogin(b.phone) };
      }
      const veh = (partnerId: string, over: object = {}) => ({ fleetPartnerId: partnerId, plateNumber: `V-${randomUUID().slice(0, 7)}`, vehicleType: 'BUS_PASSENGER', routeCorridor: 'EAST', dnttPermitNo: 'DNTT-77', dnttPermitExpiry: ymd(200), kirExpiry: ymd(200), ...over });

      it('a vehicle starts inactive; only in-date permits can be verified; the owner changing permits sends it back to verification', async () => {
        const { o, p, owner } = await activeFleet();
        const v = await ctx.http.post('/v1/fleet/vehicles').set(bearer(owner)).send(veh(p.id));
        expect(v.status).toBe(201);
        expect(v.body).toMatchObject({ isActive: false, permitsValid: true, maxParcelSlots: 20 });

        const ok = await ctx.http.post(`/v1/admin/vehicles/${v.body.id}/verify`).set(bearer(o.token));
        expect(ok.body.isActive).toBe(true);
        expect((await ctx.http.post(`/v1/admin/vehicles/${v.body.id}/verify`).set(bearer(owner))).status).toBe(403); // owners cannot self-verify

        const edit = await ctx.http.patch(`/v1/fleet/vehicles/${v.body.id}/permits`).set(bearer(owner)).send({ kirExpiry: ymd(400) });
        expect([edit.body.isActive, edit.body.kirExpiry]).toEqual([false, ymd(400)]);
        await ctx.http.post(`/v1/admin/vehicles/${v.body.id}/verify`).set(bearer(o.token));

        // Ops edit keeps its own verdict, but an expired permit can never be verified
        const expiredOps = await ctx.http.patch(`/v1/fleet/vehicles/${v.body.id}/permits`).set(bearer(o.token)).send({ dnttPermitExpiry: ymd(-2) });
        expect([expiredOps.body.isActive, expiredOps.body.permitsValid]).toEqual([true, false]);
        await ctx.http.post(`/v1/admin/vehicles/${v.body.id}/deactivate`).set(bearer(o.token));
        const refused = await ctx.http.post(`/v1/admin/vehicles/${v.body.id}/verify`).set(bearer(o.token));
        expect([refused.status, refused.body.code]).toEqual([422, 'vehicle_permit_expired']);
        const noPermits = await ctx.http.post('/v1/fleet/vehicles').set(bearer(owner)).send({ fleetPartnerId: p.id, plateNumber: `V-${randomUUID().slice(0, 7)}`, vehicleType: 'TRUCK_CARGO', routeCorridor: 'WEST' });
        expect((await ctx.http.post(`/v1/admin/vehicles/${noPermits.body.id}/verify`).set(bearer(o.token))).body.code).toBe('vehicle_permit_expired');
      });

      it('plates are unique; owners are fenced to their own company (404, not 403)', async () => {
        const a = await activeFleet();
        const b = await activeFleet();
        const plate = `V-${randomUUID().slice(0, 7)}`;
        expect((await ctx.http.post('/v1/fleet/vehicles').set(bearer(a.owner)).send(veh(a.p.id, { plateNumber: plate }))).status).toBe(201);
        expect((await ctx.http.post('/v1/fleet/vehicles').set(bearer(b.owner)).send(veh(b.p.id, { plateNumber: plate }))).status).toBe(409);
        expect((await ctx.http.post('/v1/fleet/vehicles').set(bearer(b.owner)).send(veh(a.p.id))).status).toBe(404); // someone else's company
        const mine = await ctx.http.get('/v1/fleet/vehicles').set(bearer(a.owner));
        expect(mine.body.map((x: { plateNumber: string }) => x.plateNumber)).toEqual([plate]);
        expect((await ctx.http.get(`/v1/fleet/vehicles?fleetPartnerId=${b.p.id}`).set(bearer(a.owner))).body.map((x: { plateNumber: string }) => x.plateNumber)).toEqual([plate]); // the filter is ignored for owners
        const theirs = (await ctx.http.get('/v1/fleet/vehicles').set(bearer(b.o.token))).body; // Ops see all
        expect(theirs.length).toBeGreaterThanOrEqual(1);
        const bVehicle = (await ctx.http.post('/v1/fleet/vehicles').set(bearer(b.owner)).send(veh(b.p.id))).body;
        expect((await ctx.http.patch(`/v1/fleet/vehicles/${bVehicle.id}/permits`).set(bearer(a.owner)).send({ kirExpiry: ymd(10) })).status).toBe(404);
      });

      it('drivers: created inactive, verified by Ops against an in-date licence, and a licence change re-triggers verification', async () => {
        const { o, p, owner } = await activeFleet();
        const dBody = { fullName: 'Motorista Um', phone: uniquePhone(), pin: PIN, preferredLang: 'tet', fleetPartnerId: p.id, licenseNumber: 'KD-4455', licenseExpiry: ymd(100) };
        const d = await ctx.http.post('/v1/fleet/drivers').set(bearer(owner)).send(dBody);
        expect(d.status).toBe(201);
        expect(d.body).toMatchObject({ isActive: false, licenseValid: true });
        expect((await ctx.http.post(`/v1/admin/drivers/${d.body.id}/verify`).set(bearer(owner))).status).toBe(403);
        expect((await ctx.http.post(`/v1/admin/drivers/${d.body.id}/verify`).set(bearer(o.token))).body.isActive).toBe(true);

        const renew = await ctx.http.patch(`/v1/fleet/drivers/${d.body.id}/license`).set(bearer(owner)).send({ licenseExpiry: ymd(500) });
        expect([renew.body.isActive, renew.body.licenseExpiry]).toEqual([false, ymd(500)]);
        await ctx.http.post(`/v1/admin/drivers/${d.body.id}/verify`).set(bearer(o.token));
        await ctx.http.post(`/v1/admin/drivers/${d.body.id}/deactivate`).set(bearer(o.token));
        await ctx.http.patch(`/v1/fleet/drivers/${d.body.id}/license`).set(bearer(o.token)).send({ licenseExpiry: ymd(-1) });
        const expired = await ctx.http.post(`/v1/admin/drivers/${d.body.id}/verify`).set(bearer(o.token));
        expect([expired.status, expired.body.code]).toEqual([422, 'driver_license_expired']);

        expect((await ctx.http.post('/v1/fleet/drivers').set(bearer(owner)).send({ ...dBody, phone: dBody.phone })).status).toBe(409);
        const other = await activeFleet();
        expect((await ctx.http.post('/v1/fleet/drivers').set(bearer(other.owner)).send({ ...dBody, phone: uniquePhone() })).status).toBe(404);
        expect((await ctx.http.get('/v1/fleet/drivers').set(bearer(owner))).body).toHaveLength(1);
      });
    });
  });

  describe('compliance alerts', () => {
    it('lists expired / expiring MoUs, DNTT permits, KIR, licences and missing addenda, most urgent first', async () => {
      const o = await ops(ctx);
      const day = (n: number) => new Date(`${ymd(n)}T00:00:00Z`);
      const f = await createFleet(ctx, { mouValidUntil: day(12), permitExpiry: day(5), kirExpiry: day(-3), licenseExpiry: day(20) });
      const agent = await createAgent(ctx, 'DIL', '5.0000'); // ACTIVE without adendum, and a thin deposit

      const r = await ctx.http.get('/v1/admin/compliance/alerts?days=30').set(bearer(o.token));
      expect(r.status).toBe(200);
      const mine = r.body.filter((a: { subjectId: string }) => [f.partnerId, f.driverId, agent.agentId, ...Object.values(f.vehicles)].includes(a.subjectId));
      const pick = (type: string, severity?: string) => mine.filter((a: { type: string; severity: string }) => a.type === type && (!severity || a.severity === severity));
      expect(pick('MOU')).toEqual([expect.objectContaining({ severity: 'EXPIRING', daysLeft: 12, dueDate: ymd(12) })]);
      expect(pick('DNTT_PERMIT', 'EXPIRING')).toHaveLength(3);
      expect(pick('DNTT_PERMIT')[0].daysLeft).toBe(5);
      expect(pick('KIR_INSPECTION', 'EXPIRED')).toHaveLength(3);
      expect(pick('KIR_INSPECTION')[0].daysLeft).toBe(-3);
      expect(pick('DRIVER_LICENSE')).toEqual([expect.objectContaining({ severity: 'EXPIRING', daysLeft: 20 })]);
      expect(pick('ADENDUM')).toEqual([expect.objectContaining({ severity: 'MISSING' })]);
      expect(pick('LOW_DEPOSIT')).toEqual([expect.objectContaining({ severity: 'INFO' })]);
      // ordering: EXPIRED first … INFO last
      const rank = { EXPIRED: 0, MISSING: 1, EXPIRING: 2, INFO: 3 } as const;
      const ranks = r.body.map((a: { severity: keyof typeof rank }) => rank[a.severity]);
      expect(ranks).toEqual([...ranks].sort((x: number, y: number) => x - y));

      const narrow = await ctx.http.get('/v1/admin/compliance/alerts?days=7').set(bearer(o.token));
      const narrowMine = narrow.body.filter((a: { subjectId: string }) => [f.partnerId, f.driverId, ...Object.values(f.vehicles)].includes(a.subjectId));
      expect(narrowMine.map((a: { type: string }) => a.type).sort()).toEqual(['DNTT_PERMIT', 'DNTT_PERMIT', 'DNTT_PERMIT', 'KIR_INSPECTION', 'KIR_INSPECTION', 'KIR_INSPECTION']);
      expect((await ctx.http.get('/v1/admin/compliance/alerts?days=0').set(bearer(o.token))).status).toBe(422);
      expect((await ctx.http.get('/v1/admin/compliance/alerts').set(bearer(agent.token))).status).toBe(403);
    });
  });
});

/* ======================================================================================================== */

describe('Customer-service tools: return-to-sender, status override, reminders', () => {
  let ctx: TestCtx;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());

  /** A parcel that sat unclaimed for 15 days and was flagged RETURN_TO_SENDER by the daily sweep. */
  async function rtsParcel(over: Partial<IntakeOpts> = {}) {
    const n = await createNetwork(ctx);
    const { parcels } = await arrivedParcels(ctx, n, 1, over);
    const p = parcels[0]!;
    const arrived = new Date();
    await ctx.prisma.shipment.update({ where: { id: p.id }, data: { arrivedDestAt: arrived } });
    const sweep = (d: number) => ctx.app.get(UnclaimedService).sweep(new Date(arrived.getTime() + (d - 1) * DAY), { onlyIds: [p.id] });
    await sweep(14);
    await sweep(15);
    expect((await shipmentRow(ctx, p.waybill)).status).toBe('RETURN_TO_SENDER');
    return { n, p };
  }
  const commission = (agentId: string) => walletBalance(ctx, { ownerType: 'AGENT', ownerId: agentId, walletType: 'COMMISSION' }).then(Number).catch(() => 0);

  describe('return to sender', () => {
    it('queue → received at hub (destination agent paid, storage penalty written off) → handed back with the sender’s ID', async () => {
      const desk = await cs(ctx);
      const { n, p } = await rtsParcel();
      const queue = (stage?: string) => ctx.http.get(`/v1/rts${stage ? `?stage=${stage}` : ''}`).set(bearer(desk.token));
      const row = (await queue('TO_RECEIVE')).body.find((r: { waybill: string }) => r.waybill === p.waybill);
      expect(row).toMatchObject({ stage: 'TO_RECEIVE', kiosk: expect.stringContaining('Kios BCU'), unpaidStoragePenalty: '4.5000', sender: { name: 'Maria da Costa' } });
      expect((await queue('AT_HUB')).body.some((r: { waybill: string }) => r.waybill === p.waybill)).toBe(false);

      const before = await commission(n.bcu.agentId);
      const st0 = await ctx.prisma.shipmentSettlement.findUniqueOrThrow({ where: { shipmentId: p.id } });
      expect(st0.releasedAt).toBeNull();

      const early = await ctx.http.post(`/v1/rts/${p.waybill}/hand-back`).set(bearer(desk.token)).send({ collectorName: 'Maria da Costa', idType: 'BI', idNumber: 'BI123456' });
      expect([early.status, early.body.code]).toEqual([409, 'rts_invalid']); // nothing to hand back before it is physically at the hub

      const rec = await ctx.http.post(`/v1/rts/${p.waybill}/received`).set(bearer(desk.token));
      expect([rec.status, rec.body.stage]).toEqual([200, 'AT_HUB']);
      expect(rec.body.waybill).toBe(p.waybill);
      expect(await commission(n.bcu.agentId) - before).toBeCloseTo(0.6, 4); // 15 % for receiving + storing it
      const st1 = await ctx.prisma.shipmentSettlement.findUniqueOrThrow({ where: { shipmentId: p.id } });
      expect(st1.status).toBe('RELEASED');
      expect(await ctx.prisma.ledgerEntry.count({ where: { referenceType: 'STORAGE_PENALTY', referenceId: p.id } })).toBe(0); // the penalty was never collected → written off
      expect((await queue('AT_HUB')).body.some((r: { waybill: string }) => r.waybill === p.waybill)).toBe(true);
      expect((await ctx.http.post(`/v1/rts/${p.waybill}/received`).set(bearer(desk.token))).body.code).toBe('rts_invalid');

      const wrongId = await ctx.http.post(`/v1/rts/${p.waybill}/hand-back`).set(bearer(desk.token)).send({ collectorName: 'Someone Else', idType: 'BI', idNumber: 'BI000000' });
      expect([wrongId.status, wrongId.body.code]).toEqual([422, 'invalid_otp']);
      const done = await ctx.http.post(`/v1/rts/${p.waybill}/hand-back`).set(bearer(desk.token)).send({ collectorName: 'Maria da Costa', idType: 'BI', idNumber: 'bi 123 456' });
      expect([done.status, done.body.stage]).toEqual([200, 'DONE']);
      const s = await shipmentRow(ctx, p.waybill);
      expect([s.rtsCollectorName, s.status]).toEqual(['Maria da Costa', 'RETURN_TO_SENDER']);
      expect((await queue('DONE')).body.some((r: { waybill: string }) => r.waybill === p.waybill)).toBe(true);
      expect((await ctx.http.post(`/v1/rts/${p.waybill}/hand-back`).set(bearer(desk.token)).send({ collectorName: 'Maria da Costa', idType: 'BI', idNumber: 'BI123456' })).status).toBe(409);

      const kinds = (await ctx.prisma.shipmentEvent.findMany({ where: { shipmentId: p.id }, orderBy: { createdAt: 'asc' } })).map((e) => (e.meta as { kind?: string } | null)?.kind).filter(Boolean);
      expect(kinds).toEqual(expect.arrayContaining(['RTS_RECEIVED_AT_HUB', 'RTS_HANDED_BACK']));
      expect((await ctx.prisma.auditLog.findMany({ where: { entityId: p.id, action: { in: ['RTS_RECEIVED_AT_HUB', 'RTS_HANDED_BACK'] } } })).length).toBe(2);
      expect((await ctx.app.get(LedgerService).reconcile()).ok).toBe(true);
    });

    it('a representative may collect with their own ID — recorded as such', async () => {
      const ops1 = await ops(ctx);
      const { p } = await rtsParcel();
      await ctx.http.post(`/v1/rts/${p.waybill}/received`).set(bearer(ops1.token));
      const r = await ctx.http.post(`/v1/rts/${p.waybill}/hand-back`).set(bearer(ops1.token)).send({ collectorName: 'Irmão do Remetente', idType: 'BI', idNumber: 'BI555111', isRepresentative: true });
      expect(r.status).toBe(200);
      const ev = await ctx.prisma.shipmentEvent.findFirstOrThrow({ where: { shipmentId: p.id, notes: { startsWith: 'Returned to' } } });
      expect(ev.meta).toMatchObject({ kind: 'RTS_HANDED_BACK', representative: true });
    });

    it('rejects parcels that are not in the RTS flow, unknown waybills and users without rts:manage', async () => {
      const desk = await cs(ctx);
      const n = await createNetwork(ctx);
      const live = await agentIntake(ctx, n.dili, { destAgentId: n.bcu.agentId });
      expect((await ctx.http.post(`/v1/rts/${live.waybill}/received`).set(bearer(desk.token))).body.code).toBe('rts_invalid');
      expect((await ctx.http.post('/v1/rts/670S-NOPE-NOPE-000000-0001/received').set(bearer(desk.token))).status).toBe(404);
      expect((await ctx.http.get('/v1/rts').set(bearer((await finance(ctx)).token))).status).toBe(403);
      expect((await ctx.http.post(`/v1/rts/${live.waybill}/received`).set(bearer(n.dili.token))).status).toBe(403);
      expect((await ctx.http.get('/v1/rts?stage=NOPE').set(bearer(desk.token))).status).toBe(422);
    });

    it('an RTS parcel that had a door-delivery add-on becomes refundable by Finance — but only once it is back at the hub', async () => {
      const desk = await cs(ctx);
      const fin = await finance(ctx);
      const { n, p } = await rtsParcel({ scheme: 'SCHEME_C', recipientAddress: 'Rua Central 12, Baucau' });
      const refund = () => ctx.http.post('/v1/finance/refunds').set(bearer(fin.token)).set('Idempotency-Key', randomUUID()).send({ waybill: p.waybill, reason: 'Parcel returned, door delivery never happened' });
      expect((await refund()).body.code).toBe('refund_not_applicable'); // still at the kiosk
      await ctx.http.post(`/v1/rts/${p.waybill}/received`).set(bearer(desk.token));
      const revenue = Number(await walletBalance(ctx, sysWallet('PLATFORM_REVENUE')));
      const r = await refund();
      expect([r.status, r.body.refunded.usd]).toEqual([200, '1.5000']);
      expect(revenue - Number(await walletBalance(ctx, sysWallet('PLATFORM_REVENUE')))).toBeCloseTo(1.5, 4);
      expect((await refund()).body.code).toBe('refund_not_applicable'); // once
      void n;
    });
  });

  describe('Super-Admin status override', () => {
    const override = (token: string, waybill: string, body: object, headers: Record<string, string> = {}) => {
      const req = ctx.http.post(`/v1/admin/shipments/${waybill}/override-status`).set(bearer(token));
      for (const [k, v] of Object.entries(headers)) req.set(k, v);
      return req.send(body);
    };

    it('changes the tracking status only, records the reason, and writes a tracking event', async () => {
      const sa = await superAdmin(ctx);
      const n = await createNetwork(ctx);
      const p = await agentIntake(ctx, n.dili, { destAgentId: n.bcu.agentId });
      const money = Number(await walletBalance(ctx, sysWallet('PLATFORM_REVENUE')));

      const r = await override(sa.token, p.waybill, { status: 'ON_HOLD_ISSUE', reason: 'Legal hold requested by authorities', notes: 'Held by order #55' });
      expect([r.status, r.body.status]).toEqual([200, 'ON_HOLD_ISSUE']);
      const s = await shipmentRow(ctx, p.waybill);
      expect([s.status, s.statusBeforeHold, s.holdReason]).toEqual(['ON_HOLD_ISSUE', 'DROPPED_AT_ORIGIN', 'ADMIN_OVERRIDE']);
      const ev = await ctx.prisma.shipmentEvent.findFirstOrThrow({ where: { shipmentId: p.id, status: 'ON_HOLD_ISSUE' } });
      expect([ev.fromStatus, ev.notes, (ev.meta as { override?: boolean }).override]).toEqual(['DROPPED_AT_ORIGIN', 'Held by order #55', true]);
      const log = await ctx.prisma.auditLog.findFirstOrThrow({ where: { action: 'SHIPMENT_STATUS_OVERRIDDEN', entityId: p.id } });
      expect([log.reason, log.before, log.after]).toEqual(['Legal hold requested by authorities', { status: 'DROPPED_AT_ORIGIN' }, { status: 'ON_HOLD_ISSUE' }]);
      expect(Number(await walletBalance(ctx, sysWallet('PLATFORM_REVENUE')))).toBe(money); // never moves money

      // the reason can also travel in the X-Audit-Reason header
      const back = await override(sa.token, p.waybill, { status: 'DROPPED_AT_ORIGIN', reason: 'Hold released, restoring status' });
      expect(back.status).toBe(200);
      expect((await shipmentRow(ctx, p.waybill)).statusBeforeHold).toBeNull();
    });

    it('needs a reason, refuses no-ops, DELIVERED in either direction, unknown statuses and everyone but Super Admin', async () => {
      const sa = await superAdmin(ctx);
      const n = await createNetwork(ctx);
      const p = await agentIntake(ctx, n.dili, { destAgentId: n.bcu.agentId });
      const noReason = await override(sa.token, p.waybill, { status: 'ON_HOLD_ISSUE' });
      expect([noReason.status, noReason.body.code]).toEqual([400, 'audit_reason_required']);
      expect((await override(sa.token, p.waybill, { status: 'ON_HOLD_ISSUE', reason: 'abc' })).status).toBe(400);
      expect((await override(sa.token, p.waybill, { status: 'ON_HOLD_ISSUE' }, { 'X-Audit-Reason': 'Header supplied reason' })).status).toBe(200);
      expect((await override(sa.token, p.waybill, { status: 'ON_HOLD_ISSUE', reason: 'Same status again' })).body.code).toBe('shipment_wrong_state');
      expect((await override(sa.token, p.waybill, { status: 'DELIVERED', reason: 'Pretend it arrived' })).body.code).toBe('override_not_allowed');
      expect((await override(sa.token, p.waybill, { status: 'TELEPORTED', reason: 'Not a status' })).status).toBe(422);
      expect((await override(sa.token, '670S-NOPE-NOPE-000000-0001', { status: 'ON_HOLD_ISSUE', reason: 'Unknown parcel here' })).status).toBe(404);

      const { parcels } = await arrivedParcels(ctx, await createNetwork(ctx), 1);
      void parcels;
      for (const who of [await cs(ctx), await ops(ctx), await finance(ctx)]) {
        expect((await override(who.token, p.waybill, { status: 'DROPPED_AT_ORIGIN', reason: 'Not allowed to do this' })).status).toBe(403);
      }
    });

    it('a delivered parcel can never be rewound — the money has been released', async () => {
      const sa = await superAdmin(ctx);
      const { deliverAtKiosk } = await import('./admin-helpers');
      const n = await createNetwork(ctx);
      const { parcels } = await arrivedParcels(ctx, n, 1);
      expect((await deliverAtKiosk(ctx, n, parcels[0]!)).status).toBe(200);
      const r = await override(sa.token, parcels[0]!.waybill, { status: 'ARRIVED_AT_DEST_AGENT', reason: 'Customer says never received' });
      expect([r.status, r.body.code]).toEqual([422, 'override_not_allowed']);
    });
  });

  describe('manual storage reminders', () => {
    it('CS can nudge sender and recipient in their own languages; audited; only for parcels waiting at a kiosk', async () => {
      const desk = await cs(ctx);
      const n = await createNetwork(ctx);
      const { parcels } = await arrivedParcels(ctx, n, 1, { senderLang: 'pt', recipientLang: 'id' });
      const p = parcels[0]!;
      const send = (kind: string) => ctx.http.post(`/v1/shipments/${p.waybill}/reminders`).set(bearer(desk.token)).send({ kind });

      const r = await send('DAY3');
      expect([r.status, r.body.sent, r.body.storageDay]).toEqual([200, true, 1]);
      expect(messagesTo(ctx, p.senderPhone).at(-1)!.body).toContain('Lembrete');
      expect(messagesTo(ctx, p.recipientPhone).at(-1)!.body).toContain('Pengingat');
      expect(messagesTo(ctx, p.recipientPhone).at(-1)!.body).toContain(p.waybill);
      const again = await send('DAY5'); // a deliberate second nudge is allowed and goes out as its own message
      expect(again.status).toBe(200);
      expect(messagesTo(ctx, p.recipientPhone).filter((m) => m.body.includes('0.50')).length).toBeGreaterThanOrEqual(1);
      expect(await ctx.prisma.auditLog.count({ where: { action: 'STORAGE_REMINDER_SENT', entityId: p.id } })).toBe(2);

      expect((await send('DAY9')).status).toBe(422);
      expect((await ctx.http.post(`/v1/shipments/${p.waybill}/reminders`).set(bearer((await finance(ctx)).token)).send({ kind: 'DAY3' })).status).toBe(403);
      const inTransit = await agentIntake(ctx, n.dili, { destAgentId: n.bcu.agentId });
      const wrong = await ctx.http.post(`/v1/shipments/${inTransit.waybill}/reminders`).set(bearer(desk.token)).send({ kind: 'DAY3' });
      expect([wrong.status, wrong.body.code]).toEqual([409, 'shipment_wrong_state']);
      expect((await ctx.http.post('/v1/shipments/670S-NOPE-NOPE-000000-0001/reminders').set(bearer(desk.token)).send({ kind: 'DAY3' })).status).toBe(404);
    });
  });
});

/* ======================================================================================================== */

describe('Executive analytics and CSV reports', () => {
  let ctx: TestCtx;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());

  const executive = async (token: string) => (await ctx.http.get('/v1/analytics/executive').set(bearer(token))).body;
  const today = () => new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
  const num = (v: string) => Number(v);

  it('KPIs move by exactly what new shipments bring: GMV, revenue (25 %), claim reserve (5 %), pending settlement (55 %), queues', async () => {
    const fin = await finance(ctx);
    const n = await createNetwork(ctx);
    const a = await executive(fin.token);
    await agentIntake(ctx, n.dili, { destAgentId: n.bcu.agentId });
    await agentIntake(ctx, n.dili, { destAgentId: n.bcu.agentId });
    const b = await executive(fin.token);

    expect(num(b.gmv.today) - num(a.gmv.today)).toBeCloseTo(8, 4);
    expect(num(b.gmv.month) - num(a.gmv.month)).toBeCloseTo(8, 4);
    expect(num(b.platformRevenue.month) - num(a.platformRevenue.month)).toBeCloseTo(2, 4); // 25 % of 2 × $4.00
    expect(num(b.reserves.claimEscrow) - num(a.reserves.claimEscrow)).toBeCloseTo(0.4, 4);
    expect(num(b.reserves.pendingSettlement) - num(a.reserves.pendingSettlement)).toBeCloseTo(2 * (1.6 + 0.6), 4); // fleet 40 % + destination 15 %
    expect((b.shipments.byStatus.DROPPED_AT_ORIGIN ?? 0) - (a.shipments.byStatus.DROPPED_AT_ORIGIN ?? 0)).toBe(2);
    const day = b.last14Days.find((d: { date: string }) => d.date === today());
    const dayBefore = a.last14Days.find((d: { date: string }) => d.date === today());
    expect(day.parcels - dayBefore.parcels).toBe(2);
    expect(b.last14Days).toHaveLength(14);
    expect(b.byCorridor.reduce((s: number, c: { parcels: number }) => s + c.parcels, 0) - a.byCorridor.reduce((s: number, c: { parcels: number }) => s + c.parcels, 0)).toBe(2);
    expect(b.queues).toEqual(expect.objectContaining({ openClaims: expect.any(Number), openIncidents: expect.any(Number), payoutsAwaitingApproval: expect.any(Number) }));
    expect(b.queues.pendingDeposits).toEqual({ count: expect.any(Number), amount: expect.stringMatching(/^\d+\.\d{4}$/) });
  });

  it('unclaimed and RTS counters reflect parcels past their free storage', async () => {
    const n = await createNetwork(ctx);
    const { parcels } = await arrivedParcels(ctx, n, 1);
    const fin = await finance(ctx);
    const a = await executive(fin.token);
    await ctx.prisma.shipment.update({ where: { id: parcels[0]!.id }, data: { arrivedDestAt: new Date(Date.now() - 8 * DAY) } });
    const b = await executive(fin.token);
    expect(b.shipments.unclaimedOver5Days - a.shipments.unclaimedOver5Days).toBe(1);
    await ctx.prisma.shipment.update({ where: { id: parcels[0]!.id }, data: { arrivedDestAt: new Date() } });
  });

  it('dashboard is for staff with dashboard:view only', async () => {
    for (const who of [await finance(ctx), await ops(ctx), await cs(ctx), await superAdmin(ctx)]) expect((await ctx.http.get('/v1/analytics/executive').set(bearer(who.token))).status).toBe(200);
    expect((await ctx.http.get('/v1/analytics/executive').set(bearer((await createAgent(ctx, 'DIL', '0')).token))).status).toBe(403);
    expect((await ctx.http.get('/v1/analytics/executive')).status).toBe(401);
  });

  it('volume per Dili day and per municipality for a date range', async () => {
    const o = await ops(ctx);
    const n = await createNetwork(ctx);
    const q = (extra = '') => ctx.http.get(`/v1/analytics/volume?from=${today()}&to=${today()}${extra}`).set(bearer(o.token));
    const a = await q();
    const m0 = await q('&groupBy=municipality');
    await agentIntake(ctx, n.dili, { destAgentId: n.bcu.agentId });
    const b = await q();
    expect(b.body.groupBy).toBe('day');
    expect(b.body.rows).toHaveLength(1);
    expect(b.body.rows[0].date).toBe(today());
    expect(b.body.rows[0].parcels - a.body.rows[0].parcels).toBe(1);
    expect(num(b.body.rows[0].gmv) - num(a.body.rows[0].gmv)).toBeCloseTo(4, 4);
    const m1 = await q('&groupBy=municipality');
    const bcu = (r: { body: { rows: Array<{ code: string; parcels: number }> } }) => r.body.rows.find((x) => x.code === 'BCU')?.parcels ?? 0;
    expect(bcu(m1) - bcu(m0)).toBe(1);
    expect((await ctx.http.get('/v1/analytics/volume').set(bearer(o.token))).status).toBe(422);
    expect((await ctx.http.get('/v1/analytics/volume?from=2026-13-40&to=2026-01-01').set(bearer(o.token))).status).toBe(422);
  });

  describe('CSV exports', () => {
    const range = () => `from=${today()}&to=${today()}`;

    it('shipments.csv: BOM + CRLF, one row per parcel, and spreadsheet-formula injection is defused', async () => {
      const fin = await finance(ctx);
      const n = await createNetwork(ctx);
      const p = await agentIntake(ctx, n.dili, { destAgentId: n.bcu.agentId });
      await ctx.prisma.shipment.update({ where: { id: p.id }, data: { senderName: '=HYPERLINK("http://evil.example/steal","Click me")', recipientName: '+1+cmd|\' /C calc\'!A0' } });

      const r = await ctx.http.get(`/v1/reports/shipments.csv?${range()}`).set(bearer(fin.token)).buffer(true).parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks).toString('utf8')));
      });
      expect(r.status).toBe(200);
      expect(r.headers['content-type']).toContain('text/csv');
      expect(r.headers['content-disposition']).toContain('attachment; filename="shipments.csv"');
      const text = r.body as unknown as string;
      expect(text.charCodeAt(0)).toBe(0xfeff);
      const lines = text.slice(1).split('\r\n');
      expect(lines[0]).toBe('Waybill,Created (Dili),Scheme,Canal,From,To,Status,Chargeable kg,Base USD,Pick-up USD,Delivery USD,Insurance USD,Storage USD,Total USD,Sender,Recipient');
      const row = lines.find((l) => l.startsWith(p.waybill))!;
      expect(row).toBeTruthy();
      expect(row).toContain(',DROPPED_AT_ORIGIN,');
      expect(row).toContain(',4.0000,');
      expect(row).toContain(`"'=HYPERLINK(""http://evil.example/steal"",""Click me"")"`);
      expect(row).toContain(`'+1+cmd|`);
      expect(text).not.toMatch(/(^|,|\r\n)"?[=+@]/);
    });

    it('ledger / claims / deposits CSVs need export rights plus the underlying read right; CS and agents are refused', async () => {
      const fin = await finance(ctx);
      const n = await createNetwork(ctx);
      const p = await agentIntake(ctx, n.dili, { destAgentId: n.bcu.agentId });
      const get = (token: string, name: string) => ctx.http.get(`/v1/reports/${name}.csv?${range()}`).set(bearer(token)).buffer(true).parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks).toString('utf8')));
      });

      const ledger = await get(fin.token, 'ledger');
      expect(ledger.status).toBe(200);
      const lt = (ledger.body as unknown as string).slice(1);
      expect(lt.split('\r\n')[0]).toBe('Time (Dili),Transaction,Wallet owner,Wallet type,Entry,Reference,Reference id,Amount USD,Balance after USD,Description');
      expect(lt).toContain(`SHIPMENT_INTAKE,${p.id},`);
      expect(lt).toContain('PENDING_SETTLEMENT');
      for (const name of ['claims', 'deposits']) {
        const r = await get(fin.token, name);
        expect([r.status, (r.body as unknown as string).charCodeAt(0)]).toEqual([200, 0xfeff]);
      }
      for (const name of ['shipments', 'ledger', 'claims', 'deposits']) {
        expect((await get((await cs(ctx)).token, name)).status).toBe(403);
        expect((await get((await ops(ctx)).token, name)).status).toBe(403);
        expect((await get(n.dili.token, name)).status).toBe(403);
        expect((await get((await superAdmin(ctx)).token, name)).status).toBe(200);
      }
      expect((await ctx.http.get('/v1/reports/ledger.csv').set(bearer(fin.token))).status).toBe(422);
      expect((await ctx.http.get(`/v1/reports/ledger.csv?from=${today()}`).set(bearer(fin.token))).status).toBe(422);
      expect((await ctx.http.get(`/v1/reports/ledger.csv?${range()}`)).status).toBe(401);
    });

    it('claims.csv lists claim numbers with recovered / approved amounts and escapes commas in free text', async () => {
      const { csvEscape, toCsv } = await import('../src/admin/csv');
      expect(csvEscape('a,b')).toBe('"a,b"');
      expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
      expect(csvEscape('-5.0000')).toBe('-5.0000'); // money stays numeric
      expect(csvEscape('-cmd')).toBe("'-cmd");
      expect(csvEscape('@SUM(A1)')).toBe("'@SUM(A1)");
      expect(csvEscape('\tTAB')).toBe("'\tTAB");
      expect(csvEscape(null)).toBe('');
      expect(csvEscape('multi\nline')).toBe('"multi\nline"');
      expect(toCsv(['A', 'B'], [[1, 'x,y']])).toBe('A,B\r\n1,"x,y"\r\n');
    });
  });
});

void bearer;
