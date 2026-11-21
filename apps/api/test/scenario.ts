import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { LedgerService, type WalletRef } from '../src/ledger/ledger.service';
import { ConsoleWhatsAppAdapter, WHATSAPP_ADAPTER } from '../src/notifications/whatsapp.adapter';
import { bearer, createUser, uniquePhone, type CreatedUser, type TestCtx } from './helpers';

const D = (v: string | number) => v.toString();

export const jpeg = (extra = 64) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(extra, 9)]);

export const wa = (ctx: TestCtx) => ctx.app.get<ConsoleWhatsAppAdapter>(WHATSAPP_ADAPTER);

/** Most recent pickup OTP sent to a phone (extracted from the WhatsApp text the way a recipient would read it). */
export function otpSentTo(ctx: TestCtx, phone: string): string {
  const msgs = wa(ctx).sent.filter((m) => m.to === phone && /\*\d{6}\*/.test(m.body));
  const last = msgs[msgs.length - 1];
  if (!last) throw new Error(`No OTP message was sent to ${phone}`);
  return /\*(\d{6})\*/.exec(last.body)![1]!;
}

export const messagesTo = (ctx: TestCtx, phone: string) => wa(ctx).sent.filter((m) => m.to === phone);

/* ----------------------------------------- wallets ----------------------------------------- */

export async function walletBalance(ctx: TestCtx, ref: WalletRef): Promise<string> {
  const ledger = ctx.app.get(LedgerService);
  return (await ledger.balanceOf(ref)).balance.toFixed(4);
}
export const sysWallet = (t: Parameters<typeof LedgerService.systemWallet>[0]) => LedgerService.systemWallet(t);

export async function fund(ctx: TestCtx, wallet: WalletRef, amount: string): Promise<void> {
  await ctx.app.get(LedgerService).post({
    referenceType: 'DEPOSIT_TOPUP',
    idempotencyKey: `test-fund:${randomUUID()}`,
    lines: [
      { wallet: sysWallet('EXTERNAL_CLEARING'), type: 'DEBIT', amount },
      { wallet, type: 'CREDIT', amount },
    ],
  });
}

/* ------------------------------------------- actors ------------------------------------------- */

export interface AgentCtx {
  user: CreatedUser;
  agentId: string;
  token: string;
  wallet: WalletRef;
  commission: WalletRef;
  municipality: string;
}

