import { bearer, createTestApp, type TestCtx } from './helpers';
import {
  createNetwork,
  createStaff,
  inboundScan,
  messagesTo,
  otpSentTo,
  shipInTransit,
  shipmentRow,
  stagePhoto,
  walletBalance,
  type Network,
} from './scenario';

describe('Inbound incidents: damaged / wet / missing → ON_HOLD, driver confirmation, resolution', () => {
  let ctx: TestCtx;
  let net: Network;
  beforeAll(async () => {
    ctx = await createTestApp();
    net = await createNetwork(ctx);
  });
  afterAll(() => ctx.close());

  const incidentPhoto = () => stagePhoto(ctx, net.bcu.token, 'INBOUND_INCIDENT');

  it('a broken seal needs evidence photos; with them every parcel in the bag is held and customers are told', async () => {
    const { parcels, bagCode } = await shipInTransit(ctx, net, 2);

    const noPhoto = await inboundScan(ctx, net.bcu.token, { code: bagCode, condition: 'DAMAGED_SEAL', notes: 'Seal cut' });
    expect(noPhoto.status).toBe(422);
    expect(noPhoto.body.code).toBe('incident_photo_required');
    // …and the failed attempt changed nothing
    expect((await shipmentRow(ctx, parcels[0]!.waybill)).status).toBe('IN_TRANSIT');

    // photos taken by someone else (or of the wrong type) are not accepted
    const wrongType = await stagePhoto(ctx, net.bcu.token, 'PROOF_OF_DELIVERY');
    expect((await inboundScan(ctx, net.bcu.token, { code: bagCode, condition: 'WET', incidentPhotoUploadIds: [wrongType] })).body.code).toBe('incident_photo_required');

    const photo = await incidentPhoto();
    const res = await inboundScan(ctx, net.bcu.token, { code: bagCode, condition: 'DAMAGED_SEAL', notes: 'Seal cut, bag wet', incidentPhotoUploadIds: [photo] });
    expect(res.status).toBe(200);
    expect(res.body.driverConfirmationRequired).toBe(true);
    expect(res.body.incidents).toHaveLength(2);
    expect(res.body.manifest.status).toBe('ARRIVED'); // trip cannot be closed yet

    for (const p of parcels) {
      const s = await shipmentRow(ctx, p.waybill);
      expect(s).toMatchObject({ status: 'ON_HOLD_ISSUE', holdReason: 'DAMAGED_SEAL', statusBeforeHold: 'IN_TRANSIT', pickupOtpHash: null });
      expect(await ctx.prisma.shipmentPhoto.count({ where: { shipmentId: s.id, photoType: 'INBOUND_INCIDENT' } })).toBe(1); // evidence attached to each parcel
      expect(messagesTo(ctx, p.senderPhone).some((m) => m.body.includes('Iha obstákulu'))).toBe(true);
      expect(messagesTo(ctx, p.recipientPhone).some((m) => m.body.includes('Iha obstákulu'))).toBe(true);
      expect(messagesTo(ctx, p.recipientPhone).some((m) => /\*\d{6}\*/.test(m.body))).toBe(false); // NO OTP while held
    }
    expect((await ctx.prisma.masterBag.findUniqueOrThrow({ where: { bagCode } })).status).toBe('DISCREPANCY');
  });

  it('the DRIVER must confirm digitally before CS can resolve; then release with OTP, fleet share stays held until the claim is decided', async () => {
    const { parcels, bagCode } = await shipInTransit(ctx, net, 1);
    const w = parcels[0]!.waybill;
    const res = await inboundScan(ctx, net.bcu.token, { code: bagCode, condition: 'WET', incidentPhotoUploadIds: [await incidentPhoto()] });
    const incidentId = res.body.incidents[0].id as string;

    const cs = await createStaff(ctx, 'CS_CLAIMS_ADMIN');
    const early = await ctx.http.post(`/v1/incidents/${incidentId}/resolve`).set(bearer(cs.token)).send({ resolution: 'RELEASE_TO_RECIPIENT', notes: 'Contents dry, deliver' });
    expect(early.status).toBe(422);
    expect(early.body.code).toBe('incident_driver_confirmation_required');

    // only the manifest's driver can confirm it
    const stranger = (await import('./scenario')).createFleet(ctx);
    expect((await ctx.http.post(`/v1/incidents/${incidentId}/driver-confirm`).set(bearer((await stranger).driver.token))).status).toBe(404);
    const confirm = await ctx.http.post(`/v1/incidents/${incidentId}/driver-confirm`).set(bearer(net.fleet.driver.token));
    expect(confirm.status).toBe(200);
    expect(confirm.body.driverConfirmedAt).not.toBeNull();
    expect((await ctx.prisma.manifest.findFirstOrThrow({ where: { manifestCode: res.body.manifest.manifestCode } })).status).toBe('DISCREPANCY');

    // incidents are visible to CS, not to kiosks
    expect((await ctx.http.get('/v1/incidents').set(bearer(cs.token))).body.some((i: { id: string }) => i.id === incidentId)).toBe(true);
    expect((await ctx.http.get('/v1/incidents').set(bearer(net.bcu.token))).status).toBe(403);

    const fleetBefore = await walletBalance(ctx, net.fleet.payable);
    const resolved = await ctx.http.post(`/v1/incidents/${incidentId}/resolve`).set(bearer(cs.token)).send({ resolution: 'RELEASE_TO_RECIPIENT', notes: 'Contents dry, deliver' });
    expect(resolved.status).toBe(200);
    expect(resolved.body.status).toBe('RESOLVED');
    const s = await shipmentRow(ctx, w);
    expect(s.status).toBe('ARRIVED_AT_DEST_AGENT');
    expect(s.holdReason).toBeNull();
    expect(s.statusBeforeHold).toBeNull();
    expect(otpSentTo(ctx, parcels[0]!.recipientPhone)).toMatch(/^\d{6}$/);
    expect(await walletBalance(ctx, net.fleet.payable)).toBe(fleetBefore); // fleet liable by default → 40 % stays in PENDING
    expect((await ctx.prisma.shipmentSettlement.findUniqueOrThrow({ where: { shipmentId: s.id } })).fleetReleasedAt).toBeNull();

    // resolving twice is refused
    expect((await ctx.http.post(`/v1/incidents/${incidentId}/resolve`).set(bearer(cs.token)).send({ resolution: 'RETURN_TO_SENDER', notes: 'again' })).status).toBe(409);
  });

  it('fleetLiable=false releases the fleet share on release; RETURN_TO_SENDER sends the parcel back', async () => {
    const { parcels, bagCode } = await shipInTransit(ctx, net, 2);
    const scan = await inboundScan(ctx, net.bcu.token, { code: bagCode, condition: 'DAMAGED_SEAL', incidentPhotoUploadIds: [await incidentPhoto()] });
    const cs = await createStaff(ctx, 'CS_CLAIMS_ADMIN');
    for (const i of scan.body.incidents) await ctx.http.post(`/v1/incidents/${i.id}/driver-confirm`).set(bearer(net.fleet.driver.token));
    const [first, second] = scan.body.incidents as Array<{ id: string; waybill: string }>;

    const before = Number(await walletBalance(ctx, net.fleet.payable));
    await ctx.http.post(`/v1/incidents/${first!.id}/resolve`).set(bearer(cs.token)).send({ resolution: 'RELEASE_TO_RECIPIENT', notes: 'Seal was a clerical error', fleetLiable: false });
    expect(Number(await walletBalance(ctx, net.fleet.payable)) - before).toBeCloseTo(1.6, 4);

    const rts = await ctx.http.post(`/v1/incidents/${second!.id}/resolve`).set(bearer(cs.token)).send({ resolution: 'RETURN_TO_SENDER', notes: 'Contents spoiled' });
    expect(rts.status).toBe(200);
    const s = await shipmentRow(ctx, second!.waybill);
    expect(s.status).toBe('RETURN_TO_SENDER');
    expect(s.rtsFlaggedAt).not.toBeNull();
    const sender = parcels.find((p) => p.waybill === second!.waybill)!;
    expect(messagesTo(ctx, sender.senderPhone).at(-1)!.body).toContain('haruka fila fali ba Hub Díli');
    // the trip can finally close
    expect((await ctx.prisma.manifest.findFirstOrThrow({ where: { items: { some: { masterBag: { bagCode } } } } })).status).toBe('DISCREPANCY');
  });

  it('a bag that opens clean but is short: the missing parcel is held, the rest are delivered normally', async () => {
    const { parcels, bagCode } = await shipInTransit(ctx, net, 3);
    const missing = parcels[1]!.waybill;
    const noPhoto = await inboundScan(ctx, net.bcu.token, { code: bagCode, condition: 'INTACT', missingWaybills: [missing] });
    expect(noPhoto.body.code).toBe('incident_photo_required'); // even "missing" needs a photo of the opened bag

    const notInBag = await inboundScan(ctx, net.bcu.token, { code: bagCode, condition: 'INTACT', missingWaybills: ['670S-DIL-BCU-261121-9999'], incidentPhotoUploadIds: [await incidentPhoto()] });
    expect(notInBag.status).toBe(422);

    const res = await inboundScan(ctx, net.bcu.token, { code: bagCode, condition: 'INTACT', missingWaybills: [missing], incidentPhotoUploadIds: [await incidentPhoto()] });
    expect(res.status).toBe(200);
    expect(res.body.incidents).toEqual([expect.objectContaining({ waybill: missing, condition: 'MISSING' })]);
    expect((await shipmentRow(ctx, missing)).status).toBe('ON_HOLD_ISSUE');
    for (const p of parcels.filter((x) => x.waybill !== missing)) {
      expect((await shipmentRow(ctx, p.waybill)).status).toBe('ARRIVED_AT_DEST_AGENT');
      expect(otpSentTo(ctx, p.recipientPhone)).toMatch(/^\d{6}$/);
    }
    expect((await ctx.prisma.masterBag.findUniqueOrThrow({ where: { bagCode } })).status).toBe('DISCREPANCY');
  });

  it('a held parcel cannot be delivered even with its (never issued) OTP', async () => {
    const { parcels, bagCode } = await shipInTransit(ctx, net, 1);
    await inboundScan(ctx, net.bcu.token, { code: bagCode, condition: 'WET', incidentPhotoUploadIds: [await incidentPhoto()] });
    const res = await ctx.http.post('/v1/pod/verify').set(bearer(net.bcu.token)).send({
      waybill: parcels[0]!.waybill, otp: '123456', collector: { name: 'Someone', idType: 'BI', idNumber: 'BI0000', isRepresentative: false }, photoUploadId: await stagePhoto(ctx, net.bcu.token, 'PROOF_OF_DELIVERY'),
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('shipment_wrong_state');
  });
});
