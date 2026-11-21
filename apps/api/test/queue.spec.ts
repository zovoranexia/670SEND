/**
 * Integration test through REAL Redis + BullMQ (schedulers, encrypted payloads, worker, cron job).
 * Uses Redis database 15 so it can never touch a developer's running queues; skipped when Redis is not up.
 */
import IORedis from 'ioredis';
import { QueueService } from '../src/notifications/queue.service';
import { NotificationsService } from '../src/notifications/notifications.service';
import { UnclaimedService } from '../src/logistics/unclaimed.service';
import { waitFor, type TestCtx } from './helpers';

const base = process.env.REDIS_URL ?? 'redis://localhost:16379';
const REDIS_URL = `${base.replace(/\/\d+$/, '')}/15`;

async function redisUp(): Promise<boolean> {
  const c = new IORedis(REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 1500, retryStrategy: () => null });
  c.on('error', () => undefined);
  try {
    await c.connect();
    await c.ping();
    return true;
  } catch {
    return false;
  } finally {
    c.disconnect();
  }
}

describe('BullMQ queues on real Redis', () => {
  let ctx: TestCtx;
  let available = false;
  const DAY = 86_400_000;

  beforeAll(async () => {
    available = await redisUp();
    if (!available) {
      console.warn('Redis not reachable — queue integration tests skipped (run `pnpm db:up`)');
      return;
    }
    const flush = new IORedis(REDIS_URL);
    await flush.flushdb(); // database 15 only
    flush.disconnect();
    process.env.REDIS_URL = REDIS_URL;
    process.env.QUEUES_ENABLED = 'true';
    const { createTestApp } = await import('./helpers');
    ctx = await createTestApp();
  });

  afterAll(async () => {
    if (ctx) await ctx.close();
    process.env.QUEUES_ENABLED = 'false';
    if (available) {
      const flush = new IORedis(REDIS_URL);
      await flush.flushdb();
      flush.disconnect();
    }
  });

  const it_ = (name: string, fn: () => Promise<void>) =>
    it(name, async () => {
      if (!available) return;
      await fn();
    });

  it_('registers exactly one of each cron schedule — unclaimed 08:00, perishables hourly, payout drafts 06:00 (idempotent across restarts)', async () => {
    const q = ctx.app.get(QueueService).getQueue('maintenance')!;
    const schedulers = await q.getJobSchedulers();
    const byId = Object.fromEntries(schedulers.map((s) => [s.key, s]));
    expect(byId['unclaimed-daily']).toMatchObject({ pattern: '0 8 * * *', tz: 'Asia/Dili', name: 'unclaimed-sweep' });
    expect(byId['perishable-hourly']).toMatchObject({ pattern: '0 * * * *', tz: 'Asia/Dili', name: 'perishable-sweep' });
    expect(byId['payout-drafts-daily']).toMatchObject({ pattern: '0 6 * * *', tz: 'Asia/Dili', name: 'payout-generate' });
    expect(schedulers).toHaveLength(3);

    // upserting again (what every API restart does) must not duplicate them
    await q.upsertJobScheduler('unclaimed-daily', { pattern: '0 8 * * *', tz: 'Asia/Dili' }, { name: 'unclaimed-sweep' });
    expect(await q.getJobSchedulers()).toHaveLength(3);
  });

  it_('WhatsApp jobs sit in Redis ENCRYPTED, the worker delivers them, and the log ends SENT', async () => {
    const notifications = ctx.app.get(NotificationsService);
    const queues = ctx.app.get(QueueService);
    const { agentIntake, createAgent, wa } = await import('./scenario');
    const dili = await createAgent(ctx, 'DIL', '50');
    const bcu = await createAgent(ctx, 'BCU', '0');
    const r = await agentIntake(ctx, dili, { destAgentId: bcu.agentId });
    expect(r.res.status).toBe(201);
    await waitFor(async () => (await ctx.prisma.notificationLog.count({ where: { shipmentId: r.id, deliveryStatus: 'SENT' } })) >= 2);

    // hold the worker with a slow provider so we can inspect the payload that sits in Redis
    let release!: () => void;
    const gate = new Promise<void>((res) => (release = res));
    const adapter = wa(ctx);
    const original = adapter.send.bind(adapter);
    adapter.send = async (m) => {
      await gate;
      return original(m);
    };
    await notifications.notifyShipment(r.id, 'ARRIVED_AT_DEST_AGENT', ['RECIPIENT'], { otp: '735192' }, ':queue-test');

    const wq = queues.getQueue('whatsapp')!;
    const job = await waitFor(async () => (await wq.getJobs(['active', 'waiting', 'delayed']))[0]);
    expect(JSON.stringify(job.data)).not.toContain('735192'); // the OTP is not readable in Redis
    expect(job.data.bodyEnc).toEqual(expect.any(String));
    expect(job.opts.attempts).toBe(5);
    expect(job.opts.backoff).toMatchObject({ type: 'exponential' });

    release();
    const log = await waitFor(() => ctx.prisma.notificationLog.findFirst({ where: { shipmentId: r.id, eventCode: 'ARRIVED_AT_DEST_AGENT', deliveryStatus: 'SENT' } }));
    expect(log.renderedBody).not.toContain('735192');
    expect(wa(ctx).sent.some((m) => m.body.includes('*735192*'))).toBe(true);
    adapter.send = original;
  });

  it_('the cron job path works end to end: sweep job → parcel flagged RETURN_TO_SENDER', async () => {
    const queues = ctx.app.get(QueueService);
    const { createNetwork, shipInTransit, inboundScan, shipmentRow } = await import('./scenario');
    const net = await createNetwork(ctx);
    const { parcels, bagCode } = await shipInTransit(ctx, net, 1);
    await inboundScan(ctx, net.bcu.token, { code: bagCode, condition: 'INTACT' });
    await ctx.prisma.shipment.update({ where: { id: parcels[0]!.id }, data: { arrivedDestAt: new Date(Date.now() - 16 * DAY) } });

    await queues.enqueue('maintenance', 'unclaimed-sweep', {});
    await waitFor(async () => (await shipmentRow(ctx, parcels[0]!.waybill)).status === 'RETURN_TO_SENDER', 8000);
    void ctx.app.get(UnclaimedService);
  });
});
