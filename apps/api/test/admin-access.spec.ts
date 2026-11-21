import { randomUUID } from 'node:crypto';
import { ActorService } from '../src/rbac/actor.service';
import { bearer, createTestApp, createUser, uniquePhone, type TestCtx } from './helpers';
import { agentIntake, createAgent, createNetwork, messagesTo } from './scenario';
import { cs, finance, ops, superAdmin } from './admin-helpers';

const strong = () => `Str0ng-${randomUUID().slice(0, 12)}`;

describe('Access administration: RBAC, staff accounts, audit trail', () => {
  let ctx: TestCtx;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());

  const roleBody = (over: object = {}) => ({ key: `ROLE_${randomUUID().slice(0, 8).toUpperCase().replace(/-/g, '')}`, name: 'Custom role', permissions: ['hubs:read'], ...over });
  const mkRole = async (token: string, over: object = {}) => ctx.http.post('/v1/admin/roles').set(bearer(token)).send(roleBody(over));

  /* ----------------------------------------------- roles ----------------------------------------------- */
  describe('roles and the permission matrix', () => {
    it('lists the 8 system roles (Super Admin locked) and the grouped catalog without the wildcard', async () => {
      const sa = await superAdmin(ctx);
      const roles = await ctx.http.get('/v1/admin/roles').set(bearer(sa.token));
      expect(roles.status).toBe(200);
      const keys = roles.body.filter((r: { isSystem: boolean }) => r.isSystem).map((r: { key: string }) => r.key).sort();
      expect(keys).toEqual(['AGENT', 'COURIER', 'CS_CLAIMS_ADMIN', 'DRIVER', 'FINANCE_ADMIN', 'FLEET_OWNER', 'OPS_HUB_ADMIN', 'SUPER_ADMIN']);
      expect(roles.body.find((r: { key: string }) => r.key === 'SUPER_ADMIN')).toMatchObject({ locked: true, permissions: ['*:*'] });
      const finRole = roles.body.find((r: { key: string }) => r.key === 'FINANCE_ADMIN');
      expect(finRole.permissions).toContain('deposits:approve');
      expect(finRole.permissions).not.toContain('shipments:override_status');

      const catalog = await ctx.http.get('/v1/admin/permissions').set(bearer(sa.token));
      expect(catalog.body.find((g: { module: string }) => g.module === 'payouts').permissions.map((p: { key: string }) => p.key)).toEqual(expect.arrayContaining(['payouts:create', 'payouts:approve']));
      expect(JSON.stringify(catalog.body)).not.toContain('*:*');
    });

    it('only Super Admin manages roles', async () => {
      for (const who of [await finance(ctx), await ops(ctx), await cs(ctx)]) {
        expect((await ctx.http.get('/v1/admin/roles').set(bearer(who.token))).status).toBe(403);
        expect((await mkRole(who.token)).status).toBe(403);
      }
    });

    it('creates custom roles with validation: key format, duplicates, unknown permissions and the wildcard', async () => {
      const sa = await superAdmin(ctx);
      const ok = await mkRole(sa.token, { permissions: ['hubs:read', 'shipments:read_all'] });
      expect(ok.status).toBe(201);
      expect(ok.body).toMatchObject({ isSystem: false, locked: false, userCount: 0, permissions: ['hubs:read', 'shipments:read_all'] });
      expect((await mkRole(sa.token, { key: ok.body.key })).status).toBe(409);
      expect((await mkRole(sa.token, { key: 'lower_case' })).status).toBe(422);
      const unknown = await mkRole(sa.token, { permissions: ['hubs:read', 'moon:launch'] });
      expect(unknown.status).toBe(422);
      expect(JSON.stringify(unknown.body.details)).toContain('moon:launch');
      const wildcard = await mkRole(sa.token, { permissions: ['*:*'] });
      expect(wildcard.status).toBe(403);
      expect(wildcard.body.code).toBe('role_locked');
    });

    it('permission edits take effect IMMEDIATELY for users already holding the role', async () => {
      const sa = await superAdmin(ctx);
      const role = (await mkRole(sa.token, { permissions: ['hubs:read'] })).body;
      const staff = (await ctx.http.post('/v1/admin/users').set(bearer(sa.token)).send({ fullName: 'Warehouse Viewer', phone: uniquePhone(), email: `wv-${randomUUID()}@670send.test`, roles: [role.key], password: strong() })).body;
      // sign in as that user
      const pw = strong();
      await ctx.http.post(`/v1/admin/users/${staff.id}/reset-credentials`).set(bearer(sa.token)).send({ password: pw });
      await ctx.prisma.user.update({ where: { id: staff.id }, data: { mustChangePassword: false } });
      const login = await ctx.http.post('/v1/auth/login').send({ email: staff.email, password: pw });
      const token = login.body.accessToken as string;

      expect((await ctx.http.get('/v1/shipments').set(bearer(token))).status).toBe(403);
      const granted = await ctx.http.put(`/v1/admin/roles/${role.id}/permissions`).set(bearer(sa.token)).send({ permissions: ['hubs:read', 'shipments:read_all'] });
      expect(granted.status).toBe(200);
      expect((await ctx.http.get('/v1/shipments').set(bearer(token))).status).toBe(200); // same token, new rights
      await ctx.http.put(`/v1/admin/roles/${role.id}/permissions`).set(bearer(sa.token)).send({ permissions: ['hubs:read'] });
      expect((await ctx.http.get('/v1/shipments').set(bearer(token))).status).toBe(403); // and revoked just as fast
    });

    it('Super Admin and system roles are protected; custom roles in use cannot be deleted', async () => {
      const sa = await superAdmin(ctx);
      const roles = (await ctx.http.get('/v1/admin/roles').set(bearer(sa.token))).body;
      const superRole = roles.find((r: { key: string }) => r.key === 'SUPER_ADMIN');
      const agentRole = roles.find((r: { key: string }) => r.key === 'AGENT');
      for (const call of [
        ctx.http.put(`/v1/admin/roles/${superRole.id}/permissions`).set(bearer(sa.token)).send({ permissions: ['hubs:read'] }),
        ctx.http.patch(`/v1/admin/roles/${superRole.id}`).set(bearer(sa.token)).send({ name: 'Hacked' }),
        ctx.http.delete(`/v1/admin/roles/${superRole.id}`).set(bearer(sa.token)),
        ctx.http.delete(`/v1/admin/roles/${agentRole.id}`).set(bearer(sa.token)),
      ]) {
        const r = await call;
        expect(r.status).toBe(403);
        expect(r.body.code).toBe('role_locked');
      }
      const custom = (await mkRole(sa.token)).body;
      await ctx.http.post('/v1/admin/users').set(bearer(sa.token)).send({ fullName: 'Holder One', phone: uniquePhone(), email: `h-${randomUUID()}@670send.test`, roles: [custom.key], password: strong() });
      expect((await ctx.http.delete(`/v1/admin/roles/${custom.id}`).set(bearer(sa.token))).body.code).toBe('role_in_use');
      const unused = (await mkRole(sa.token)).body;
      expect((await ctx.http.patch(`/v1/admin/roles/${unused.id}`).set(bearer(sa.token)).send({ name: 'Renamed' })).body.name).toBe('Renamed');
      expect((await ctx.http.delete(`/v1/admin/roles/${unused.id}`).set(bearer(sa.token))).status).toBe(204);
    });
  });

  /* ----------------------------------------------- users ----------------------------------------------- */
  describe('staff accounts', () => {
    const body = (over: object = {}) => ({ fullName: 'Maria Staff', phone: uniquePhone(), email: `s-${randomUUID()}@670send.test`, roles: ['CS_CLAIMS_ADMIN'], password: strong(), ...over });

    it('creates a staff user who must change the first password before doing anything else', async () => {
      const sa = await superAdmin(ctx);
      const b = body();
      const r = await ctx.http.post('/v1/admin/users').set(bearer(sa.token)).send(b);
      expect(r.status).toBe(201);
      expect(r.body).toMatchObject({ roles: ['CS_CLAIMS_ADMIN'], isActive: true, mustChangePassword: true, lang: 'tet' });
      expect(JSON.stringify(r.body)).not.toMatch(/hash|argon|password":"/i);
      const login = await ctx.http.post('/v1/auth/login').send({ email: b.email, password: b.password });
      expect(login.status).toBe(200);
      const blocked = await ctx.http.get('/v1/claims').set(bearer(login.body.accessToken));
      expect(blocked.body.code).toBe('password_change_required');
    });

    it('enforces the password policy, unique e-mail / phone, and keeps field roles out of this endpoint', async () => {
      const sa = await superAdmin(ctx);
      const b = body();
      expect((await ctx.http.post('/v1/admin/users').set(bearer(sa.token)).send(body({ password: 'short1' }))).status).toBe(422);
      expect((await ctx.http.post('/v1/admin/users').set(bearer(sa.token)).send(body({ password: 'nodigitsatall' }))).status).toBe(422);
      expect((await ctx.http.post('/v1/admin/users').set(bearer(sa.token)).send(b)).status).toBe(201);
      const dupMail = await ctx.http.post('/v1/admin/users').set(bearer(sa.token)).send(body({ email: b.email }));
      expect([dupMail.status, dupMail.body.code]).toEqual([409, 'user_exists']);
      expect((await ctx.http.post('/v1/admin/users').set(bearer(sa.token)).send(body({ phone: b.phone }))).status).toBe(409);
      expect((await ctx.http.post('/v1/admin/users').set(bearer(sa.token)).send(body({ roles: ['AGENT'] }))).status).toBe(422); // partners go through the directory
      expect((await ctx.http.post('/v1/admin/users').set(bearer(sa.token)).send(body({ roles: ['NO_SUCH_ROLE'] }))).status).toBe(422);
    });

    it('only a Super Admin may create or grant Super Admin — even a user-manager cannot', async () => {
      const sa = await superAdmin(ctx);
      const role = (await mkRole(sa.token, { permissions: ['users:manage'] })).body;
      const mgr = (await ctx.http.post('/v1/admin/users').set(bearer(sa.token)).send(body({ roles: [role.key], password: 'Mgr-Passw0rd-1234' }))).body;
      await ctx.prisma.user.update({ where: { id: mgr.id }, data: { mustChangePassword: false } });
      const token = (await ctx.http.post('/v1/auth/login').send({ email: mgr.email, password: 'Mgr-Passw0rd-1234' })).body.accessToken as string;
      expect((await ctx.http.get('/v1/admin/users').set(bearer(token))).status).toBe(200);
      expect((await ctx.http.post('/v1/admin/users').set(bearer(token)).send(body({ roles: ['SUPER_ADMIN'] }))).status).toBe(403);
      const target = (await ctx.http.post('/v1/admin/users').set(bearer(token)).send(body())).body;
      expect((await ctx.http.put(`/v1/admin/users/${target.id}/roles`).set(bearer(token)).send({ roles: ['SUPER_ADMIN'] })).status).toBe(403);
    });

    it('role assignment: never your own, effective immediately, replaces the set; partners are untouchable here', async () => {
      const sa = await superAdmin(ctx);
      expect((await ctx.http.put(`/v1/admin/users/${sa.user.id}/roles`).set(bearer(sa.token)).send({ roles: ['CS_CLAIMS_ADMIN'] })).status).toBe(403); // no self change
      const u = (await ctx.http.post('/v1/admin/users').set(bearer(sa.token)).send(body({ roles: ['CS_CLAIMS_ADMIN'], password: 'Role-Passw0rd-12' }))).body;
      await ctx.prisma.user.update({ where: { id: u.id }, data: { mustChangePassword: false } });
      const token = (await ctx.http.post('/v1/auth/login').send({ email: u.email, password: 'Role-Passw0rd-12' })).body.accessToken as string;
      expect((await ctx.http.get('/v1/claims').set(bearer(token))).status).toBe(200);
      expect((await ctx.http.get('/v1/finance/reconciliation').set(bearer(token))).status).toBe(403);
      expect((await ctx.http.get('/v1/admin/notification-logs').set(bearer(token))).status).toBe(200);
      const changed = await ctx.http.put(`/v1/admin/users/${u.id}/roles`).set(bearer(sa.token)).send({ roles: ['FINANCE_ADMIN'] });
      expect(changed.body.roles).toEqual(['FINANCE_ADMIN']);
      expect((await ctx.http.get('/v1/finance/reconciliation').set(bearer(token))).status).toBe(200); // same token
      expect((await ctx.http.get('/v1/admin/notification-logs').set(bearer(token))).status).toBe(403); // CS-only right, gone with the old role

      const agent = await createAgent(ctx, 'DIL', '0');
      expect((await ctx.http.put(`/v1/admin/users/${agent.user.id}/roles`).set(bearer(sa.token)).send({ roles: ['CS_CLAIMS_ADMIN'] })).status).toBe(422);
    });

    it('the LAST active Super Admin can never be removed or deactivated', async () => {
      const sa = await superAdmin(ctx);
      const role = (await mkRole(sa.token, { permissions: ['users:manage'] })).body;
      const mgrBody = body({ roles: [role.key], password: 'Mgr2-Passw0rd-123' });
      const mgr = (await ctx.http.post('/v1/admin/users').set(bearer(sa.token)).send(mgrBody)).body;
      await ctx.prisma.user.update({ where: { id: mgr.id }, data: { mustChangePassword: false } });
      const mgrToken = (await ctx.http.post('/v1/auth/login').send({ email: mgrBody.email, password: mgrBody.password })).body.accessToken as string;

      // make `sa` the only active Super Admin, temporarily
      const others = await ctx.prisma.user.findMany({ where: { id: { not: sa.user.id }, isActive: true, userRoles: { some: { role: { key: 'SUPER_ADMIN' } } } }, select: { id: true } });
      await ctx.prisma.user.updateMany({ where: { id: { in: others.map((o) => o.id) } }, data: { isActive: false } });
      ctx.app.get(ActorService).invalidate();
      try {
        const r = await ctx.http.post(`/v1/admin/users/${sa.user.id}/deactivate`).set(bearer(mgrToken)).send({});
        expect([r.status, r.body.code]).toEqual([409, 'last_super_admin']);
        // a second Super Admin makes removal possible again
        const second = await superAdmin(ctx);
        expect((await ctx.http.post(`/v1/admin/users/${second.user.id}/deactivate`).set(bearer(mgrToken)).send({})).status).toBe(200);
      } finally {
        await ctx.prisma.user.updateMany({ where: { id: { in: others.map((o) => o.id) } }, data: { isActive: true } });
        ctx.app.get(ActorService).invalidate();
      }
    });

    it('deactivation ends every session at once; reset-credentials replaces the secret; unlock clears a lock-out', async () => {
      const sa = await superAdmin(ctx);
      const b = body({ password: 'First-Passw0rd-1' });
      const u = (await ctx.http.post('/v1/admin/users').set(bearer(sa.token)).send(b)).body;
      await ctx.prisma.user.update({ where: { id: u.id }, data: { mustChangePassword: false } });
      const login = await ctx.http.post('/v1/auth/login').send({ email: b.email, password: b.password });
      const token = login.body.accessToken as string;
      expect((await ctx.http.get('/v1/auth/me').set(bearer(token))).status).toBe(200);

      expect((await ctx.http.post(`/v1/admin/users/${sa.user.id}/deactivate`).set(bearer(sa.token)).send({})).status).toBe(403); // not yourself
      const off = await ctx.http.post(`/v1/admin/users/${u.id}/deactivate`).set(bearer(sa.token)).send({ reason: 'Left the company' });
      expect(off.body.isActive).toBe(false);
      expect((await ctx.http.get('/v1/auth/me').set(bearer(token))).status).toBe(401); // the live access token dies immediately
      expect((await ctx.http.post('/v1/auth/refresh').send({ refreshToken: login.body.refreshToken })).status).toBe(401);
      expect((await ctx.http.post('/v1/auth/login').send({ email: b.email, password: b.password })).body.code).toBe('account_inactive');
      expect((await ctx.http.post(`/v1/admin/users/${u.id}/activate`).set(bearer(sa.token))).body.isActive).toBe(true);

      const newPw = 'Second-Passw0rd-2';
      const reset = await ctx.http.post(`/v1/admin/users/${u.id}/reset-credentials`).set(bearer(sa.token)).send({ password: newPw });
      expect(reset.body.mustChangePassword).toBe(true);
      expect((await ctx.http.post('/v1/auth/login').send({ email: b.email, password: b.password })).status).toBe(401);
      expect((await ctx.http.post('/v1/auth/login').send({ email: b.email, password: newPw })).status).toBe(200);
      expect((await ctx.http.post(`/v1/admin/users/${u.id}/reset-credentials`).set(bearer(sa.token)).send({})).status).toBe(422);

      for (let i = 0; i < 5; i++) await ctx.http.post('/v1/auth/login').send({ email: b.email, password: 'wrong-wrong-1' });
      expect((await ctx.http.get(`/v1/admin/users/${u.id}`).set(bearer(sa.token))).body.locked).toBe(true);
      expect((await ctx.http.post(`/v1/admin/users/${u.id}/unlock`).set(bearer(sa.token))).body.locked).toBe(false);
      expect((await ctx.http.post('/v1/auth/login').send({ email: b.email, password: newPw })).status).toBe(200);
    });

    it('search and filters; the technical system user is not listed; unknown ids are 404', async () => {
      const sa = await superAdmin(ctx);
      const tag = randomUUID().slice(0, 8);
      await ctx.http.post('/v1/admin/users').set(bearer(sa.token)).send(body({ fullName: `Zebra ${tag} Tester` }));
      const found = await ctx.http.get(`/v1/admin/users?q=${tag}`).set(bearer(sa.token));
      expect(found.body).toHaveLength(1);
      expect(found.body[0].fullName).toContain(tag);
      const all = await ctx.http.get('/v1/admin/users?limit=100').set(bearer(sa.token));
      expect(all.body.some((u: { email: string }) => u.email === 'system@670send.internal')).toBe(false);
      expect((await ctx.http.get(`/v1/admin/users?role=SUPER_ADMIN&active=true`).set(bearer(sa.token))).body.every((u: { roles: string[] }) => u.roles.includes('SUPER_ADMIN'))).toBe(true);
      expect((await ctx.http.get(`/v1/admin/users/${randomUUID()}`).set(bearer(sa.token))).status).toBe(404);
      expect((await ctx.http.get('/v1/admin/users').set(bearer((await finance(ctx)).token))).status).toBe(403);
    });
  });

  /* ------------------------------------------------ audit ------------------------------------------------ */
  describe('audit trail viewer', () => {
    it('shows who changed what with before / after, and never a secret', async () => {
      const sa = await superAdmin(ctx);
      const role = (await mkRole(sa.token, { permissions: ['hubs:read'] })).body;
      await ctx.http.put(`/v1/admin/roles/${role.id}/permissions`).set(bearer(sa.token)).send({ permissions: ['hubs:read', 'tariffs:read'] });
      const pw = strong();
      const u = (await ctx.http.post('/v1/admin/users').set(bearer(sa.token)).send({ fullName: 'Audit Subject', phone: uniquePhone(), email: `a-${randomUUID()}@670send.test`, roles: ['CS_CLAIMS_ADMIN'], password: pw })).body;
      await ctx.http.post(`/v1/admin/users/${u.id}/reset-credentials`).set(bearer(sa.token)).send({ password: strong(), pin: '482913' });

      const logs = await ctx.http.get(`/v1/admin/audit-logs?entityType=role&entityId=${role.id}&action=ROLE_PERMISSIONS_CHANGED`).set(bearer(sa.token));
      expect(logs.status).toBe(200);
      expect(logs.body).toHaveLength(1);
      expect(logs.body[0]).toMatchObject({ actor: 'Test User', actorRoles: ['SUPER_ADMIN'], before: { permissions: ['hubs:read'] }, after: { permissions: ['hubs:read', 'tariffs:read'] } });
      expect(logs.body[0].requestId).toBeTruthy();

      const dump = JSON.stringify((await ctx.http.get('/v1/admin/audit-logs?limit=200').set(bearer(sa.token))).body);
      expect(dump).not.toContain(pw);
      expect(dump).not.toContain('482913');
      expect(dump).toContain('USER_CREDENTIALS_RESET');

      expect((await ctx.http.get('/v1/admin/audit-logs').set(bearer((await finance(ctx)).token))).status).toBe(403);
      expect((await ctx.http.get(`/v1/admin/audit-logs?actorId=${sa.user.id}&limit=5`).set(bearer(sa.token))).body.length).toBeGreaterThan(0);
    });
  });
});

