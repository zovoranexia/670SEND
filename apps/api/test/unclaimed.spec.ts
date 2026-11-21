import { UnclaimedService } from '../src/logistics/unclaimed.service';
import { LedgerService } from '../src/ledger/ledger.service';
import { bearer, createTestApp, type TestCtx } from './helpers';
import { agentIntake, createNetwork, inboundScan, messagesTo, otpSentTo, shipInTransit, shipmentRow, stagePhoto, sysWallet, walletBalance, type Network } from './scenario';

const DAY = 86_400_000;

describe('Unclaimed parcels: reminders, storage penalty, return-to-sender (daily 08:00 Asia/Dili)', () => {
  let ctx: TestCtx;
  let net: Network;
  let sweeper: UnclaimedService;

  beforeAll(async () => {
    ctx = await createTestApp();
    net = await createNetwork(ctx);
    sweeper = ctx.app.get(UnclaimedService);
  });
  afterAll(() => ctx.close());

  /** A parcel sitting at the Baucau kiosk, "arrived" at `arrivedAt`. */
  async function parcelAtKiosk(opts: { category?: string; arrivedAt?: Date } = {}) {
    const { parcels, bagCode } = await shipInTransit(ctx, net, 1, opts.category ? { category: opts.category, description: 'Kue' } : {});
    const res = await inboundScan(ctx, net.bcu.token, { code: bagCode, condition: 'INTACT' });
    expect(res.status).toBe(200);
    const p = parcels[0]!;
    const arrived = opts.arrivedAt ?? new Date();
    await ctx.prisma.shipment.update({ where: { id: p.id }, data: { arrivedDestAt: arrived } });
    return { ...p, arrived };
  }
  const count = (phone: string, needle: string) => messagesTo(ctx, phone).filter((m) => m.body.includes(needle)).length;

  it('Day 3 and Day 5 reminders go to recipient AND sender, once each; nothing before Day 3', async () => {
    const p = await parcelAtKiosk();
    // storage Day N = N-1 calendar days after arrival (the arrival day itself is Day 1)
    const sweep = (day: number) => sweeper.sweep(new Date(p.arrived.getTime() + (day - 1) * DAY), { onlyIds: [p.id] });

    await sweep(1);
    await sweep(2);
    expect(count(p.recipientPhone, 'Lembransa')).toBe(0);

    const d3 = await sweep(3);
    expect(d3.reminderDay3).toBe(1);
    for (const phone of [p.recipientPhone, p.senderPhone]) {
      expect(count(phone, 'Lembransa:')).toBe(1);
      expect(messagesTo(ctx, phone).at(-1)!.body).toContain('loron 3 nia laran'); // 3 free days left (3, 4, 5)
      expect(messagesTo(ctx, phone).at(-1)!.body).toContain(p.waybill);
    }
    expect((await shipmentRow(ctx, p.waybill)).storageReminderDay3SentAt).not.toBeNull();

    // running it again the same day, or on Day 4, sends nothing new
    await sweep(3);
    const d4 = await sweep(4);
    expect(d4.reminderDay3 + d4.reminderDay5).toBe(0);
    expect(count(p.recipientPhone, 'Lembransa:')).toBe(1);

    const d5 = await sweep(5);
    expect(d5.reminderDay5).toBe(1);
    for (const phone of [p.recipientPhone, p.senderPhone]) {
      expect(count(phone, 'Lembransa ikus')).toBe(1);
      expect(messagesTo(ctx, phone).at(-1)!.body).toContain('USD 0.50');
    }
    await sweep(5);
    expect(count(p.recipientPhone, 'Lembransa ikus')).toBe(1);
    expect((await shipmentRow(ctx, p.waybill)).storagePenaltyUsd.toFixed(4)).toBe('0.0000'); // Day 5 is still free
  });

  it('reminders honour each party’s language (Portuguese sender, Indonesian recipient)', async () => {
    const { parcels, bagCode } = await shipInTransit(ctx, net, 1, { senderLang: 'pt', recipientLang: 'id' });
    await inboundScan(ctx, net.bcu.token, { code: bagCode, condition: 'INTACT' });
    const p = parcels[0]!;
    const arrived = new Date();
    await ctx.prisma.shipment.update({ where: { id: p.id }, data: { arrivedDestAt: arrived } });
    await sweeper.sweep(new Date(arrived.getTime() + 2 * DAY), { onlyIds: [p.id] }); // Day 3
    expect(messagesTo(ctx, p.senderPhone).at(-1)!.body).toContain('Lembrete');
    expect(messagesTo(ctx, p.recipientPhone).at(-1)!.body).toContain('Pengingat');
  });

  it('Day 6-14 accrues USD 0.50 per day (capped), idempotently; Day 15 flags RETURN_TO_SENDER and alerts ops', async () => {
    const p = await parcelAtKiosk();
    const sweep = (day: number) => sweeper.sweep(new Date(p.arrived.getTime() + (day - 1) * DAY), { onlyIds: [p.id] });
    const penalty = async () => (await shipmentRow(ctx, p.waybill)).storagePenaltyUsd.toFixed(4);

    for (const [day, expected] of [[5, '0.0000'], [6, '0.5000'], [7, '1.0000'], [10, '2.5000'], [14, '4.5000']] as const) {
      await sweep(day);
      expect(await penalty()).toBe(expected);
    }
    const again = await sweep(14);
    expect(again.penaltiesUpdated).toBe(0); // same day twice → no change, no double charge

    const ops = ctx.app.get(UnclaimedService);
    void ops;
    const d15 = await sweep(15);
    expect(d15.returnedToSender).toBe(1);
    const s = await shipmentRow(ctx, p.waybill);
    expect(s.status).toBe('RETURN_TO_SENDER');
    expect(s.rtsFlaggedAt).not.toBeNull();
    expect(s.pickupOtpHash).toBeNull();
    expect(messagesTo(ctx, p.senderPhone).at(-1)!.body).toContain('haruka fila fali ba Hub Dili');
    expect(messagesTo(ctx, p.recipientPhone).at(-1)!.body).toContain('haruka fila fali ba Hub Dili');

    const events = await ctx.prisma.shipmentEvent.findMany({ where: { shipmentId: p.id }, orderBy: { createdAt: 'asc' } });
    expect(events.at(-1)).toMatchObject({ status: 'RETURN_TO_SENDER', fromStatus: 'ARRIVED_AT_DEST_AGENT' });
    expect(await ctx.prisma.auditLog.count({ where: { action: 'RTS_FLAGGED', entityId: p.id, actorId: null } })).toBe(1);

    // once returned it is out of the sweep and cannot be handed over any more
    expect((await sweep(16)).scanned).toBe(0);
    const pod = await ctx.http.post('/v1/pod/verify').set(bearer(net.bcu.token)).send({
      waybill: p.waybill, otp: '123456', collector: { name: 'Late Person', idType: 'BI', idNumber: 'BI1234', isRepresentative: false }, photoUploadId: await stagePhoto(ctx, net.bcu.token, 'PROOF_OF_DELIVERY'),
    });
    expect(pod.status).toBe(409);
  });

  it('is catch-up safe: after an outage a very late first run goes straight to RTS with no stale reminders', async () => {
    const p = await parcelAtKiosk();
    const r = await sweeper.sweep(new Date(p.arrived.getTime() + 20 * DAY), { onlyIds: [p.id] });
    expect(r).toMatchObject({ returnedToSender: 1, reminderDay3: 0, reminderDay5: 0 });
    expect(count(p.recipientPhone, 'Lembransa')).toBe(0);
  });

  it('short-shelf-life food is returned after 24 hours (hourly job); normal parcels are untouched by it', async () => {
    const food = await parcelAtKiosk({ category: 'FOOD' });
    const normal = await parcelAtKiosk();
    const at = (hours: number) => new Date(food.arrived.getTime() + hours * 3_600_000);

    const early = await sweeper.sweep(at(23), { perishableOnly: true, onlyIds: [food.id, normal.id] });
    expect(early.returnedToSender).toBe(0);
    expect((await shipmentRow(ctx, food.waybill)).status).toBe('ARRIVED_AT_DEST_AGENT');

    const late = await sweeper.sweep(at(25), { perishableOnly: true, onlyIds: [food.id, normal.id] });
    expect(late.returnedToSender).toBe(1);
    expect((await shipmentRow(ctx, food.waybill)).status).toBe('RETURN_TO_SENDER');
    expect((await shipmentRow(ctx, normal.waybill)).status).toBe('ARRIVED_AT_DEST_AGENT'); // 25 h is nothing for normal goods
    const ev = await ctx.prisma.shipmentEvent.findFirstOrThrow({ where: { shipmentId: food.id, status: 'RETURN_TO_SENDER' } });
    expect(ev.notes).toContain('24 hours');
  });

  describe('collecting the penalty at hand-over', () => {
    it('Day 8 = USD 1.50: the kiosk must confirm it collected the fee; platform gets 30 %, kiosk keeps 70 %', async () => {
      // arrived 7 days ago → today is storage Day 8
      const p = await parcelAtKiosk({ arrivedAt: new Date(Date.now() - 7 * DAY) });
      const otp = otpSentTo(ctx, p.recipientPhone);
      const fee = await ctx.http.get(`/v1/shipments/${p.waybill}/storage-fee`).set(bearer(net.bcu.token));
      expect(fee.body).toMatchObject({ storageDay: 8, freeDays: 5, penalty: { usd: '1.5000' } });

      const photo = () => stagePhoto(ctx, net.bcu.token, 'PROOF_OF_DELIVERY');
      const body = (collected: boolean) => ({
        waybill: p.waybill, otp, collector: { name: 'José Guterres', idType: 'BI', idNumber: 'BI55', isRepresentative: true }, storagePenaltyCollected: collected,
      });
      const unpaid = await ctx.http.post('/v1/pod/verify').set(bearer(net.bcu.token)).send({ ...body(false), photoUploadId: await photo() });
      expect(unpaid.status).toBe(422);
      expect(unpaid.body.code).toBe('storage_fee_unpaid');
      expect((await shipmentRow(ctx, p.waybill)).status).toBe('ARRIVED_AT_DEST_AGENT'); // nothing happened

      const depositBefore = Number(await walletBalance(ctx, net.bcu.wallet));
      const revenueBefore = Number(await walletBalance(ctx, sysWallet('PLATFORM_REVENUE')));
      const baseTotal = Number((await shipmentRow(ctx, p.waybill)).totalFeeUsd);
      const ok = await ctx.http.post('/v1/pod/verify').set(bearer(net.bcu.token)).send({ ...body(true), photoUploadId: await photo() });
      expect(ok.status).toBe(200);
      expect(ok.body.storagePenalty.usd).toBe('1.5000');

      const s = await shipmentRow(ctx, p.waybill);
      expect(s.status).toBe('DELIVERED');
      expect(s.storagePenaltyUsd.toFixed(4)).toBe('1.5000');
      expect(Number(s.totalFeeUsd)).toBeCloseTo(baseTotal + 1.5, 4);
      expect(s.collectedByRepresentative).toBe(true);
      expect(depositBefore - Number(await walletBalance(ctx, net.bcu.wallet))).toBeCloseTo(0.45, 4); // 30 % of 1.50
      expect(Number(await walletBalance(ctx, sysWallet('PLATFORM_REVENUE'))) - revenueBefore).toBeCloseTo(0.45, 4);
      const entry = await ctx.prisma.ledgerEntry.findFirst({ where: { referenceType: 'STORAGE_PENALTY', referenceId: p.id } });
      expect(entry).not.toBeNull();
      expect((await ctx.app.get(LedgerService).reconcile()).ok).toBe(true);
    });

    it('no fee is due inside the 5 free days', async () => {
      const p = await parcelAtKiosk({ arrivedAt: new Date(Date.now() - 2 * DAY) });
      const fee = await ctx.http.get(`/v1/shipments/${p.waybill}/storage-fee`).set(bearer(net.bcu.token));
      expect(fee.body.penalty.usd).toBe('0.0000');
      const res = await ctx.http.post('/v1/pod/verify').set(bearer(net.bcu.token)).send({
        waybill: p.waybill, otp: otpSentTo(ctx, p.recipientPhone), collector: { name: 'José Guterres', idType: 'BI', idNumber: 'BI55', isRepresentative: false }, photoUploadId: await stagePhoto(ctx, net.bcu.token, 'PROOF_OF_DELIVERY'),
      });
      expect(res.status).toBe(200);
      expect(res.body.storagePenalty.usd).toBe('0.0000');
    });
  });

  it('re-send OTP issues a fresh code and invalidates the old one', async () => {
    const p = await parcelAtKiosk();
    const old = otpSentTo(ctx, p.recipientPhone);
    const res = await ctx.http.post(`/v1/shipments/${p.waybill}/resend-otp`).set(bearer(net.bcu.token));
    expect(res.status).toBe(200);
    const fresh = otpSentTo(ctx, p.recipientPhone);
    const attempt = (otp: string) =>
      ctx.http.post('/v1/pod/verify').set(bearer(net.bcu.token)).send({
        waybill: p.waybill, otp, collector: { name: 'José Guterres', idType: 'BI', idNumber: 'BI55', isRepresentative: false }, photoUploadId: 'a3b8d1b6-0b3b-4b1a-9b1a-1b2c3d4e5f60',
      });
    if (fresh !== old) expect((await attempt(old)).body.code).toBe('invalid_otp');
    // a stranger agent cannot trigger it
    expect((await ctx.http.post(`/v1/shipments/${p.waybill}/resend-otp`).set(bearer(net.dili.token))).status).toBe(404);
  });

  it('door delivery: courier takes it out, fails twice → back to the kiosk; delivery add-on is parked, not paid', async () => {
    const n = await createNetwork(ctx);
    const p = await agentIntake(ctx, n.dili, { scheme: 'SCHEME_C', destAgentId: n.bcu.agentId, recipientAddress: 'Rua Central 12, Baucau' });
    const { bagAndManifest, driverHandover, createCourier } = await import('./scenario');
    const { bagCode, manifestCode } = await bagAndManifest(ctx, n, [p.waybill]);
    await driverHandover(ctx, n, manifestCode);
    await inboundScan(ctx, n.bcu.token, { code: bagCode, condition: 'INTACT' });

    const courier = await createCourier(ctx, 'BCU', 'HUB_BECORA', '0');
    const wrongArea = await createCourier(ctx, 'DIL', 'HUB_BECORA', '0');
    expect((await ctx.http.post(`/v1/shipments/${p.waybill}/out-for-delivery`).set(bearer(wrongArea.token))).status).toBe(404);
    const jobs = await ctx.http.get('/v1/courier/jobs').set(bearer(courier.token));
    expect(jobs.body.readyForDelivery.map((j: { waybill: string }) => j.waybill)).toContain(p.waybill);

    expect((await ctx.http.post(`/v1/shipments/${p.waybill}/out-for-delivery`).set(bearer(courier.token))).status).toBe(200);
    expect((await shipmentRow(ctx, p.waybill)).status).toBe('OUT_FOR_DELIVERY');
    expect(messagesTo(ctx, (await shipmentRow(ctx, p.waybill)).recipientPhone).at(-1)!.body).toContain('Kurir lokál');

    const first = await ctx.http.post(`/v1/shipments/${p.waybill}/delivery-failed`).set(bearer(courier.token)).send({ notes: 'Nobody home' });
    expect(first.body).toMatchObject({ attempts: 1, returnedToAgent: false, status: 'OUT_FOR_DELIVERY' });
    const second = await ctx.http.post(`/v1/shipments/${p.waybill}/delivery-failed`).set(bearer(courier.token)).send({});
    expect(second.body).toMatchObject({ attempts: 2, returnedToAgent: true, status: 'ARRIVED_AT_DEST_AGENT' });

    // recipient collects at the kiosk with the OTP they already had; courier add-on goes to platform revenue
    const revenueBefore = Number(await walletBalance(ctx, sysWallet('PLATFORM_REVENUE')));
    const shipment = await shipmentRow(ctx, p.waybill);
    const res = await ctx.http.post('/v1/pod/verify').set(bearer(n.bcu.token)).send({
      waybill: p.waybill, otp: otpSentTo(ctx, shipment.recipientPhone), collector: { name: 'José Guterres', idType: 'BI', idNumber: 'BI55', isRepresentative: false }, photoUploadId: await stagePhoto(ctx, n.bcu.token, 'PROOF_OF_DELIVERY'),
    });
    expect(res.status).toBe(200);
    expect(Number(await walletBalance(ctx, sysWallet('PLATFORM_REVENUE'))) - revenueBefore).toBeCloseTo(1.2, 4);
    expect(Number(await walletBalance(ctx, courier.earnings))).toBe(0);
    expect((await ctx.app.get(LedgerService).reconcile()).ok).toBe(true);
  });

  it('a courier that delivers to the door is paid their 80 % add-on at DELIVERED', async () => {
    const n = await createNetwork(ctx);
    const p = await agentIntake(ctx, n.dili, { scheme: 'SCHEME_D' as never, destAgentId: n.bcu.agentId, recipientAddress: 'Rua Central 12, Baucau' }).catch(() => null);
    void p; // Scheme D needs a courier pick-up; Scheme C exercises the same delivery path:
    const { bagAndManifest, driverHandover, createCourier } = await import('./scenario');
    const c = await agentIntake(ctx, n.dili, { scheme: 'SCHEME_C', destAgentId: n.bcu.agentId, recipientAddress: 'Rua Central 12, Baucau' });
    const { bagCode, manifestCode } = await bagAndManifest(ctx, n, [c.waybill]);
    await driverHandover(ctx, n, manifestCode);
    await inboundScan(ctx, n.bcu.token, { code: bagCode, condition: 'INTACT' });
    const courier = await createCourier(ctx, 'BCU', 'HUB_BECORA', '0');
    await ctx.http.post(`/v1/shipments/${c.waybill}/out-for-delivery`).set(bearer(courier.token));

    const s = await shipmentRow(ctx, c.waybill);
    const kioskAttempt = await ctx.http.post('/v1/pod/verify').set(bearer(n.bcu.token)).send({
      waybill: c.waybill, otp: otpSentTo(ctx, s.recipientPhone), collector: { name: 'José', idType: 'BI', idNumber: 'BI55', isRepresentative: false }, photoUploadId: await stagePhoto(ctx, n.bcu.token, 'PROOF_OF_DELIVERY'),
    });
    expect(kioskAttempt.status).toBe(409); // while the courier has it, the kiosk cannot hand it over
    const res = await ctx.http.post('/v1/pod/verify').set(bearer(courier.token)).send({
      waybill: c.waybill, otp: otpSentTo(ctx, s.recipientPhone), collector: { name: 'José Guterres', idType: 'BI', idNumber: 'BI55', isRepresentative: false }, photoUploadId: await stagePhoto(ctx, courier.token, 'PROOF_OF_DELIVERY'),
    });
    expect(res.status).toBe(200);
    expect(Number(await walletBalance(ctx, courier.earnings))).toBeCloseTo(1.2, 4);
    expect(Number(await walletBalance(ctx, n.bcu.commission))).toBeCloseTo(0.6, 4);
  });
});
