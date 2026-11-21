import { createHash, randomUUID } from 'node:crypto';
import { UploadsService } from '../src/storage/uploads.service';
import { SEED, bearer, createTestApp, pinToken, createUser, tokenFor, type TestCtx } from './helpers';

/** Smallest byte sequences that carry the right magic numbers. */
const jpeg = (extra = 64) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(extra, 7)]);
const png = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]);

describe('Photo uploads (staging) + intake photo gate', () => {
  let ctx: TestCtx;
  let agentT: string;
  let agentUserId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    agentT = await pinToken(ctx, SEED.agentDiliPhone, SEED.pin());
    agentUserId = (await ctx.prisma.user.findUniqueOrThrow({ where: { phone: SEED.agentDiliPhone } })).id;
  });
  afterAll(() => ctx.close());

  const upload = (token: string, buf: Buffer, photoType = 'OPEN_BOX_CONTENT', filename = 'p.jpg', extra: Record<string, string> = {}) => {
    const r = ctx.http.post('/v1/uploads/photos').set(bearer(token)).field('photoType', photoType);
    for (const [k, v] of Object.entries(extra)) r.field(k, v);
    return r.attach('file', buf, { filename, contentType: 'image/jpeg' });
  };

  it('stores a valid JPEG privately and records hash, size and uploader', async () => {
    const buf = jpeg(500);
    const res = await upload(agentT, buf, 'OPEN_BOX_CONTENT', 'p.jpg', { lat: '-8.5569', lng: '125.5603' });
    expect(res.status).toBe(201);
    expect(res.body.sha256).toBe(createHash('sha256').update(buf).digest('hex'));
    expect(res.body.sizeBytes).toBe(buf.length);

    const row = await ctx.prisma.stagedUpload.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(row.uploadedBy).toBe(agentUserId);
    expect(row.mimeType).toBe('image/jpeg');
    expect(row.fileUrl).toMatch(new RegExp(`^s3://test-bucket/photos/${agentUserId}/\\d{4}/\\d{2}/[0-9a-f-]{36}\\.jpg$`));
    expect(ctx.storage.objects.has(ctx.storage.keyFromUri(row.fileUrl))).toBe(true);
    expect(Number(row.lat)).toBeCloseTo(-8.5569, 4);
  });

  it('accepts PNG too and never trusts the client MIME type or filename', async () => {
    const res = await upload(agentT, png(), 'SEALED_PARCEL', 'evil.exe');
    expect(res.status).toBe(201);
    const row = await ctx.prisma.stagedUpload.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(row.mimeType).toBe('image/png');
    expect(row.fileUrl.endsWith('.png')).toBe(true);
  });

  it('rejects non-images disguised as JPEG (415, localized)', async () => {
    const res = await upload(agentT, Buffer.from('<?php echo 1; ?>'.padEnd(200, ' ')), 'OPEN_BOX_CONTENT', 'x.jpg')
      .set('X-Lang', 'pt');
    expect(res.status).toBe(415);
    expect(res.body.code).toBe('file_type_not_allowed');
    expect(res.body.message).toBe('Tipo de ficheiro não permitido. Use JPEG, PNG ou WebP.');
  });

  it('enforces the size cap with the limit in the message', async () => {
    const tooBig = jpeg(Number(process.env.UPLOAD_MAX_BYTES ?? 2_097_152) + 10);
    const res = await upload(agentT, tooBig).set('X-Lang', 'en');
    expect(res.status).toBe(413);
    expect(res.body.code).toBe('file_too_large');
    expect(res.body.message).toBe('The file is too large. Maximum 2048 KB.');
  });

  it('validates photoType and file presence', async () => {
    expect((await upload(agentT, jpeg(), 'SELFIE')).status).toBe(422);
    const noFile = await ctx.http.post('/v1/uploads/photos').set(bearer(agentT)).field('photoType', 'OPEN_BOX_CONTENT');
    expect(noFile.status).toBe(422);
  });

  it('only lets a role upload the photo types it is allowed to take', async () => {
    const driverT = await pinToken(ctx, SEED.driverPhone, SEED.pin());
    expect((await upload(driverT, jpeg(), 'OPEN_BOX_CONTENT')).status).toBe(403); // drivers don't do intake
    expect((await upload(driverT, jpeg(), 'BAGGAGE_PLACEMENT')).status).toBe(201); // …but do the baggage photo
    expect((await upload(agentT, jpeg(), 'BAGGAGE_PLACEMENT')).status).toBe(403);
    const fin = await createUser(ctx, ['FINANCE_ADMIN']);
    expect((await upload(await tokenFor(ctx, fin), jpeg(), 'OPEN_BOX_CONTENT')).status).toBe(403);
    expect((await ctx.http.post('/v1/uploads/photos').field('photoType', 'OPEN_BOX_CONTENT').attach('file', jpeg(), 'p.jpg')).status).toBe(401);
  });

  it('gives the uploader — and only the uploader — a short-lived signed URL', async () => {
    const res = await upload(agentT, jpeg());
    const url = await ctx.http.get(`/v1/uploads/photos/${res.body.id}/url`).set(bearer(agentT));
    expect(url.status).toBe(200);
    expect(url.body.url).toContain('signed.test');
    expect(url.body.expiresIn).toBe(300);

    const otherAgent = await pinToken(ctx, SEED.agentBaucauPhone, SEED.pin());
    expect((await ctx.http.get(`/v1/uploads/photos/${res.body.id}/url`).set(bearer(otherAgent))).status).toBe(404);
    expect((await ctx.http.get('/v1/uploads/photos/not-a-uuid/url').set(bearer(agentT))).status).toBe(400);
  });

  /* ------------- the mandatory 2-photo gate used by Phase 3 intake ------------- */
  describe('UploadsService.consumeForShipment', () => {
    let uploads: UploadsService;
    beforeAll(() => {
      uploads = ctx.app.get(UploadsService);
    });

    async function makeShipment() {
      const [dil, bcu] = await Promise.all([
        ctx.prisma.municipality.findUniqueOrThrow({ where: { code: 'DIL' } }),
        ctx.prisma.municipality.findUniqueOrThrow({ where: { code: 'BCU' } }),
      ]);
      return ctx.prisma.shipment.create({
        data: {
          waybillNumber: `T-${randomUUID()}`,
          idempotencyKey: randomUUID(),
          serviceScheme: 'SCHEME_A',
          transportCanal: 'BUS_BAGGAGE',
          intakeChannel: 'AGENT_DROP_OFF',
          originMunicipalityId: dil.id,
          destMunicipalityId: bcu.id,
          createdById: agentUserId,
          senderName: 'Test Sender',
          senderIdType: 'BI',
          senderIdNumber: 'BI123456',
          senderPhone: '+67077000009',
          recipientName: 'Test Recipient',
          recipientPhone: '+67077000008',
          itemDescription: 'Test',
          prohibitedCheckPassed: true,
          prohibitedChecklist: {},
          actualWeightKg: 1,
          lengthCm: 10,
          widthCm: 10,
          heightCm: 10,
          volumetricWeightKg: 0.167,
          chargeableWeightKg: 1,
          pricingSnapshot: {},
          status: 'DROPPED_AT_ORIGIN',
        },
      });
    }

    it('attaches both mandatory photos and marks the uploads consumed', async () => {
      const a = (await upload(agentT, jpeg(), 'OPEN_BOX_CONTENT')).body.id as string;
      const b = (await upload(agentT, jpeg(), 'SEALED_PARCEL')).body.id as string;
      const shipment = await makeShipment();

      const photos = await ctx.prisma.$transaction((tx) =>
        uploads.consumeForShipment(tx, { uploadIds: [a, b], shipmentId: shipment.id, actorId: agentUserId }),
      );
      expect(photos.map((p) => p.photoType).sort()).toEqual(['OPEN_BOX_CONTENT', 'SEALED_PARCEL']);
      expect((await ctx.prisma.stagedUpload.findUniqueOrThrow({ where: { id: a } })).consumedByShipmentId).toBe(shipment.id);

      // a consumed photo can never be reused for another waybill
      const shipment2 = await makeShipment();
      await expect(
        ctx.prisma.$transaction((tx) => uploads.consumeForShipment(tx, { uploadIds: [a, b], shipmentId: shipment2.id, actorId: agentUserId })),
      ).rejects.toMatchObject({ code: 'upload_not_found' });
    });

    it('refuses to issue a waybill without BOTH photo types', async () => {
      const onlyOpen = (await upload(agentT, jpeg(), 'OPEN_BOX_CONTENT')).body.id as string;
      const shipment = await makeShipment();
      await expect(
        ctx.prisma.$transaction((tx) => uploads.consumeForShipment(tx, { uploadIds: [onlyOpen], shipmentId: shipment.id, actorId: agentUserId })),
      ).rejects.toMatchObject({ code: 'photos_required', status: 422 });
      // the failed attempt must not have burned the photo
      expect((await ctx.prisma.stagedUpload.findUniqueOrThrow({ where: { id: onlyOpen } })).consumedAt).toBeNull();
    });

    it("cannot use another user's photos", async () => {
      const otherT = await pinToken(ctx, SEED.agentBaucauPhone, SEED.pin());
      const a = (await upload(otherT, jpeg(), 'OPEN_BOX_CONTENT')).body.id as string;
      const b = (await upload(otherT, jpeg(), 'SEALED_PARCEL')).body.id as string;
      const shipment = await makeShipment();
      await expect(
        ctx.prisma.$transaction((tx) => uploads.consumeForShipment(tx, { uploadIds: [a, b], shipmentId: shipment.id, actorId: agentUserId })),
      ).rejects.toMatchObject({ code: 'upload_not_found' });
    });

    it('rolls the consumption back if the surrounding intake fails', async () => {
      const a = (await upload(agentT, jpeg(), 'OPEN_BOX_CONTENT')).body.id as string;
      const b = (await upload(agentT, jpeg(), 'SEALED_PARCEL')).body.id as string;
      const shipment = await makeShipment();
      await expect(
        ctx.prisma.$transaction(async (tx) => {
          await uploads.consumeForShipment(tx, { uploadIds: [a, b], shipmentId: shipment.id, actorId: agentUserId });
          throw new Error('ledger posting failed');
        }),
      ).rejects.toThrow('ledger posting failed');
      expect((await ctx.prisma.stagedUpload.findUniqueOrThrow({ where: { id: a } })).consumedAt).toBeNull();
      expect(await ctx.prisma.shipmentPhoto.count({ where: { shipmentId: shipment.id } })).toBe(0);
    });
  });
});