/* ======================================================================================================== */

describe('Content administration: WhatsApp templates, tariffs, settings', () => {
  let ctx: TestCtx;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());

  const put = (token: string, path: string, body: object) => ctx.http.put(path).set(bearer(token)).send(body);

  describe('templates (4 languages × 11 events)', () => {
    it('lists all 44 with their allowed variables', async () => {
      const sa = await superAdmin(ctx);
      const r = await ctx.http.get('/v1/admin/templates').set(bearer(sa.token));
      expect(r.status).toBe(200);
      expect(r.body).toHaveLength(44);
      const arrived = r.body.find((t: { eventCode: string; lang: string }) => t.eventCode === 'ARRIVED_AT_DEST_AGENT' && t.lang === 'pt');
      expect(arrived.allowedVariables).toEqual(expect.arrayContaining(['otp', 'kioskName']));
      expect(arrived.isDefaultText).toBe(true);
      expect((await ctx.http.get('/v1/admin/templates').set(bearer((await finance(ctx)).token))).status).toBe(403);
    });

    it('a saved edit goes live at once — the next real customer message uses it — and reset restores the default', async () => {
      const sa = await superAdmin(ctx);
      const n = await createNetwork(ctx);
      try {
        const upd = await put(sa.token, '/v1/admin/templates/DROPPED_AT_ORIGIN/en', { bodyTemplate: 'NEW WORDING {{waybill}} / {{trackUrl}}' });
        expect(upd.status).toBe(200);
        expect(upd.body).toMatchObject({ isDefaultText: false, bodyTemplate: 'NEW WORDING {{waybill}} / {{trackUrl}}' });
        const senderPhone = uniquePhone();
        const r = await agentIntake(ctx, n.dili, { destAgentId: n.bcu.agentId, senderLang: 'en', senderPhone });
        expect(messagesTo(ctx, senderPhone)[0]!.body).toMatch(new RegExp(`^NEW WORDING ${r.waybill} / https?://\\S+/en/track\\?no=${r.waybill}$`)); // link opens the site in the sender's language
      } finally {
        const reset = await ctx.http.post('/v1/admin/templates/DROPPED_AT_ORIGIN/en/reset').set(bearer(sa.token));
        expect(reset.body.isDefaultText).toBe(true);
      }
      const senderPhone = uniquePhone();
      await agentIntake(ctx, n.dili, { destAgentId: n.bcu.agentId, senderLang: 'en', senderPhone });
      expect(messagesTo(ctx, senderPhone)[0]!.body).toContain('Parcel received!');
    });

    it('guards against broken templates: unknown variables, a pickup message without the OTP, empty or oversize text', async () => {
      const sa = await superAdmin(ctx);
      const bad = await put(sa.token, '/v1/admin/templates/DROPPED_AT_ORIGIN/tet', { bodyTemplate: 'Resi {{waybill}} {{customerSecret}}' });
      expect(bad.status).toBe(422);
      expect(bad.body.code).toBe('template_variable_invalid');
      expect(bad.body.message).toContain('customerSecret');
      const noOtp = await put(sa.token, '/v1/admin/templates/ARRIVED_AT_DEST_AGENT/id', { bodyTemplate: 'Paket Anda sudah tiba di {{kioskName}}.' });
      expect([noOtp.status, noOtp.body.code]).toEqual([422, 'template_otp_required']);
      expect((await put(sa.token, '/v1/admin/templates/DROPPED_AT_ORIGIN/tet', { bodyTemplate: 'x' })).status).toBe(422);
      expect((await put(sa.token, '/v1/admin/templates/DROPPED_AT_ORIGIN/tet', { bodyTemplate: 'x'.repeat(1001) })).status).toBe(422);
      expect((await put(sa.token, '/v1/admin/templates/NOT_AN_EVENT/tet', { bodyTemplate: 'Hello there' })).status).toBe(422);
      expect((await put(sa.token, '/v1/admin/templates/DROPPED_AT_ORIGIN/xx', { bodyTemplate: 'Hello there' })).status).toBe(422);
      // ARRIVED may be *disabled* without the OTP (then the built-in default is used)
      expect((await put(sa.token, '/v1/admin/templates/ARRIVED_AT_DEST_AGENT/id', { isActive: false })).status).toBe(200);
      await put(sa.token, '/v1/admin/templates/ARRIVED_AT_DEST_AGENT/id', { isActive: true });
    });

    it('preview renders the draft with sample data before saving', async () => {
      const sa = await superAdmin(ctx);
      const p = await ctx.http.post('/v1/admin/templates/ARRIVED_AT_DEST_AGENT/pt/preview').set(bearer(sa.token)).send({ bodyTemplate: 'Olá! {{kioskName}} — código *{{otp}}*' });
      expect(p.status).toBe(200);
      expect(p.body).toMatchObject({ text: 'Olá! Kios 670Link Baucau Vila — código *123456*', variablesUsed: ['kioskName', 'otp'] });
      expect((await ctx.http.post('/v1/admin/templates/IN_TRANSIT/pt/preview').set(bearer(sa.token)).send({ bodyTemplate: 'Use {{otp}} here' })).status).toBe(422);
    });

    it('the delivery log is searchable by status and shipment (OTP already masked)', async () => {
      const n = await createNetwork(ctx);
      const desk = await cs(ctx);
      const r = await agentIntake(ctx, n.dili, { destAgentId: n.bcu.agentId });
      const logs = await ctx.http.get(`/v1/admin/notification-logs?shipmentId=${r.id}&status=SENT`).set(bearer(desk.token));
      expect(logs.status).toBe(200);
      expect(logs.body.map((l: { event: string }) => l.event)).toEqual(['DROPPED_AT_ORIGIN', 'DROPPED_AT_ORIGIN']);
      expect(logs.body.map((l: { audience: string }) => l.audience).sort()).toEqual(['RECIPIENT', 'SENDER']);
      expect(logs.body[0]).toMatchObject({ waybill: r.waybill, provider: 'console', status: 'SENT' });
      expect((await ctx.http.get('/v1/admin/notification-logs').set(bearer((await finance(ctx)).token))).status).toBe(403);
    });
  });

  describe('tariffs (changes apply to FUTURE shipments only)', () => {
    const quote = (over: object = {}) => ctx.http.post('/v1/public/quote').send({ destMunicipalityCode: 'BCU', parcel: { actualWeightKg: 2, lengthCm: 30, widthCm: 20, heightCm: 10 }, ...over });

    it('editing a zone changes new quotes; shipments already created keep their pricing snapshot', async () => {
      const fin = await finance(ctx);
      const n = await createNetwork(ctx);
      const before = await agentIntake(ctx, n.dili, { destAgentId: n.bcu.agentId });
      expect(before.body.shipment.fees.base.usd).toBe('4.0000');
      try {
        const upd = await put(fin.token, '/v1/admin/tariffs/zones/ZONE_2', { smallBase2kg: '5.50', names: { en: 'Zone 2 (Mid-range)' }, eta: { en: '1-2 days' } });
        expect(upd.status).toBe(200);
        expect(upd.body).toMatchObject({ smallBase2kg: '5.5000', names: { en: 'Zone 2 (Mid-range)' }, eta: { en: '1-2 days' } });
        expect((await quote()).body.total.usd).toBe('5.5000');
        const after = await agentIntake(ctx, n.dili, { destAgentId: n.bcu.agentId });
        expect(after.body.shipment.fees.base.usd).toBe('5.5000');
        // the old parcel is untouched
        const old = await ctx.prisma.shipment.findUniqueOrThrow({ where: { id: before.id } });
        expect(old.baseShippingFeeUsd.toFixed(4)).toBe('4.0000');
        expect((old.pricingSnapshot as { rates: { smallBase2kg: string } }).rates.smallBase2kg).toBe('4.0000');
        // …and its money split was computed on $4.00
        expect((await ctx.prisma.shipmentSettlement.findUniqueOrThrow({ where: { shipmentId: before.id } })).fleetShareUsd.toFixed(4)).toBe('1.6000');
        expect((await ctx.prisma.auditLog.findFirst({ where: { action: 'TARIFF_ZONE_UPDATED' }, orderBy: { id: 'desc' } }))!.before).toMatchObject({ smallBase2kg: '4.0000' });
      } finally {
        await put(fin.token, '/v1/admin/tariffs/zones/ZONE_2', { smallBase2kg: '4.00', names: { en: 'Zone 2 (Mid)' }, eta: { en: '1 day' } });
      }
      expect((await quote()).body.total.usd).toBe('4.0000');
    });

    it('validates money, restricts writes to Finance — but agents and couriers may read the table', async () => {
      const fin = await finance(ctx);
      expect((await put(fin.token, '/v1/admin/tariffs/zones/ZONE_1', { smallBase2kg: '-1' })).status).toBe(422);
      expect((await put(fin.token, '/v1/admin/tariffs/zones/ZONE_1', { smallBase2kg: '1.23456' })).status).toBe(422);
      expect((await put(fin.token, '/v1/admin/tariffs/zones/ZONE_9', { smallBase2kg: '1' })).status).toBe(404);
      expect((await put((await ops(ctx)).token, '/v1/admin/tariffs/zones/ZONE_1', { smallBase2kg: '3.00' })).status).toBe(403);
      const agent = await createAgent(ctx, 'DIL', '0');
      expect((await put(agent.token, '/v1/admin/tariffs/zones/ZONE_1', { smallBase2kg: '3.00' })).status).toBe(403);
      const table = await ctx.http.get('/v1/admin/tariffs').set(bearer(agent.token));
      expect(table.status).toBe(200);
      expect(table.body.zones).toHaveLength(4);
      expect(table.body.addons.map((a: { serviceType: string }) => a.serviceType).sort()).toEqual(['CARGO_DELIVERY', 'CARGO_PICKUP', 'MOTOR_DELIVERY', 'MOTOR_PICKUP']);
      expect(table.body.municipalities.find((m: { code: string }) => m.code === 'OEC')).toMatchObject({ isSeaRoute: true, surcharge: '2.0000', zone: 'ZONE_4' });
    });

    it('add-on fee and the courier/platform split (always 100 %) flow into quotes', async () => {
      const fin = await finance(ctx);
      try {
        const upd = await put(fin.token, '/v1/admin/tariffs/addons/MOTOR_DELIVERY', { fee: '2.00', courierSplitPct: '70' });
        expect(upd.body).toMatchObject({ fee: '2.0000', courierSplitPct: '70.00', platformSplitPct: '30.00' });
        const q = await quote({ scheme: 'SCHEME_C' });
        expect(q.body.deliveryAddon).toMatchObject({ fee: { usd: '2.0000' }, courierShare: { usd: '1.4000' }, platformShare: { usd: '0.6000' } });
        expect((await put(fin.token, '/v1/admin/tariffs/addons/MOTOR_DELIVERY', { courierSplitPct: '101' })).status).toBe(422);
        await put(fin.token, '/v1/admin/tariffs/addons/MOTOR_DELIVERY', { isActive: false });
        expect((await quote({ scheme: 'SCHEME_C' })).body.code).toBe('addon_not_available'); // a disabled service cannot be sold
      } finally {
        await put(fin.token, '/v1/admin/tariffs/addons/MOTOR_DELIVERY', { fee: '1.50', courierSplitPct: '80', isActive: true });
      }
      expect((await quote({ scheme: 'SCHEME_C' })).body.deliveryAddon.courierShare.usd).toBe('1.2000');
    });

    it('the Oecusse surcharge is editable per municipality', async () => {
      const fin = await finance(ctx);
      const oec = () => ctx.http.post('/v1/public/quote').send({ destMunicipalityCode: 'OEC', parcel: { actualWeightKg: 2, lengthCm: 30, widthCm: 20, heightCm: 10 } });
      expect((await oec()).body.total.usd).toBe('8.0000');
      try {
        expect((await put(fin.token, '/v1/admin/tariffs/municipalities/OEC/surcharge', { surcharge: '3.00' })).body.surcharge).toBe('3.0000');
        expect((await oec()).body.total.usd).toBe('9.0000');
      } finally {
        await put(fin.token, '/v1/admin/tariffs/municipalities/OEC/surcharge', { surcharge: '2.00' });
      }
      expect((await oec()).body.total.usd).toBe('8.0000');
    });
  });

  describe('settings', () => {
    it('only settings the system really reads can be edited — and invalid values are refused', async () => {
      const sa = await superAdmin(ctx);
      const list = await ctx.http.get('/v1/admin/settings').set(bearer(sa.token));
      const flags = Object.fromEntries(list.body.map((s: { key: string; editable: boolean }) => [s.key, s.editable]));
      expect(flags).toMatchObject({ bus_capacity: true, claim_cs_approval_limit_usd: true, dest_commission_wallet: true, otp: true, claim_handover_window_minutes: true, storage_policy: false, revenue_split_bps: false });

      const original = await ctx.prisma.systemSetting.findUniqueOrThrow({ where: { key: 'bus_capacity' } });
      try {
        const ok = await put(sa.token, '/v1/admin/settings/bus_capacity', { value: { maxSmallParcels: 15, maxMasterBags: 1 } });
        expect(ok.status).toBe(200);
        expect((await ctx.prisma.systemSetting.findUniqueOrThrow({ where: { key: 'bus_capacity' } })).value).toEqual({ maxSmallParcels: 15, maxMasterBags: 1 });
        expect((await ctx.prisma.auditLog.findFirst({ where: { action: 'SETTING_UPDATED', entityId: 'bus_capacity' }, orderBy: { id: 'desc' } }))!.before).toMatchObject({ value: { maxSmallParcels: 20, maxMasterBags: 2 } });
      } finally {
        await ctx.prisma.systemSetting.update({ where: { key: 'bus_capacity' }, data: { value: original.value as object } });
      }
      const refused = await put(sa.token, '/v1/admin/settings/storage_policy', { value: { freeDays: 99 } });
      expect([refused.status, refused.body.code]).toEqual([403, 'setting_not_editable']);
      expect((await put(sa.token, '/v1/admin/settings/bus_capacity', { value: { maxSmallParcels: 0, maxMasterBags: 2 } })).status).toBe(422);
      expect((await put(sa.token, '/v1/admin/settings/bus_capacity', { value: { maxSmallParcels: 10, maxMasterBags: 2, evil: true } })).status).toBe(422);
      expect((await put(sa.token, '/v1/admin/settings/dest_commission_wallet', { value: 'BITCOIN' })).status).toBe(422);
      expect((await put(sa.token, '/v1/admin/settings/otp', { value: { length: 4, ttlDays: 15, maxAttempts: 5, lockMinutes: 15 } })).status).toBe(422); // OTP stays 6 digits
      expect((await put((await finance(ctx)).token, '/v1/admin/settings/bus_capacity', { value: { maxSmallParcels: 10, maxMasterBags: 2 } })).status).toBe(403);
    });

    it('the destination-commission wallet setting is honoured by the next delivery', async () => {
      const sa = await superAdmin(ctx);
      const { arrivedParcels, deliverAtKiosk } = await import('./admin-helpers');
      const n = await createNetwork(ctx);
      const { SettingsService } = await import('../src/common/settings.service');
      try {
        await put(sa.token, '/v1/admin/settings/dest_commission_wallet', { value: 'DEPOSIT' });
        const { parcels } = await arrivedParcels(ctx, n, 1);
        const depositBefore = Number((await ctx.prisma.wallet.findFirstOrThrow({ where: { ownerType: 'AGENT', ownerId: n.bcu.agentId, walletType: 'DEPOSIT' } })).balance);
        expect((await deliverAtKiosk(ctx, n, parcels[0]!)).status).toBe(200);
        const depositAfter = Number((await ctx.prisma.wallet.findFirstOrThrow({ where: { ownerType: 'AGENT', ownerId: n.bcu.agentId, walletType: 'DEPOSIT' } })).balance);
        expect(depositAfter - depositBefore).toBeCloseTo(0.6, 4);
        const commission = await ctx.prisma.wallet.findFirst({ where: { ownerType: 'AGENT', ownerId: n.bcu.agentId, walletType: 'COMMISSION' } });
        expect(Number(commission?.balance ?? 0)).toBe(0);
      } finally {
        await put(sa.token, '/v1/admin/settings/dest_commission_wallet', { value: 'COMMISSION' });
        ctx.app.get(SettingsService).invalidate();
      }
    });
  });
});

void createUser;
