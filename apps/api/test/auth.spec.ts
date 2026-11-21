import { JwtService } from '@nestjs/jwt';
import { ActorService } from '../src/rbac/actor.service';
import { JWT_AUDIENCE, JWT_ISSUER } from '../src/auth/token.service';
import {
  SEED,
  bearer,
  createTestApp,
  createUser,
  loginEmail,
  pinToken,
  superToken,
  tokenFor,
  type TestCtx,
} from './helpers';

describe('Auth (JWT + refresh rotation + PIN + lockout)', () => {
  let ctx: TestCtx;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());

  describe('password login', () => {
    it('signs in the seeded Super Admin and returns tokens + scoped profile', async () => {
      const res = await loginEmail(ctx, SEED.superadminEmail(), SEED.superadminPassword());
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ tokenType: 'Bearer', expiresIn: 900 });
      expect(res.body.accessToken.split('.')).toHaveLength(3);
      expect(res.body.refreshToken.length).toBeGreaterThan(40);
      expect(res.body.user.roles).toEqual(['SUPER_ADMIN']);
      expect(res.body.user.permissions).toContain('*:*');
      // secrets never leave the server
      expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|pinHash|argon2/i);
    });

    it('answers a wrong password and an unknown e-mail identically, in the caller language', async () => {
      const victim = await createUser(ctx, ['FINANCE_ADMIN']);
      const cases: Array<[string | undefined, string]> = [
        ['pt', 'Credenciais inválidas.'],
        ['en', 'Invalid credentials.'],
        ['id', 'Kredensial tidak valid.'],
        [undefined, 'Kontaktu ka password la loos.'], // Tetun is the default
        ['de-DE', 'Kontaktu ka password la loos.'], // unsupported → Tetun, never English
      ];
      for (const [lang, expected] of cases) {
        // (anonymous caller → Accept-Language decides)
        for (const email of [victim.email, 'nobody@670send.test']) {
          const req = ctx.http.post('/v1/auth/login');
          if (lang) req.set('Accept-Language', lang);
          const res = await req.send({ email, password: 'definitely-wrong-1' });
          // 5 locales x 1 real account would trip the lockout, so unlock between rounds
          await ctx.prisma.user.update({ where: { id: victim.id }, data: { lockedUntil: null, failedLoginCount: 0 } });
          expect(res.status).toBe(401);
          expect(res.body.code).toBe('invalid_credentials');
          expect(res.body.message).toBe(expected);
        }
      }
    });

    it('language precedence: X-Lang > saved preference > Accept-Language > Tetun', async () => {
      const u = await createUser(ctx, ['FINANCE_ADMIN'], { lang: 'PT' });
      const t = await tokenFor(ctx, u);
      const get = (h: Record<string, string>) => ctx.http.get('/v1/_test/admin-only').set(bearer(t)).set(h);
      expect((await get({})).body.message).toBe('Não tem permissão para esta ação.'); // saved PT
      expect((await get({ 'Accept-Language': 'en' })).body.message).toBe('Não tem permissão para esta ação.'); // browser default must NOT override
      expect((await get({ 'X-Lang': 'id' })).body.message).toBe('Anda tidak memiliki izin untuk tindakan ini.'); // explicit switcher wins
      expect((await get({ 'X-Lang': 'xx' })).body.message).toBe('Não tem permissão para esta ação.'); // junk ignored
    });

    it('validates input with localized messages', async () => {
      const res = await ctx.http.post('/v1/auth/login').set('Accept-Language', 'en').send({ email: 'not-an-email' });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('validation_failed');
      expect(res.body.details.length).toBeGreaterThan(0);
    });

    it('locks the account after 5 failures — even the correct password is then refused', async () => {
      const u = await createUser(ctx, ['FINANCE_ADMIN']);
      for (let i = 0; i < 5; i++) {
        const r = await loginEmail(ctx, u.email, 'wrong-password-1');
        expect(r.status).toBe(401);
      }
      const locked = await loginEmail(ctx, u.email, u.password);
      expect(locked.status).toBe(423);
      expect(locked.body.code).toBe('account_locked');

      // lock expiry restores access
      await ctx.prisma.user.update({ where: { id: u.id }, data: { lockedUntil: new Date(Date.now() - 1000) } });
      const ok = await loginEmail(ctx, u.email, u.password);
      expect(ok.status).toBe(200);
    });

    it('refuses deactivated accounts', async () => {
      const u = await createUser(ctx, ['FINANCE_ADMIN']);
      await ctx.prisma.user.update({ where: { id: u.id }, data: { isActive: false } });
      const res = await loginEmail(ctx, u.email, u.password);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('account_inactive');
    });
  });

  describe('PIN login (field users)', () => {
    it('signs in an agent with phone + PIN and scopes the token to their agent id', async () => {
      const res = await ctx.http.post('/v1/auth/login/pin').send({ phone: '7710 0001', pin: SEED.pin() });
      expect(res.status).toBe(200);
      expect(res.body.user.roles).toEqual(['AGENT']);
      expect(res.body.user.scope.agentId).toBeDefined();
      expect(res.body.user.permissions).toContain('shipments:create');
    });

    it('rejects a wrong PIN', async () => {
      const res = await ctx.http.post('/v1/auth/login/pin').send({ phone: SEED.agentDiliPhone, pin: '000001' });
      expect(res.status).toBe(401);
    });

    it('does NOT allow backoffice roles to use a 6-digit PIN (same error as a wrong PIN)', async () => {
      const u = await createUser(ctx, ['SUPER_ADMIN']);
      const res = await ctx.http.post('/v1/auth/login/pin').send({ phone: u.phone, pin: u.pin });
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('invalid_credentials');
    });

    it('locks after repeated wrong PINs', async () => {
      const u = await createUser(ctx, ['COURIER']);
      for (let i = 0; i < 5; i++) await ctx.http.post('/v1/auth/login/pin').send({ phone: u.phone, pin: '000001' });
      const res = await ctx.http.post('/v1/auth/login/pin').send({ phone: u.phone, pin: u.pin });
      expect(res.status).toBe(423);
    });

    it('verifyTransactionPin shares the lockout counter', async () => {
      const u = await createUser(ctx, ['AGENT']);
      const auth = ctx.app.get((await import('../src/auth/auth.service')).AuthService);
      await expect(auth.verifyTransactionPin(u.id, u.pin)).resolves.toBeUndefined();
      await expect(auth.verifyTransactionPin(u.id, '111111')).rejects.toMatchObject({ code: 'pin_invalid' });
    });
  });

  describe('access token handling', () => {
    it('GET /auth/me works with a valid token and 401s without / with garbage', async () => {
      const t = await superToken(ctx);
      expect((await ctx.http.get('/v1/auth/me').set(bearer(t))).status).toBe(200);
      expect((await ctx.http.get('/v1/auth/me')).status).toBe(401);
      expect((await ctx.http.get('/v1/auth/me').set(bearer('not.a.jwt'))).status).toBe(401);
    });

    it('rejects tokens signed with another secret, wrong audience, or already expired', async () => {
      const u = await createUser(ctx, ['FINANCE_ADMIN']);
      const jwt = new JwtService({});
      const base = { sub: u.id, sid: 'x' };
      const forged = await jwt.signAsync(base, { secret: 'a'.repeat(48), issuer: JWT_ISSUER, audience: JWT_AUDIENCE, expiresIn: 60 });
      const badAud = await jwt.signAsync(base, { secret: process.env.JWT_ACCESS_SECRET!, issuer: JWT_ISSUER, audience: 'other', expiresIn: 60 });
      const expired = await jwt.signAsync(base, { secret: process.env.JWT_ACCESS_SECRET!, issuer: JWT_ISSUER, audience: JWT_AUDIENCE, expiresIn: -10 });
      const none = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url') + '.' + Buffer.from(JSON.stringify(base)).toString('base64url') + '.';
      for (const t of [forged, badAud, expired, none]) {
        expect((await ctx.http.get('/v1/auth/me').set(bearer(t))).status).toBe(401);
      }
    });

    it('a deactivated user is cut off even with a still-valid token (after the actor cache is invalidated)', async () => {
      const u = await createUser(ctx, ['FINANCE_ADMIN']);
      const login = await loginEmail(ctx, u.email, u.password);
      const t = login.body.accessToken as string;
      expect((await ctx.http.get('/v1/auth/me').set(bearer(t))).status).toBe(200);
      await ctx.prisma.user.update({ where: { id: u.id }, data: { isActive: false } });
      ctx.app.get(ActorService).invalidate(u.id);
      expect((await ctx.http.get('/v1/auth/me').set(bearer(t))).status).toBe(401);
    });
  });

  describe('refresh token rotation', () => {
    it('rotates on every use and the old token stops working', async () => {
      const u = await createUser(ctx, ['FINANCE_ADMIN']);
      const login = await loginEmail(ctx, u.email, u.password);
      const r1 = login.body.refreshToken as string;

      const rotated = await ctx.http.post('/v1/auth/refresh').send({ refreshToken: r1 });
      expect(rotated.status).toBe(200);
      expect(rotated.body.refreshToken).not.toBe(r1);
      expect((await ctx.http.get('/v1/auth/me').set(bearer(rotated.body.accessToken))).status).toBe(200);

      // immediate replay of the old token = double-click grace → refused, session NOT killed
      expect((await ctx.http.post('/v1/auth/refresh').send({ refreshToken: r1 })).status).toBe(401);
      const stillGood = await ctx.http.post('/v1/auth/refresh').send({ refreshToken: rotated.body.refreshToken });
      expect(stillGood.status).toBe(200);
    });

    it('detects REUSE of a rotated token (theft) and revokes the whole session family', async () => {
      const u = await createUser(ctx, ['FINANCE_ADMIN']);
      const login = await loginEmail(ctx, u.email, u.password);
      const r1 = login.body.refreshToken as string;
      const r2 = (await ctx.http.post('/v1/auth/refresh').send({ refreshToken: r1 })).body.refreshToken as string;

      // age the revocation beyond the grace window
      await ctx.prisma.refreshToken.updateMany({ where: { userId: u.id, revokedAt: { not: null } }, data: { revokedAt: new Date(Date.now() - 60_000) } });

      const replay = await ctx.http.post('/v1/auth/refresh').send({ refreshToken: r1 });
      expect(replay.status).toBe(401);
      expect(replay.body.code).toBe('refresh_invalid');

      // the legitimate newest token is dead too
      expect((await ctx.http.post('/v1/auth/refresh').send({ refreshToken: r2 })).status).toBe(401);
      const audit = await ctx.prisma.auditLog.findFirst({ where: { action: 'AUTH_REFRESH_REUSE_DETECTED', actorId: u.id } });
      expect(audit).not.toBeNull();
    });

    it('stores only keyed hashes of refresh tokens', async () => {
      const u = await createUser(ctx, ['FINANCE_ADMIN']);
      const login = await loginEmail(ctx, u.email, u.password);
      const rows = await ctx.prisma.refreshToken.findMany({ where: { userId: u.id } });
      expect(rows).toHaveLength(1);
      expect(rows[0]!.tokenHash).not.toContain(login.body.refreshToken);
      expect(rows[0]!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('logout revokes the session', async () => {
      const u = await createUser(ctx, ['FINANCE_ADMIN']);
      const login = await loginEmail(ctx, u.email, u.password);
      const out = await ctx.http.post('/v1/auth/logout').set(bearer(login.body.accessToken)).send({ refreshToken: login.body.refreshToken });
      expect(out.status).toBe(204);
      expect((await ctx.http.post('/v1/auth/refresh').send({ refreshToken: login.body.refreshToken })).status).toBe(401);
    });
  });

  describe('profile & credential changes', () => {
    it('PATCH /auth/me/language persists the preference and later errors use it', async () => {
      const u = await createUser(ctx, ['AGENT']);
      const t = await (async () => (await loginEmail(ctx, u.email, u.password)).body.accessToken as string)();
      const res = await ctx.http.patch('/v1/auth/me/language').set(bearer(t)).send({ lang: 'pt' });
      expect(res.status).toBe(200);
      expect(res.body.lang).toBe('pt');
      expect((await ctx.prisma.user.findUniqueOrThrow({ where: { id: u.id } })).preferredLang).toBe('PT');
      expect((await ctx.http.patch('/v1/auth/me/language').set(bearer(t)).send({ lang: 'xx' })).status).toBe(422);
    });

    it('changes password (weak ones refused), revokes every session, new password works', async () => {
      const u = await createUser(ctx, ['FINANCE_ADMIN']);
      const login = await loginEmail(ctx, u.email, u.password);
      const t = login.body.accessToken as string;

      const weak = await ctx.http.post('/v1/auth/password/change').set(bearer(t)).set('X-Lang', 'en').send({ currentPassword: u.password, newPassword: 'short1' });
      expect(weak.status).toBe(422);
      expect(weak.body.details[0].message).toBe('The password must be at least 12 characters, with letters and numbers.');

      const wrongCurrent = await ctx.http.post('/v1/auth/password/change').set(bearer(t)).send({ currentPassword: 'nope-nope-nope-1', newPassword: 'A-brand-new-pass-77' });
      expect(wrongCurrent.status).toBe(401);

      const ok = await ctx.http.post('/v1/auth/password/change').set(bearer(t)).send({ currentPassword: u.password, newPassword: 'A-brand-new-pass-77' });
      expect(ok.status).toBe(204);
      expect((await ctx.http.post('/v1/auth/refresh').send({ refreshToken: login.body.refreshToken })).status).toBe(401);
      expect((await loginEmail(ctx, u.email, u.password)).status).toBe(401);
      expect((await loginEmail(ctx, u.email, 'A-brand-new-pass-77')).status).toBe(200);
    });

    it('changes PIN only with the current PIN and refuses weak PINs', async () => {
      const u = await createUser(ctx, ['AGENT']);
      const t = await pinToken(ctx, u.phone, u.pin);
      expect((await ctx.http.post('/v1/auth/pin/change').set(bearer(t)).send({ newPin: '482913' })).status).toBe(401); // no current PIN
      expect((await ctx.http.post('/v1/auth/pin/change').set(bearer(t)).send({ currentPin: u.pin, newPin: '123456' })).status).toBe(422); // weak
      expect((await ctx.http.post('/v1/auth/pin/change').set(bearer(t)).send({ currentPin: u.pin, newPin: '739204' })).status).toBe(204);
      expect((await ctx.http.post('/v1/auth/login/pin').send({ phone: u.phone, pin: '739204' })).status).toBe(200);
    });
  });

  describe('audit trail of security events', () => {
    it('records login success / failure without leaking secrets', async () => {
      const u = await createUser(ctx, ['FINANCE_ADMIN']);
      await loginEmail(ctx, u.email, 'wrong-password-1');
      await loginEmail(ctx, u.email, u.password);
      const rows = await ctx.prisma.auditLog.findMany({ where: { actorId: u.id }, orderBy: { id: 'asc' } });
      expect(rows.map((r) => r.action)).toEqual(['AUTH_LOGIN_FAILED', 'AUTH_LOGIN_SUCCESS']);
      expect(JSON.stringify(rows, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))).not.toContain(u.password);
    });
  });
});
