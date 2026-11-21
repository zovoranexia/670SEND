import { randomInt, randomUUID } from 'node:crypto';
import { Controller, Get, Module, Param, Post, Body } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { PermissionKey } from '@670send/types';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import {
  Audit,
  AuditReasonRequired,
  Authenticated,
  CurrentActor,
  Idempotent,
  RequirePermissions,
} from '../src/common/decorators';
import { AppException } from '../src/common/errors';
import { PasswordService } from '../src/auth/password.service';
import { assertCanAccess } from '../src/rbac/scope';
import type { Actor } from '../src/rbac/actor';
import { StorageService } from '../src/storage/storage.service';

/* ------------------------------------------------------------------ */
/* In-memory object storage so tests never need MinIO / R2             */
/* ------------------------------------------------------------------ */
export class FakeStorage {
  readonly objects = new Map<string, { body: Buffer; contentType: string }>();
  async onModuleInit() {}
  uriFor(key: string) {
    return `s3://test-bucket/${key}`;
  }
  keyFromUri(uri: string) {
    return uri.replace('s3://test-bucket/', '');
  }
  async put(key: string, body: Buffer, contentType: string) {
    this.objects.set(key, { body, contentType });
    return this.uriFor(key);
  }
  async signedUrl(uri: string) {
    return { url: `https://signed.test/${this.keyFromUri(uri)}?sig=abc`, expiresIn: 300 };
  }
  async delete(uri: string) {
    this.objects.delete(this.keyFromUri(uri));
  }
}

/* ------------------------------------------------------------------ */
/* Throw-away controller exercising guards / audit / idempotency       */
/* ------------------------------------------------------------------ */
export const testState = { counter: 0, failOnce: true };

@Controller('_test')
export class TestController {
  @RequirePermissions('rbac:manage')
  @Get('admin-only')
  adminOnly() {
    return { ok: true };
  }

  /** No authorization metadata on purpose → must be denied (deny-by-default). */
  @Get('forgotten')
  forgotten() {
    return { ok: true };
  }

  @Authenticated()
  @Get('whoami')
  whoami(@CurrentActor() actor: Actor) {
    return { id: actor.id, roles: actor.roles };
  }

  @RequirePermissions('shipments:read_own')
  @Get('shipment-of-agent/:agentId')
  scoped(@CurrentActor() actor: Actor, @Param('agentId') agentId: string) {
    assertCanAccess(actor, { agentIds: [agentId] }, 'shipments:read_all');
    return { ok: true };
  }

  @RequirePermissions('settings:manage')
  @Idempotent()
  @Audit('TEST_ACTION', 'test_entity')
  @Post('action')
  action(@Body() body: Record<string, unknown>) {
    testState.counter += 1;
    return { id: randomUUID(), n: testState.counter, echo: body['note'] ?? null };
  }

  @RequirePermissions('settings:manage')
  @Idempotent()
  @Post('slow-action')
  async slowAction() {
    await new Promise((r) => setTimeout(r, 300));
    testState.counter += 1;
    return { n: testState.counter };
  }

  @RequirePermissions('settings:manage')
  @Idempotent()
  @Post('flaky-action')
  flaky() {
    if (testState.failOnce) {
      testState.failOnce = false;
      throw new AppException('internal_error', 500);
    }
    return { recovered: true };
  }

  @RequirePermissions('shipments:override_status')
  @AuditReasonRequired()
  @Audit('TEST_OVERRIDE', 'test_entity')
  @Post('override')
  override(@Body() body: Record<string, unknown>) {
    return { id: randomUUID(), body };
  }
}

@Module({ controllers: [TestController] })
export class TestControllersModule {}

/* ------------------------------------------------------------------ */
/* App / users / login helpers                                         */
/* ------------------------------------------------------------------ */
export interface TestCtx {
  app: INestApplication;
  http: ReturnType<typeof request>;
  storage: FakeStorage;
  prisma: PrismaClient;
  passwords: PasswordService;
  close: () => Promise<void>;
}