async function pinLogin(ctx: TestCtx, u: CreatedUser): Promise<string> {
  const res = await ctx.http.post('/v1/auth/login/pin').send({ phone: u.phone, pin: u.pin });
  if (res.status !== 200) throw new Error(`pin login failed ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.accessToken as string;
}

export async function createAgent(ctx: TestCtx, municipalityCode: string, deposit = '100.0000'): Promise<AgentCtx> {
  const user = await createUser(ctx, ['AGENT']);
  const muni = await ctx.prisma.municipality.findUniqueOrThrow({ where: { code: municipalityCode } });
  const agent = await ctx.prisma.agent.create({
    data: {
      userId: user.id,
      municipalityId: muni.id,
      agentCode: `AG-T-${randomUUID().slice(0, 8)}`,
      kioskName: `Kios ${municipalityCode} ${randomUUID().slice(0, 4)}`,
      address: `Rua Teste, ${municipalityCode}`,
      openingHours: '08:00-18:00',
      status: 'ACTIVE',
    },
  });
  const wallet: WalletRef = { ownerType: 'AGENT', ownerId: agent.id, walletType: 'DEPOSIT' };
  if (Number(deposit) > 0) await fund(ctx, wallet, deposit);
  return {
    user,
    agentId: agent.id,
    token: await pinLogin(ctx, user),
    wallet,
    commission: { ownerType: 'AGENT', ownerId: agent.id, walletType: 'COMMISSION' },
    municipality: municipalityCode,
  };
}

export interface CourierCtx {
  user: CreatedUser;
  courierId: string;
  token: string;
  wallet: WalletRef;
  earnings: WalletRef;
}

export async function createCourier(ctx: TestCtx, municipalityCode = 'DIL', hubCode = 'HUB_BECORA', deposit = '50.0000'): Promise<CourierCtx> {
  const user = await createUser(ctx, ['COURIER']);
  const [muni, hub] = await Promise.all([
    ctx.prisma.municipality.findUniqueOrThrow({ where: { code: municipalityCode } }),
    ctx.prisma.hub.findUniqueOrThrow({ where: { code: hubCode } }),
  ]);
  const courier = await ctx.prisma.courier.create({
    data: { userId: user.id, municipalityId: muni.id, hubId: hub.id, vehicleType: 'MOTORBIKE', status: 'ACTIVE', isAvailable: true },
  });
  const wallet: WalletRef = { ownerType: 'COURIER', ownerId: courier.id, walletType: 'DEPOSIT' };
  if (Number(deposit) > 0) await fund(ctx, wallet, deposit);
  return {
    user,
    courierId: courier.id,
    token: await pinLogin(ctx, user),
    wallet,
    earnings: { ownerType: 'COURIER', ownerId: courier.id, walletType: 'COURIER_EARNINGS' },
  };
}

export interface FleetCtx {
  partnerId: string;
  owner: CreatedUser;
  payable: WalletRef;
  vehicles: { bus: string; truck: string; ferry: string };
  driver: { id: string; user: CreatedUser; token: string };
  driverId: string;
}

export async function createFleet(
  ctx: TestCtx,
  opts: { mouValidUntil?: Date | null; permitExpiry?: Date | null; kirExpiry?: Date | null; licenseExpiry?: Date | null; status?: 'ACTIVE' | 'SUSPENDED' } = {},
): Promise<FleetCtx> {
  const future = new Date(Date.now() + 365 * 86_400_000);
  const owner = await createUser(ctx, ['FLEET_OWNER']);
  const partner = await ctx.prisma.fleetPartner.create({
    data: {
      ownerUserId: owner.id,
      companyName: `Fleet ${randomUUID().slice(0, 6)}`,
      mouNumber: `MOU-T-${randomUUID().slice(0, 8)}`,
      mouValidUntil: opts.mouValidUntil === undefined ? future : opts.mouValidUntil,
      payoutChannel: 'BNCTL',
      status: opts.status ?? 'ACTIVE',
    },
  });
  const mkVehicle = (vehicleType: 'BUS_PASSENGER' | 'TRUCK_CARGO' | 'SEA_FERRY', corridor: 'EAST' | 'SEA') =>
    ctx.prisma.vehicle
      .create({
        data: {
          fleetPartnerId: partner.id,
          plateNumber: `T-${randomUUID().slice(0, 8)}`,
          vehicleType,
          routeCorridor: corridor,
          dnttPermitNo: 'DNTT-T',
          dnttPermitExpiry: opts.permitExpiry === undefined ? future : opts.permitExpiry,
          kirExpiry: opts.kirExpiry === undefined ? future : opts.kirExpiry,
        },
      })
      .then((v) => v.id);
  const [bus, truck, ferry] = await Promise.all([mkVehicle('BUS_PASSENGER', 'EAST'), mkVehicle('TRUCK_CARGO', 'EAST'), mkVehicle('SEA_FERRY', 'SEA')]);

  const driverUser = await createUser(ctx, ['DRIVER']);
  const driver = await ctx.prisma.driver.create({
    data: {
      userId: driverUser.id,
      fleetPartnerId: partner.id,
      licenseNumber: `KD-${randomUUID().slice(0, 6)}`,
      licenseExpiry: opts.licenseExpiry === undefined ? future : opts.licenseExpiry,
      phone: driverUser.phone,
    },
  });
  return {
    partnerId: partner.id,
    owner,
    payable: { ownerType: 'FLEET_OWNER', ownerId: partner.id, walletType: 'FLEET_PAYABLE' },
    vehicles: { bus, truck, ferry },
    driver: { id: driver.id, user: driverUser, token: await pinLogin(ctx, driverUser) },
    driverId: driver.id,
  };
}

export async function createStaff(ctx: TestCtx, role: 'OPS_HUB_ADMIN' | 'CS_CLAIMS_ADMIN' | 'FINANCE_ADMIN' | 'SUPER_ADMIN'): Promise<{ user: CreatedUser; token: string }> {
  const user = await createUser(ctx, [role]);
  const res = await ctx.http.post('/v1/auth/login').send({ email: user.email, password: user.password });
  return { user, token: res.body.accessToken as string };
}

/* ------------------------------------------- intake ------------------------------------------- */

export async function stagePhoto(ctx: TestCtx, token: string, photoType: string): Promise<string> {
  const res = await ctx.http.post('/v1/uploads/photos').set(bearer(token)).field('photoType', photoType).attach('file', jpeg(120), { filename: 'p.jpg', contentType: 'image/jpeg' });
  if (res.status !== 201) throw new Error(`photo upload failed ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.id as string;
}

export async function intakePhotos(ctx: TestCtx, token: string): Promise<string[]> {
  return [await stagePhoto(ctx, token, 'OPEN_BOX_CONTENT'), await stagePhoto(ctx, token, 'SEALED_PARCEL')];
}

export const CHECKLIST = {
  narcotics: true,
  weapons_sharp: true,
  fuel_flammable: true,
  cash_gold_jewelry: true,
  protected_wildlife: true,
  untaxed_contraband: true,
  raw_perishables: true,
};

export interface IntakeOpts {
  scheme?: 'SCHEME_A' | 'SCHEME_B' | 'SCHEME_C' | 'SCHEME_D';
  dest?: string;
  destAgentId?: string;
  origin?: string;
  weight?: number;
  dims?: [number, number, number];
  category?: string;
  fragile?: boolean;
  declared?: string;
  insure?: boolean;
  description?: string;
  senderLang?: string;
  recipientLang?: string;
  senderPhone?: string;
  recipientPhone?: string;
  recipientAddress?: string;
  pin: string;
  photoIds: string[];
  pickupBookingId?: string;
  override?: Record<string, unknown>;
}

export function intakeBody(o: IntakeOpts) {
  return {
    scheme: o.scheme ?? 'SCHEME_A',
    originMunicipalityCode: o.origin,
    destMunicipalityCode: o.dest ?? 'BCU',
    destAgentId: o.destAgentId,
    pickupBookingId: o.pickupBookingId,
    sender: { name: 'Maria da Costa', idType: 'BI', idNumber: 'BI123456', phone: o.senderPhone ?? uniquePhone(), lang: o.senderLang ?? 'tet', address: 'Rua Sender 1' },
    recipient: { name: 'José Guterres', phone: o.recipientPhone ?? uniquePhone(), lang: o.recipientLang ?? 'tet', address: o.recipientAddress },
    item: { description: o.description ?? 'Roupa', category: o.category ?? 'GENERAL', isFragile: o.fragile ?? false, declaredValueUsd: o.declared },
    parcel: { actualWeightKg: o.weight ?? 2, lengthCm: o.dims?.[0] ?? 30, widthCm: o.dims?.[1] ?? 20, heightCm: o.dims?.[2] ?? 10 },
    insure: o.insure ?? false,
    prohibitedChecklist: { ...CHECKLIST },
    checklistLang: 'tet',
    photoUploadIds: o.photoIds,
    pin: o.pin,
    ...o.override,
  };
}

export async function postIntake(ctx: TestCtx, token: string, body: object, key: string = randomUUID()) {
  return ctx.http.post('/v1/shipments').set(bearer(token)).set('Idempotency-Key', key).send(body);
}

/** Intake a parcel as `agent`, staging fresh photos. Returns the HTTP response and the useful bits. */
export async function agentIntake(ctx: TestCtx, agent: AgentCtx, opts: Omit<IntakeOpts, 'pin' | 'photoIds'> & { key?: string }) {
  const photoIds = await intakePhotos(ctx, agent.token);
  const res = await postIntake(ctx, agent.token, intakeBody({ ...opts, pin: agent.user.pin, photoIds }), opts.key);
  return { res, waybill: res.body?.shipment?.waybillNumber as string, id: res.body?.shipment?.id as string, body: res.body };
}

/* --------------------------------------- the whole network --------------------------------------- */

export interface Network {
  dili: AgentCtx;
  bcu: AgentCtx;
  ops: { user: CreatedUser; token: string };
  fleet: FleetCtx;
  courier: CourierCtx;
}

/** Origin kiosk in Díli, destination kiosk in Baucau, hub ops, one fleet partner, one courier. */
export async function createNetwork(ctx: TestCtx): Promise<Network> {
  const [dili, bcu, ops, fleet, courier] = await Promise.all([
    createAgent(ctx, 'DIL', '200.0000'),
    createAgent(ctx, 'BCU', '50.0000'),
    createStaff(ctx, 'OPS_HUB_ADMIN'),
    createFleet(ctx),
    createCourier(ctx),
  ]);
  return { dili, bcu, ops, fleet, courier };
}

export async function hubReceive(ctx: TestCtx, token: string, hubCode: string, waybills: string[]) {
  return ctx.http.post('/v1/hub/receive').set(bearer(token)).send({ hubCode, waybills });
}

/** Take parcels from DROPPED_AT_ORIGIN to a sealed master bag on a READY bus manifest. */
export async function bagAndManifest(ctx: TestCtx, net: Network, waybills: string[], hubCode = 'HUB_BECORA', dest = 'BCU') {
  await hubReceive(ctx, net.ops.token, hubCode, waybills);
  const bag = await ctx.http.post('/v1/master-bags').set(bearer(net.ops.token)).send({ hubCode, destMunicipalityCode: dest });
  for (const w of waybills) await ctx.http.post(`/v1/master-bags/${bag.body.bagCode}/items`).set(bearer(net.ops.token)).send({ waybill: w });
  await ctx.http.post(`/v1/master-bags/${bag.body.bagCode}/seal`).set(bearer(net.ops.token)).send({ plasticSealNumber: `PS-${randomUUID().slice(0, 8)}` });
  const man = await ctx.http.post('/v1/manifests').set(bearer(net.ops.token)).send({
    hubCode,
    destMunicipalityCode: dest,
    canal: 'BUS_BAGGAGE',
    fleetPartnerId: net.fleet.partnerId,
    vehicleId: net.fleet.vehicles.bus,
    driverId: net.fleet.driverId,
    masterBagCodes: [bag.body.bagCode],
  });
  if (man.status !== 201) throw new Error(`manifest failed ${man.status} ${JSON.stringify(man.body)}`);
  await ctx.http.post(`/v1/manifests/${man.body.manifestCode}/ready`).set(bearer(net.ops.token)).send({});
  return { bagCode: bag.body.bagCode as string, manifestCode: man.body.manifestCode as string };
}

export async function driverHandover(ctx: TestCtx, net: Network, manifestCode: string) {
  const photo = await stagePhoto(ctx, net.fleet.driver.token, 'BAGGAGE_PLACEMENT');
  return ctx.http.post(`/v1/manifests/${manifestCode}/handover`).set(bearer(net.fleet.driver.token)).send({ baggagePhotoUploadId: photo });
}

/** intake → hub → bag → manifest → driver handover. Parcels end IN_TRANSIT. */
export async function shipInTransit(ctx: TestCtx, net: Network, count = 1, opts: Partial<IntakeOpts> = {}) {
  const parcels: Array<{ waybill: string; id: string; recipientPhone: string; senderPhone: string }> = [];
  for (let i = 0; i < count; i++) {
    const recipientPhone = uniquePhone();
    const senderPhone = uniquePhone();
    const r = await agentIntake(ctx, net.dili, { dest: 'BCU', destAgentId: net.bcu.agentId, recipientPhone, senderPhone, ...opts });
    if (r.res.status !== 201) throw new Error(`intake failed ${r.res.status} ${JSON.stringify(r.res.body)}`);
    parcels.push({ waybill: r.waybill, id: r.id, recipientPhone, senderPhone });
  }
  const { bagCode, manifestCode } = await bagAndManifest(ctx, net, parcels.map((p) => p.waybill));
  const h = await driverHandover(ctx, net, manifestCode);
  if (h.status !== 200) throw new Error(`handover failed ${h.status} ${JSON.stringify(h.body)}`);
  return { parcels, bagCode, manifestCode };
}

export const inboundScan = (ctx: TestCtx, token: string, body: object) =>
  ctx.http.post('/v1/inbound/scan').set(bearer(token)).send(body);

export const shipmentRow = (ctx: TestCtx, waybill: string) => ctx.prisma.shipment.findUniqueOrThrow({ where: { waybillNumber: waybill } });
export type { Prisma };
export { D };
