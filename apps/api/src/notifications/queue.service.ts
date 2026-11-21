import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Queue, Worker, type JobsOptions } from 'bullmq';
import IORedis from 'ioredis';
import { ENV, type Env } from '../config/env';
import { DILI_TZ } from '@670send/pricing';

export type QueueName = 'whatsapp' | 'maintenance';

export interface JobContext {
  attempt: number;
  maxAttempts: number;
  jobName: string;
}

export type JobHandler = (data: any, ctx: JobContext) => Promise<void>;

const WHATSAPP_JOB_OPTS: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: { age: 3_600, count: 1_000 },
  removeOnFail: { age: 7 * 86_400 },
};

/**
 * Thin BullMQ wrapper.
 *  • QUEUES_ENABLED=true  (production / dev): jobs go through Redis with retries + backoff, and the
 *    maintenance schedules (daily 08:00 Asia/Dili unclaimed sweep, hourly perishable sweep) are registered.
 *  • QUEUES_ENABLED=false (tests): jobs run inline, immediately, errors swallowed + logged.
 * Handlers register themselves with registerHandler() — this avoids circular module dependencies.
 */
@Injectable()
export class QueueService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('Queue');
  private readonly handlers = new Map<string, JobHandler>();
  private readonly schedules: Array<{ id: string; pattern: string; jobName: string }> = [];
  private readonly queues = new Map<QueueName, Queue>();
  private readonly workers: Worker[] = [];
  private readonly connections: IORedis[] = [];

  constructor(@Inject(ENV) private readonly env: Env) {}

  /** Raw queue access for ops tooling and tests (undefined when queues are disabled). */
  getQueue(name: QueueName): Queue | undefined {
    return this.queues.get(name);
  }

  registerHandler(jobName: string, handler: JobHandler): void {
    this.handlers.set(jobName, handler);
  }

  /** Cron schedule (Asia/Dili) registered with BullMQ on boot; upserted by id, so restarts never duplicate it. */
  registerSchedule(id: string, pattern: string, jobName: string): void {
    if (!this.schedules.some((s) => s.id === id)) this.schedules.push({ id, pattern, jobName });
  }

  private connection(): IORedis {
    const c = new IORedis(this.env.REDIS_URL, { maxRetriesPerRequest: null });
    c.on('error', (e) => this.log.warn(`Redis: ${e.message}`));
    this.connections.push(c);
    return c;
  }

  async onApplicationBootstrap(): Promise<void> {
    if (!this.env.QUEUES_ENABLED) return;

    const run = (queueName: QueueName) => async (job: { name: string; data: unknown; attemptsMade: number; opts: JobsOptions }) => {
      const handler = this.handlers.get(job.name);
      if (!handler) throw new Error(`No handler registered for job "${job.name}"`);
      await handler(job.data, { attempt: job.attemptsMade + 1, maxAttempts: job.opts.attempts ?? 1, jobName: job.name });
      void queueName;
    };

    const whatsapp = new Queue('whatsapp', { connection: this.connection() });
    const maintenance = new Queue('maintenance', { connection: this.connection() });
    this.queues.set('whatsapp', whatsapp);
    this.queues.set('maintenance', maintenance);

    this.workers.push(
      new Worker('whatsapp', run('whatsapp'), { connection: this.connection(), concurrency: 5, limiter: { max: 20, duration: 1_000 } }),
      new Worker('maintenance', run('maintenance'), { connection: this.connection(), concurrency: 1 }),
    );
    for (const w of this.workers) w.on('error', (e) => this.log.error(`Worker error: ${e.message}`));

    // Idempotent: BullMQ upserts schedulers by id, so every API restart keeps exactly one of each.
    for (const s of this.schedules) {
      await maintenance.upsertJobScheduler(s.id, { pattern: s.pattern, tz: DILI_TZ }, { name: s.jobName });
    }
    this.log.log(`Queues ready: whatsapp, maintenance (${this.schedules.map((s) => s.id).join(', ')})`);
  }

  /** Enqueue (or run inline when queues are disabled). Never throws into business code. */
  async enqueue(queue: QueueName, jobName: string, data: unknown, opts: JobsOptions = {}): Promise<void> {
    try {
      if (!this.env.QUEUES_ENABLED) {
        const handler = this.handlers.get(jobName);
        if (handler) await handler(data, { attempt: 1, maxAttempts: 1, jobName });
        return;
      }
      const q = this.queues.get(queue);
      if (!q) throw new Error(`Queue ${queue} not started`);
      await q.add(jobName, data, { ...(queue === 'whatsapp' ? WHATSAPP_JOB_OPTS : {}), ...opts });
    } catch (err) {
      this.log.error(`enqueue ${queue}/${jobName} failed: ${(err as Error).message}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled(this.workers.map((w) => w.close()));
    await Promise.allSettled([...this.queues.values()].map((q) => q.close()));
    for (const c of this.connections) c.disconnect();
  }
}