export async function createTestApp(): Promise<TestCtx> {
  const storage = new FakeStorage();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule, TestControllersModule] })
    .overrideProvider(StorageService)
    .useValue(storage)
    .compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();

  const prisma = new PrismaClient();
  // The test DB persists between runs: make sure earlier lockout tests never leave seeded users locked.
  await prisma.user.updateMany({ data: { lockedUntil: null, failedLoginCount: 0, failedPinCount: 0 } });
  return {
    app,
    http: request(app.getHttpServer()),
    storage,
    prisma,
    passwords: app.get(PasswordService),
    close: async () => {
      await prisma.$disconnect();
      await app.close();
    },
  };
}

export const SEED = {
  superadminEmail: () => (process.env.SEED_SUPERADMIN_EMAIL ?? 'superadmin@670send.test').toLowerCase(),
  superadminPassword: () => process.env.SEED_SUPERADMIN_PASSWORD ?? process.env.SEED_DEFAULT_PASSWORD ?? 'ChangeMe!670Send',
  pin: () => process.env.SEED_DEFAULT_PIN ?? '482913',
  agentDiliPhone: '+67077100001',
  agentBaucauPhone: '+67077100002',
  driverPhone: '+67077300002',
  courierPhone: '+67077200001',
};

export const uniquePhone = () => `+6707${randomInt(1_000_000, 9_999_999)}`;

export interface CreatedUser {
  id: string;
  email: string;
  phone: string;
  password: string;
  pin: string;
}

/** Creates an isolated user (never touches the seeded ones) with the given role keys. */
export async function createUser(
  ctx: TestCtx,
  roles: string[],
  opts: { mustChangePassword?: boolean; lang?: 'TET' | 'PT' | 'EN' | 'ID'; agent?: boolean } = {},
): Promise<CreatedUser> {
  const password = `Pw-${randomUUID()}-9x`;
  const pin = `${randomInt(100000, 999999)}`;
  const phone = uniquePhone();
  const email = `t-${randomUUID()}@670send.test`;
  const user = await ctx.prisma.user.create({
    data: {
      email,
      phone,
      fullName: 'Test User',
      passwordHash: await ctx.passwords.hash(password),
      pinHash: await ctx.passwords.hash(pin),
      preferredLang: opts.lang ?? 'TET',
      mustChangePassword: opts.mustChangePassword ?? false,
    },
  });
  for (const key of roles) {
    const role = await ctx.prisma.role.findUniqueOrThrow({ where: { key } });
    await ctx.prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  }
  if (opts.agent) {
    const dil = await ctx.prisma.municipality.findUniqueOrThrow({ where: { code: 'DIL' } });
    await ctx.prisma.agent.create({
      data: {
        userId: user.id,
        municipalityId: dil.id,
        agentCode: `AG-T-${randomUUID().slice(0, 8)}`,
        kioskName: 'Test Kiosk',
        address: 'Test',
        status: 'ACTIVE',
      },
    });
  }
  return { id: user.id, email, phone, password, pin };
}

export async function loginEmail(ctx: TestCtx, email: string, password: string) {
  const res = await ctx.http.post('/v1/auth/login').send({ email, password });
  return res;
}

export async function tokenFor(ctx: TestCtx, u: { email: string; password: string }): Promise<string> {
  const res = await loginEmail(ctx, u.email, u.password);
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.accessToken as string;
}

export async function superToken(ctx: TestCtx): Promise<string> {
  return tokenFor(ctx, { email: SEED.superadminEmail(), password: SEED.superadminPassword() });
}

export async function pinToken(ctx: TestCtx, phone: string, pin: string): Promise<string> {
  const res = await ctx.http.post('/v1/auth/login/pin').send({ phone, pin });
  if (res.status !== 200) throw new Error(`pin login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.accessToken as string;
}

export const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

export async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, ms = 3000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > ms) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 50));
  }
}

export type { PermissionKey };
