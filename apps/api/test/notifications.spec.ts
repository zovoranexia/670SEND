import { randomUUID } from 'node:crypto';
import { FieldCrypto } from '../src/common/field-crypto';
import { loadEnv } from '../src/config/env';
import {
  FonnteWhatsAppAdapter,
  MetaCloudWhatsAppAdapter,
  WahaWhatsAppAdapter,
  WhatsAppSendError,
  createWhatsAppAdapter,
  ConsoleWhatsAppAdapter,
  WHATSAPP_ADAPTER,
} from '../src/notifications/whatsapp.adapter';
import { NotificationsService } from '../src/notifications/notifications.service';
import { createTestApp, uniquePhone, type TestCtx } from './helpers';
import { agentIntake, createAgent, messagesTo, wa } from './scenario';

const envWith = (over: Record<string, string>) =>
  loadEnv({
    NODE_ENV: 'development',
    DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
    JWT_ACCESS_SECRET: 'a'.repeat(48),
    JWT_REFRESH_SECRET: 'b'.repeat(48),
    OTP_PEPPER: 'c'.repeat(48),
    FIELD_ENCRYPTION_KEY: 'd'.repeat(44),
    S3_BUCKET: 'bucket',
    S3_ACCESS_KEY_ID: 'k',
    S3_SECRET_ACCESS_KEY: 's',
    ...over,
  });

describe('WhatsApp provider adapters (HTTP contract, error classification)', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });
  const respond = (status: number, body: unknown) => {
    const f = jest.fn().mockImplementation(async () => new Response(JSON.stringify(body), { status }));
    global.fetch = f as unknown as typeof fetch;
    return f;
  };

  it('Meta Cloud API: POST /{version}/{phone-id}/messages with bearer token and digits-only recipient', async () => {
    const f = respond(200, { messages: [{ id: 'wamid.ABC' }] });
    const a = new MetaCloudWhatsAppAdapter(envWith({ WHATSAPP_PROVIDER: 'meta', META_WA_PHONE_NUMBER_ID: '123456', META_WA_ACCESS_TOKEN: 'tok', META_WA_API_VERSION: 'v22.0' }));
    const res = await a.send({ to: '+67077123456', body: 'Olá *bold*' });
    expect(res.providerMessageId).toBe('wamid.ABC');
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://graph.facebook.com/v22.0/123456/messages');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body as string)).toEqual({ messaging_product: 'whatsapp', to: '67077123456', type: 'text', text: { preview_url: true, body: 'Olá *bold*' } });
  });

  it('Fonnte: form-encoded target + message; a 200 with status:false is a permanent failure', async () => {
    const f = respond(200, { status: true, id: ['9981'] });
    const a = new FonnteWhatsAppAdapter(envWith({ WHATSAPP_PROVIDER: 'fonnte', FONNTE_TOKEN: 'ftok' }));
    expect((await a.send({ to: '+67077123456', body: 'Halo' })).providerMessageId).toBe('9981');
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.fonnte.com/send');
    expect((init.headers as Record<string, string>).authorization).toBe('ftok');
    expect(new URLSearchParams(init.body as string).get('target')).toBe('67077123456');

    respond(200, { status: false, reason: 'invalid target' });
    await expect(a.send({ to: '+67077123456', body: 'x' })).rejects.toMatchObject({ retryable: false });
  });

  it('WAHA: chatId in @c.us form, session and optional API key', async () => {
    const f = respond(201, { id: { _serialized: 'true_6707@c.us_ABC' } });
    const a = new WahaWhatsAppAdapter(envWith({ WHATSAPP_PROVIDER: 'waha', WAHA_BASE_URL: 'http://waha.local:3000/', WAHA_API_KEY: 'k', WAHA_SESSION: 'main' }));
    expect((await a.send({ to: '+67077123456', body: 'Hi' })).providerMessageId).toBe('true_6707@c.us_ABC');
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://waha.local:3000/api/sendText');
    expect(JSON.parse(init.body as string)).toEqual({ session: 'main', chatId: '67077123456@c.us', text: 'Hi' });
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('k');
  });

  it('classifies failures: 4xx permanent, 429 / 5xx / network transient (so BullMQ retries only the right ones)', async () => {
    const a = new MetaCloudWhatsAppAdapter(envWith({ META_WA_PHONE_NUMBER_ID: '1', META_WA_ACCESS_TOKEN: 't' }));
    respond(400, { error: { message: 'bad number' } });
    await expect(a.send({ to: '+1', body: 'x' })).rejects.toMatchObject({ name: 'WhatsAppSendError', retryable: false });
    respond(401, {});
    await expect(a.send({ to: '+1', body: 'x' })).rejects.toMatchObject({ retryable: false });
    respond(429, {});
    await expect(a.send({ to: '+1', body: 'x' })).rejects.toMatchObject({ retryable: true });
    respond(503, {});
    await expect(a.send({ to: '+1', body: 'x' })).rejects.toMatchObject({ retryable: true });
    global.fetch = jest.fn().mockRejectedValue(new TypeError('fetch failed')) as never;
    await expect(a.send({ to: '+1', body: 'x' })).rejects.toMatchObject({ retryable: true });
  });

  it('the factory picks the adapter from WHATSAPP_PROVIDER (console by default)', () => {
    expect(createWhatsAppAdapter(envWith({}))).toBeInstanceOf(ConsoleWhatsAppAdapter);
    expect(createWhatsAppAdapter(envWith({ WHATSAPP_PROVIDER: 'meta' })).name).toBe('meta');
    expect(createWhatsAppAdapter(envWith({ WHATSAPP_PROVIDER: 'fonnte' })).name).toBe('fonnte');
    expect(createWhatsAppAdapter(envWith({ WHATSAPP_PROVIDER: 'waha' })).name).toBe('waha');
  });

  it('production refuses the console provider and incomplete provider credentials', () => {
    const prod = { NODE_ENV: 'production', CORS_ORIGINS: 'https://670send.tl' };
    expect(() => envWith({ ...prod, WHATSAPP_PROVIDER: 'console' })).toThrow(/console/);
    expect(() => envWith({ ...prod, WHATSAPP_PROVIDER: 'meta' })).toThrow(/META_WA/);
    expect(() => envWith({ ...prod, WHATSAPP_PROVIDER: 'fonnte' })).toThrow(/FONNTE_TOKEN/);
    expect(() => envWith({ ...prod, WHATSAPP_PROVIDER: 'waha' })).toThrow(/WAHA_BASE_URL/);
    expect(() => envWith({ ...prod, WHATSAPP_PROVIDER: 'waha', WAHA_BASE_URL: 'http://waha:3000', QUEUES_ENABLED: 'false' })).toThrow(/QUEUES_ENABLED/);
    expect(() => envWith({ ...prod, WHATSAPP_PROVIDER: 'waha', WAHA_BASE_URL: 'http://waha:3000' })).not.toThrow();
  });
});

