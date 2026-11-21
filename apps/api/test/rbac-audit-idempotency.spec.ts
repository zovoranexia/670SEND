import { randomUUID } from 'node:crypto';
import {
  SEED,
  bearer,
  createTestApp,
  createUser,
  loginEmail,
  pinToken,
  superToken,
  testState,
  tokenFor,
  waitFor,
  type TestCtx,
} from './helpers';

describe('RBAC guard, ownership scope, audit interceptor, idempotency', () => {
  let ctx: TestCtx;
  let sup: string;
  beforeAll(async () => {
    ctx = await createTestApp();
    sup = await superToken(ctx);
  });
  afterAll(() => ctx.close());
  beforeEach(() => {
    testState.counter = 0;
    testState.failOnce = true;
  });

  /* ------------------------------ RBAC ------------------------------ */
  describe('permissions', () => {
    it('lets the wildcard Super Admin through and blocks an agent (403, localized)', async () => {
      expect((await ctx.http.get('/v1/_test/admin-only').set(bearer(sup))).status).toBe(200);

      const agent = await pinToken(ctx, SEED.agentDiliPhone, SEED.pin());
      const denied = await ctx.http.get('/v1/_test/admin-only').set(bearer(agent)).set('X-Lang', 'pt');
      expect(denied.status).toBe(403);
      expect(denied.body.code).toBe('forbidden');
      expect(denied.body.message).toBe('Não tem permissão para esta ação.');
    });

    it('is DENY-BY-DEFAULT: a route without authorization metadata is refused, even for Super Admin', async () => {
      const res = await ctx.http.get('/v1/_test/forgotten').set(bearer(sup));
      expect(res.status).toBe(403);
    });

    it('requires authentication before anything else', async () => {
      expect((await ctx.http.get('/v1/_test/admin-only')).status).toBe(401);
      expect((await ctx.http.get('/v1/_test/whoami')).status).toBe(401);
    });

    it('@Authenticated lets any signed-in role through', async () => {
      const driver = await pinToken(ctx, SEED.driverPhone, SEED.pin());
      const res = await ctx.http.get('/v1/_test/whoami').set(bearer(driver));
      expect(res.status).toBe(200);
      expect(res.body.roles).toEqual(['DRIVER']);
    });

    it('applies the spec’s segregation of duties through real roles', async () => {
      const ops = await createUser(ctx, ['OPS_HUB_ADMIN']);
      const fin = await createUser(ctx, ['FINANCE_ADMIN']);
      const opsT = await tokenFor(ctx, ops);
      const finT = await tokenFor(ctx, fin);
      // settings:manage is Super-Admin only; shipments:override_status too → both denied
      expect((await ctx.http.post('/v1/_test/action').set(bearer(opsT)).set('Idempotency-Key', randomUUID()).send({})).status).toBe(403);
      expect((await ctx.http.post('/v1/_test/override').set(bearer(finT)).set('X-Audit-Reason', 'trying to override').send({})).status).toBe(403);
    });

    it('role changes take effect after the actor cache is invalidated', async () => {
      const u = await createUser(ctx, ['AGENT']);
      const t = await tokenFor(ctx, u);
      expect((await ctx.http.get('/v1/_test/admin-only').set(bearer(t))).status).toBe(403);
      const role = await ctx.prisma.role.findUniqueOrThrow({ where: { key: 'SUPER_ADMIN' } });
      await ctx.prisma.userRole.create({ data: { userId: u.id, roleId: role.id } });
      const { ActorService } = await import('../src/rbac/actor.service');
      ctx.app.get(ActorService).invalidate(u.id);
      expect((await ctx.http.get('/v1/_test/admin-only').set(bearer(t))).status).toBe(200);
    });

    it('blocks accounts flagged must_change_password from everything but the password change', async () => {
      const u = await createUser(ctx, ['SUPER_ADMIN'], { mustChangePassword: true });
      const t = await tokenFor(ctx, u);
      const blocked = await ctx.http.get('/v1/_test/admin-only').set(bearer(t)).set('X-Lang', 'en');
      expect(blocked.status).toBe(403);
      expect(blocked.body.code).toBe('password_change_required');
      expect(blocked.body.message).toBe('Change your password before continuing.');
      expect((await ctx.http.get('/v1/auth/me').set(bearer(t))).status).toBe(200);
      expect(
        (await ctx.http.post('/v1/auth/password/change').set(bearer(t)).send({ currentPassword: u.password, newPassword: 'Fresh-pass-phrase-42' })).status,
      ).toBe(204);
      const again = await loginEmail(ctx, u.email, 'Fresh-pass-phrase-42');
      expect((await ctx.http.get('/v1/_test/admin-only').set(bearer(again.body.accessToken))).status).toBe(200);
    });

    it('records AUTHZ_DENIED in the audit log', async () => {
      const u = await createUser(ctx, ['AGENT']);
      const t = await tokenFor(ctx, u);
      await ctx.http.get('/v1/_test/admin-only').set(bearer(t));
      const row = await waitFor(() => ctx.prisma.auditLog.findFirst({ where: { actorId: u.id, action: 'AUTHZ_DENIED' } }));
      expect(row.entityId).toBe('GET /v1/_test/admin-only');
      expect(row.actorRoles).toEqual(['AGENT']);
    });
  });

  /* --------------------------- ownership scope --------------------------- */
  describe('ownership scope (agent_id)', () => {
    it('an agent sees only their own resources — someone else’s looks like 404', async () => {
      const dili = await ctx.prisma.agent.findFirstOrThrow({ where: { agentCode: 'AG-DIL-001' } });
      const baucau = await ctx.prisma.agent.findFirstOrThrow({ where: { agentCode: 'AG-BCU-001' } });
      const diliT = await pinToken(ctx, SEED.agentDiliPhone, SEED.pin());

      expect((await ctx.http.get(`/v1/_test/shipment-of-agent/${dili.id}`).set(bearer(diliT))).status).toBe(200);
      const other = await ctx.http.get(`/v1/_test/shipment-of-agent/${baucau.id}`).set(bearer(diliT));
      expect(other.status).toBe(404);
    });

    it('a holder of the *_all permission bypasses the scope', async () => {
      const baucau = await ctx.prisma.agent.findFirstOrThrow({ where: { agentCode: 'AG-BCU-001' } });
      // Super Admin has *:* so shipments:read_all applies; shipments:read_own via wildcard too
      expect((await ctx.http.get(`/v1/_test/shipment-of-agent/${baucau.id}`).set(bearer(sup))).status).toBe(200);
    });

    it('a suspended agent loses their scope immediately', async () => {
      const u = await createUser(ctx, ['AGENT'], { agent: true });
      const agent = await ctx.prisma.agent.findFirstOrThrow({ where: { userId: u.id } });
      const t = await tokenFor(ctx, u);
      expect((await ctx.http.get(`/v1/_test/shipment-of-agent/${agent.id}`).set(bearer(t))).status).toBe(200);
      await ctx.prisma.agent.update({ where: { id: agent.id }, data: { status: 'SUSPENDED' } });
      const { ActorService } = await import('../src/rbac/actor.service');
      ctx.app.get(ActorService).invalidate(u.id);
      expect((await ctx.http.get(`/v1/_test/shipment-of-agent/${agent.id}`).set(bearer(t))).status).toBe(404);
    });
  });

  /* -------------------------------- audit -------------------------------- */
  describe('audit interceptor', () => {
    it('writes an immutable row with the actor, request id and REDACTED secrets', async () => {
      const key = randomUUID();
      const res = await ctx.http
        .post('/v1/_test/action')
        .set(bearer(sup))
        .set('Idempotency-Key', key)
        .send({ note: 'hello', pin: '123456', password: 'hunter2', nested: { token: 'abc', fine: 1 } });
      expect(res.status).toBe(201);

      const row = await waitFor(() => ctx.prisma.auditLog.findFirst({ where: { entityId: res.body.id, action: 'TEST_ACTION' } }));
      expect(row.entityType).toBe('test_entity');
      expect(row.actorRoles).toEqual(['SUPER_ADMIN']);
      expect(row.requestId).toBe(res.headers['x-request-id']);
      expect(row.after).toMatchObject({ note: 'hello', pin: '[REDACTED]', password: '[REDACTED]', nested: { token: '[REDACTED]', fine: 1 } });
      expect(JSON.stringify(row, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))).not.toMatch(/hunter2|123456/);
    });

    it('audit rows cannot be altered', async () => {
      const row = await ctx.prisma.auditLog.findFirstOrThrow();
      await expect(ctx.prisma.auditLog.update({ where: { id: row.id }, data: { action: 'tampered' } })).rejects.toThrow(/append-only/);
      await expect(ctx.prisma.auditLog.delete({ where: { id: row.id } })).rejects.toThrow(/append-only/);
    });

    it('force-override routes demand a reason (header or body) and store it', async () => {
      const none = await ctx.http.post('/v1/_test/override').set(bearer(sup)).set('X-Lang', 'en').send({});
      expect(none.status).toBe(400);
      expect(none.body.code).toBe('audit_reason_required');

      const short = await ctx.http.post('/v1/_test/override').set(bearer(sup)).set('X-Audit-Reason', 'no').send({});
      expect(short.status).toBe(400);

      const ok = await ctx.http.post('/v1/_test/override').set(bearer(sup)).set('X-Audit-Reason', 'Customer paid cash at hub, confirmed by CS').send({});
      expect(ok.status).toBe(201);
      const row = await waitFor(() => ctx.prisma.auditLog.findFirst({ where: { entityId: ok.body.id, action: 'TEST_OVERRIDE' } }));
      expect(row.reason).toBe('Customer paid cash at hub, confirmed by CS');

      const viaBody = await ctx.http.post('/v1/_test/override').set(bearer(sup)).send({ reason: 'Reason supplied in the body' });
      expect(viaBody.status).toBe(201);
    });
  });

  /* ------------------------------ idempotency ------------------------------ */
  describe('idempotency interceptor', () => {
    const post = (key: string | undefined, body: object = { note: 'x' }, path = '/v1/_test/action') => {
      const r = ctx.http.post(path).set(bearer(sup));
      if (key) r.set('Idempotency-Key', key);
      return r.send(body);
    };

    it('requires an Idempotency-Key (and a sane one)', async () => {
      const missing = await post(undefined);
      expect(missing.status).toBe(400);
      expect(missing.body.code).toBe('idempotency_key_required');
      expect((await post('short')).status).toBe(400);
      expect((await post('has spaces in it!!')).status).toBe(400);
      expect(testState.counter).toBe(0);
    });

    it('replays the stored response without re-running the handler', async () => {
      const key = randomUUID();
      const first = await post(key);
      const second = await post(key);
      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(second.body).toEqual(first.body);
      expect(first.headers['idempotent-replayed']).toBeUndefined();
      expect(second.headers['idempotent-replayed']).toBe('true');
      expect(testState.counter).toBe(1);
    });

    it('does not duplicate the audit row on a replay', async () => {
      const key = randomUUID();
      const first = await post(key);
      await post(key);
      await post(key);
      await new Promise((r) => setTimeout(r, 300));
      expect(await ctx.prisma.auditLog.count({ where: { entityId: first.body.id, action: 'TEST_ACTION' } })).toBe(1);
    });

    it('rejects the same key with a different body (422)', async () => {
      const key = randomUUID();
      await post(key, { note: 'a' });
      const clash = await post(key, { note: 'b' });
      expect(clash.status).toBe(422);
      expect(clash.body.code).toBe('idempotency_conflict');
      expect(testState.counter).toBe(1);
    });

    it('treats key order inside the body as irrelevant', async () => {
      const key = randomUUID();
      await post(key, { a: 1, b: { x: 1, y: 2 } });
      const again = await post(key, { b: { y: 2, x: 1 }, a: 1 });
      expect(again.headers['idempotent-replayed']).toBe('true');
    });

    it('scopes keys per caller: another user can neither replay nor probe my key', async () => {
      const key = randomUUID();
      const mine = await post(key);
      expect(mine.status).toBe(201);
      const other = await createUser(ctx, ['SUPER_ADMIN']);
      const t = await tokenFor(ctx, other);
      const theirs = await ctx.http.post('/v1/_test/action').set(bearer(t)).set('Idempotency-Key', key).send({ note: 'x' });
      expect(theirs.status).toBe(201);
      expect(theirs.headers['idempotent-replayed']).toBeUndefined();
      expect(testState.counter).toBe(2);
    });

    it('5 parallel identical requests run the handler exactly once', async () => {
      const key = randomUUID();
      const results = await Promise.all(Array.from({ length: 5 }, () => post(key, {}, '/v1/_test/slow-action')));
      const executed = results.filter((r) => r.status === 201 && r.headers['idempotent-replayed'] !== 'true');
      expect(executed).toHaveLength(1);
      for (const r of results) expect([201, 409]).toContain(r.status); // replay or "still in progress"
      expect(testState.counter).toBe(1);
      const busy = results.find((r) => r.status === 409);
      if (busy) expect(busy.body.code).toBe('request_in_progress');
    });

    it('releases the key when the handler fails so the client can retry', async () => {
      const key = randomUUID();
      const failed = await post(key, {}, '/v1/_test/flaky-action');
      expect(failed.status).toBe(500);
      const retried = await post(key, {}, '/v1/_test/flaky-action');
      expect(retried.status).toBe(201);
      expect(retried.body).toEqual({ recovered: true });
    });

    it('expired keys are reusable', async () => {
      const key = randomUUID();
      await post(key);
      await ctx.prisma.idempotencyKey.updateMany({ where: { key }, data: { expiresAt: new Date(Date.now() - 1000) } });
      const again = await post(key);
      expect(again.status).toBe(201);
      expect(again.headers['idempotent-replayed']).toBeUndefined();
    });
  });

  /* ------------------------------ platform ------------------------------ */
  describe('platform behaviour', () => {
    it('echoes / generates X-Request-Id and sets security headers', async () => {
      const res = await ctx.http.get('/v1/health').set('X-Request-Id', 'client-req-12345');
      expect(res.status).toBe(200);
      expect(res.headers['x-request-id']).toBe('client-req-12345');
      expect(res.headers['x-powered-by']).toBeUndefined();
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      const generated = await ctx.http.get('/v1/health').set('X-Request-Id', 'bad id with spaces');
      expect(generated.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('health/ready checks the database', async () => {
      const res = await ctx.http.get('/v1/health/ready');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'ready' });
    });

    it('unknown routes return a JSON error, never a stack trace', async () => {
      const res = await ctx.http.get('/v1/definitely/not/here').set(bearer(sup));
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('not_found');
      expect(JSON.stringify(res.body)).not.toMatch(/at .*\.(ts|js)/);
    });
  });
});
