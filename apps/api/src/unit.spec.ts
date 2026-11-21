import { Prisma } from '@prisma/client';
import { loadEnv, parseDurationSeconds } from './config/env';
import { redact } from './audit/audit.service';
import { stableStringify } from './idempotency/idempotency.interceptor';
import { sniffImage } from './storage/image-sniff';
import { canAccess } from './rbac/scope';
import type { Actor } from './rbac/actor';

const goodEnv = (over: Record<string, string> = {}): NodeJS.ProcessEnv => ({
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  JWT_ACCESS_SECRET: 'a'.repeat(48),
  JWT_REFRESH_SECRET: 'b'.repeat(48),
  OTP_PEPPER: 'c'.repeat(48),
  FIELD_ENCRYPTION_KEY: 'd'.repeat(44),
  S3_BUCKET: '670send-private',
  S3_ACCESS_KEY_ID: 'k',
  S3_SECRET_ACCESS_KEY: 's',
  ...over,
});

describe('env validation', () => {
  it('parses durations', () => {
    expect(parseDurationSeconds('15m')).toBe(900);
    expect(parseDurationSeconds('14d')).toBe(1_209_600);
    expect(() => parseDurationSeconds('soon')).toThrow();
  });

  it('applies safe defaults and derives values', () => {
    const e = loadEnv(goodEnv({ LOG_LEVEL: 'info', CORS_ORIGINS: 'https://a.tl, https://b.tl' }));
    expect(e.jwtAccessTtlSeconds).toBe(900);
    expect(e.LOG_LEVEL).toBe('log');
    expect(e.corsOrigins).toEqual(['https://a.tl', 'https://b.tl']);
    expect(e.DEFAULT_LOCALE).toBe('tet');
  });

  it('lists EVERY problem at once', () => {
    expect(() => loadEnv({})).toThrow(/DATABASE_URL[\s\S]*JWT_ACCESS_SECRET[\s\S]*S3_BUCKET/);
  });

  it('refuses to start in production with placeholder / shared / unsafe settings', () => {
    const prod = { NODE_ENV: 'production', CORS_ORIGINS: 'https://670send.tl', WHATSAPP_PROVIDER: 'waha', WAHA_BASE_URL: 'http://waha:3000' };
    expect(() => loadEnv(goodEnv({ ...prod, JWT_ACCESS_SECRET: 'CHANGE_ME_access_secret_min_48_chars_xxxxxx' }))).toThrow(/placeholder/);
    expect(() => loadEnv(goodEnv({ ...prod, JWT_REFRESH_SECRET: 'a'.repeat(48) }))).toThrow(/must differ/);
    expect(() => loadEnv(goodEnv({ ...prod, S3_AUTO_CREATE_BUCKET: 'true' }))).toThrow(/S3_AUTO_CREATE_BUCKET/);
    expect(() => loadEnv(goodEnv({ ...prod, CORS_ORIGINS: '' }))).toThrow(/CORS_ORIGINS/);
    expect(() => loadEnv(goodEnv(prod))).not.toThrow();
  });
});

describe('stableStringify', () => {
  it('is key-order independent and handles nesting / arrays / undefined', () => {
    expect(stableStringify({ b: 1, a: [{ d: 1, c: 2 }], z: undefined })).toBe('{"a":[{"c":2,"d":1}],"b":1}');
  });
});

describe('redact', () => {
  it('masks secrets at any depth, serialises Decimals and bounds depth', () => {
    const out = redact({
      password: 'x',
      otpCode: '123456',
      refreshToken: 't',
      amount: new Prisma.Decimal('3.4'),
      list: [{ pin: '1' }],
      ok: 'visible',
    }) as Record<string, unknown>;
    expect(out).toEqual({ password: '[REDACTED]', otpCode: '[REDACTED]', refreshToken: '[REDACTED]', amount: '3.4000', list: [{ pin: '[REDACTED]' }], ok: 'visible' });
  });
});

describe('sniffImage', () => {
  it('identifies by magic bytes only', () => {
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0x00]))?.mime).toBe('image/jpeg');
    expect(sniffImage(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))?.mime).toBe('image/png');
    expect(sniffImage(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))?.mime).toBe('image/webp');
    expect(sniffImage(Buffer.from('GIF89a'))).toBeNull();
    expect(sniffImage(Buffer.from('<svg onload=alert(1)>'))).toBeNull();
    expect(sniffImage(Buffer.alloc(0))).toBeNull();
  });
});

describe('canAccess (ownership scope)', () => {
  const base: Actor = { id: 'u', fullName: 'x', phone: '+670', email: null, lang: 'tet', roles: [], permissions: [], mustChangePassword: false };
  it('matches on any owner id and needs a non-empty scope', () => {
    expect(canAccess({ ...base, agentId: 'A1' }, { agentIds: ['A0', 'A1'] })).toBe(true);
    expect(canAccess({ ...base, agentId: 'A1' }, { agentIds: ['A2'] })).toBe(false);
    expect(canAccess(base, { agentIds: [undefined, null] })).toBe(false);
    expect(canAccess({ ...base, courierId: 'C1' }, { courierIds: ['C1'] })).toBe(true);
    expect(canAccess({ ...base, fleetPartnerId: 'F1' }, { fleetPartnerId: 'F1' })).toBe(true);
    expect(canAccess({ ...base, driverId: 'D1' }, { fleetPartnerId: 'F1' })).toBe(false);
  });
  it('lets the bypass permission lift the scope', () => {
    expect(canAccess({ ...base, permissions: ['shipments:read_all'] }, { agentIds: ['A9'] }, 'shipments:read_all')).toBe(true);
    expect(canAccess({ ...base, permissions: ['shipments:*'] }, { agentIds: ['A9'] }, 'shipments:read_all')).toBe(true);
    expect(canAccess({ ...base, permissions: ['claims:read'] }, { agentIds: ['A9'] }, 'shipments:read_all')).toBe(false);
  });
});