describe('FieldCrypto (queue payloads / bank details at rest)', () => {
  const crypto = new FieldCrypto(envWith({}));
  it('round-trips, uses a fresh IV each time, and detects tampering', () => {
    const a = crypto.encrypt('OTP is 123456');
    const b = crypto.encrypt('OTP is 123456');
    expect(a).not.toBe(b);
    expect(a).not.toContain('123456');
    expect(crypto.decrypt(a)).toBe('OTP is 123456');
    const raw = Buffer.from(a, 'base64url');
    raw[raw.length - 1] = raw[raw.length - 1]! ^ 1;
    expect(() => crypto.decrypt(raw.toString('base64url'))).toThrow();
    expect(() => crypto.decrypt('short')).toThrow();
    expect(() => new FieldCrypto(envWith({ FIELD_ENCRYPTION_KEY: 'e'.repeat(44) })).decrypt(a)).toThrow(); // other key
  });
});

describe('NotificationsService (templates in the database, dedupe, masking, retries)', () => {
  let ctx: TestCtx;
  let svc: NotificationsService;
  beforeAll(async () => {
    ctx = await createTestApp();
    svc = ctx.app.get(NotificationsService);
  });
  afterAll(() => ctx.close());

  async function newShipment(opts: { senderLang?: string; recipientLang?: string } = {}) {
    const dili = await createAgent(ctx, 'DIL', '50');
    const bcu = await createAgent(ctx, 'BCU', '0');
    const senderPhone = uniquePhone();
    const recipientPhone = uniquePhone();
    const r = await agentIntake(ctx, dili, { destAgentId: bcu.agentId, senderPhone, recipientPhone, senderLang: opts.senderLang, recipientLang: opts.recipientLang });
    return { id: r.id, waybill: r.waybill, senderPhone, recipientPhone };
  }

  it('edited templates take effect immediately, without a deploy', async () => {
    const original = await ctx.prisma.notificationTemplate.findUniqueOrThrow({ where: { eventCode_lang: { eventCode: 'DROPPED_AT_ORIGIN', lang: 'EN' } } });
    try {
      await ctx.prisma.notificationTemplate.update({ where: { id: original.id }, data: { bodyTemplate: 'CUSTOM {{waybill}} for {{destName}}' } });
      const s = await newShipment({ senderLang: 'en', recipientLang: 'en' });
      expect(messagesTo(ctx, s.senderPhone)[0]!.body).toBe(`CUSTOM ${s.waybill} for Baucau`);
    } finally {
      await ctx.prisma.notificationTemplate.update({ where: { id: original.id }, data: { bodyTemplate: original.bodyTemplate } });
    }
  });

  it('a disabled template falls back to the built-in text in the SAME language (never English by accident)', async () => {
    const tpl = await ctx.prisma.notificationTemplate.findUniqueOrThrow({ where: { eventCode_lang: { eventCode: 'DROPPED_AT_ORIGIN', lang: 'PT' } } });
    try {
      await ctx.prisma.notificationTemplate.update({ where: { id: tpl.id }, data: { isActive: false } });
      const s = await newShipment({ senderLang: 'pt' });
      expect(messagesTo(ctx, s.senderPhone)[0]!.body).toContain('Encomenda recebida!');
    } finally {
      await ctx.prisma.notificationTemplate.update({ where: { id: tpl.id }, data: { isActive: true } });
    }
  });

  it('unresolved {{placeholders}} are stripped instead of being sent to a customer', async () => {
    const original = await ctx.prisma.notificationTemplate.findUniqueOrThrow({ where: { eventCode_lang: { eventCode: 'DROPPED_AT_ORIGIN', lang: 'ID' } } });
    try {
      await ctx.prisma.notificationTemplate.update({ where: { id: original.id }, data: { bodyTemplate: 'Resi {{waybill}} {{typo_variable}} selesai' } });
      const s = await newShipment({ recipientLang: 'id' });
      const body = messagesTo(ctx, s.recipientPhone)[0]!.body;
      expect(body).toBe(`Resi ${s.waybill} selesai`);
    } finally {
      await ctx.prisma.notificationTemplate.update({ where: { id: original.id }, data: { bodyTemplate: original.bodyTemplate } });
    }
  });

  it('sends the real OTP to the phone but stores it MASKED in the log; the same event is never sent twice', async () => {
    const s = await newShipment();
    const phone = s.recipientPhone;
    await svc.notifyShipment(s.id, 'ARRIVED_AT_DEST_AGENT', ['RECIPIENT'], { otp: '482913' });
    await svc.notifyShipment(s.id, 'ARRIVED_AT_DEST_AGENT', ['RECIPIENT'], { otp: '999999' }); // duplicate event → suppressed
    const sent = messagesTo(ctx, phone).filter((m) => m.body.includes('OTP'));
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).toContain('*482913*');
    const log = await ctx.prisma.notificationLog.findFirstOrThrow({ where: { shipmentId: s.id, eventCode: 'ARRIVED_AT_DEST_AGENT' } });
    expect(log.renderedBody).toContain('******');
    expect(log.renderedBody).not.toContain('482913');
    expect(log).toMatchObject({ audience: 'RECIPIENT', deliveryStatus: 'SENT', provider: 'console', lang: 'TET' });
    expect(log.providerMessageId).toBeTruthy();

    // a deliberate repeat (re-send) uses its own dedupe suffix
    await svc.notifyShipment(s.id, 'ARRIVED_AT_DEST_AGENT', ['RECIPIENT'], { otp: '111222' }, ':resend:1');
    expect(messagesTo(ctx, phone).filter((m) => m.body.includes('OTP'))).toHaveLength(2);
  });

  it('delivery variables: kiosk name / address / courier / collector / time are filled in', async () => {
    const s = await newShipment();
    await svc.notifyShipment(s.id, 'ARRIVED_AT_DEST_AGENT', ['RECIPIENT'], { otp: '123123' }, ':vars');
    const body = messagesTo(ctx, s.recipientPhone).at(-1)!.body;
    expect(body).toMatch(/Ajente Kios BCU [0-9a-f]{4}, Rua Teste, BCU!/);
    expect(body).not.toContain('{{');
  });

  describe('failure handling', () => {
    const adapter = () => wa(ctx);
    const makeLog = async () => {
      const s = await newShipment();
      const log = await ctx.prisma.notificationLog.create({
        data: { shipmentId: s.id, audience: 'SENDER', recipientPhone: s.senderPhone, eventCode: 'IN_TRANSIT', lang: 'TET', renderedBody: 'x', provider: 'console', dedupeKey: randomUUID() },
      });
      const job = { logId: log.id, to: s.senderPhone, bodyEnc: ctx.app.get(FieldCrypto).encrypt('Halo, ida ne’e teste') };
      return { log, job };
    };

    it('a permanent provider error marks the message FAILED at once (no pointless retries)', async () => {
      const { log, job } = await makeLog();
      const spy = jest.spyOn(adapter(), 'send').mockRejectedValueOnce(new WhatsAppSendError('invalid number', false));
      await svc.process(job, { attempt: 1, maxAttempts: 5, jobName: 'whatsapp.send' }); // does not throw → not retried
      const row = await ctx.prisma.notificationLog.findUniqueOrThrow({ where: { id: log.id } });
      expect(row).toMatchObject({ deliveryStatus: 'FAILED', retryCount: 1 });
      expect(row.lastError).toContain('invalid number');
      spy.mockRestore();
    });

    it('a transient error is retried (throws for BullMQ) and the message is finally SENT; sending twice is impossible', async () => {
      const { log, job } = await makeLog();
      const spy = jest.spyOn(adapter(), 'send').mockRejectedValueOnce(new WhatsAppSendError('HTTP 503', true));
      await expect(svc.process(job, { attempt: 1, maxAttempts: 5, jobName: 'whatsapp.send' })).rejects.toThrow('HTTP 503');
      expect((await ctx.prisma.notificationLog.findUniqueOrThrow({ where: { id: log.id } })).deliveryStatus).toBe('QUEUED');
      await svc.process(job, { attempt: 2, maxAttempts: 5, jobName: 'whatsapp.send' });
      const sentRow = await ctx.prisma.notificationLog.findUniqueOrThrow({ where: { id: log.id } });
      expect(sentRow).toMatchObject({ deliveryStatus: 'SENT', retryCount: 1, lastError: null });

      const calls = spy.mock.calls.length;
      await svc.process(job, { attempt: 3, maxAttempts: 5, jobName: 'whatsapp.send' }); // duplicate job delivery
      expect(spy.mock.calls.length).toBe(calls);
      spy.mockRestore();
    });

    it('after the last attempt a transient error becomes FAILED', async () => {
      const { log, job } = await makeLog();
      const spy = jest.spyOn(adapter(), 'send').mockRejectedValueOnce(new WhatsAppSendError('HTTP 503', true));
      await svc.process(job, { attempt: 5, maxAttempts: 5, jobName: 'whatsapp.send' });
      expect((await ctx.prisma.notificationLog.findUniqueOrThrow({ where: { id: log.id } })).deliveryStatus).toBe('FAILED');
      spy.mockRestore();
    });

    it('a broken provider can never fail the parcel operation that triggered the message', async () => {
      const spy = jest.spyOn(adapter(), 'send').mockRejectedValue(new Error('provider exploded'));
      const dili = await createAgent(ctx, 'DIL', '50');
      const bcu = await createAgent(ctx, 'BCU', '0');
      const r = await agentIntake(ctx, dili, { destAgentId: bcu.agentId });
      expect(r.res.status).toBe(201); // intake still succeeded
      const logs = await ctx.prisma.notificationLog.findMany({ where: { shipmentId: r.id } });
      expect(logs.length).toBeGreaterThan(0);
      expect(logs.every((l) => l.deliveryStatus === 'FAILED')).toBe(true);
      spy.mockRestore();
    });

    it('ops alerts without a configured phone are only logged', async () => {
      await expect(svc.alertOps('test alert')).resolves.toBeUndefined();
    });
  });

  it('exposes the injected adapter token', () => {
    expect(ctx.app.get(WHATSAPP_ADAPTER)).toBeInstanceOf(ConsoleWhatsAppAdapter);
  });
});
