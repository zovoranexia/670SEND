import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, request, setApiLocale } from '@/lib/api';
import { diliDayEndIso, diliDayStartIso, diliToday, formatDiliDateTime, normalizeWaybill, parseDecimal, toAmount, usd } from '@/lib/format';
import { clearAttempt, withKey } from '@/lib/idempotency';
import { sessionStore } from '@/lib/session';
import { navFor } from '@/nav';
import { passwordProblem } from '@/screens/ChangePassword';
import { parseWaybills } from '@/screens/hubs/common';
import { apiError, json, mockApi, noContent, signIn, user } from '@/test/helpers';

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

describe('money and date helpers', () => {
  it('formats USD for display only', () => {
    expect(usd('100.0000')).toBe('$100.00');
    expect(usd('1234.5')).toBe('$1,234.50');
    expect(usd(null)).toBe('—');
    expect(usd('')).toBe('—');
  });
  it('turns typed amounts into 4-decimal API strings and refuses anything else', () => {
    expect(toAmount('12,5')).toBe('12.5000');
    expect(toAmount(' 7 ')).toBe('7.0000');
    for (const bad of ['', '0', '-3', 'abc', '1e3', '12.5.1', '9999999999']) expect(toAmount(bad), bad).toBeNull();
    expect(parseDecimal('3,25')).toBe(3.25);
  });
  it('normalises pasted waybills and splits lists', () => {
    expect(normalizeWaybill(' 670s–dil–bcu–261121–000001 ')).toBe('670S-DIL-BCU-261121-000001');
    expect(parseWaybills('a1\nA1, b2;  c3')).toEqual(['A1', 'B2', 'C3']);
  });
  it('shows Díli time (UTC+9) and the Díli calendar day', () => {
    expect(formatDiliDateTime('2026-11-20T16:30:00Z', 'en')).toBe('21/11/2026, 01:30');
    expect(diliToday(0, new Date('2026-11-20T16:30:00Z'))).toBe('2026-11-21');
    expect(diliToday(-6, new Date('2026-11-20T16:30:00Z'))).toBe('2026-11-15');
  });
  it('turns a Díli day into the UTC bounds the API accepts', () => {
    expect(diliDayStartIso('2026-11-21')).toBe('2026-11-20T15:00:00.000Z');
    expect(diliDayEndIso('2026-11-21')).toBe('2026-11-21T14:59:59.999Z');
  });
});

describe('navigation follows permissions', () => {
  const keys = (perms: string[]) => navFor(perms).map((n) => n.key);
  it('a Super Admin sees every area', () => {
    expect(keys(['*:*'])).toEqual(['dashboard', 'shipments', 'hubs', 'partners', 'finance', 'claims', 'tariffs', 'templates', 'rbac', 'audit']);
  });
  it('a finance admin never sees RBAC, audit or templates', () => {
    const k = keys(['dashboard:view', 'deposits:read', 'payouts:read', 'tariffs:read', 'claims:read', 'shipments:read_all', 'agents:read']);
    expect(k).toContain('finance');
    expect(k).toContain('tariffs');
    for (const hidden of ['rbac', 'audit', 'templates', 'hubs']) expect(k).not.toContain(hidden);
  });
  it('a field account sees nothing', () => {
    expect(keys(['shipments:create', 'inbound:scan', 'wallets:read_own'])).toEqual([]);
  });
});

describe('password rule', () => {
  it('mirrors the server rule', () => {
    expect(passwordProblem('old-pass-123', 'short1')).toBe('short');
    expect(passwordProblem('old-pass-123', 'onlyletterslong')).toBe('weak');
    expect(passwordProblem('old-pass-123', '123456789012')).toBe('weak');
    expect(passwordProblem('same-pass-1234', 'same-pass-1234')).toBe('same');
    expect(passwordProblem('old-pass-123', 'brand-new-pass-1')).toBeNull();
  });
});

describe('idempotency keys', () => {
  it('keeps the key across a network failure and drops it after the server answered', async () => {
    const keys: string[] = [];
    const fail = (status: number) => Object.assign(new Error('x'), { status });
    await expect(withKey('s1', { a: 1 }, async (k) => (keys.push(k), Promise.reject(fail(0))))).rejects.toThrow();
    await expect(withKey('s1', { a: 1 }, async (k) => (keys.push(k), 'ok'))).resolves.toBe('ok'); // retry reuses the key
    expect(keys[1]).toBe(keys[0]);
    await withKey('s1', { a: 1 }, async (k) => keys.push(k)); // succeeded before: a new action gets a new key
    expect(keys[2]).not.toBe(keys[0]);
    clearAttempt('s1');
  });
  it('a real server error ends the attempt (the next click is a new attempt)', async () => {
    const keys: string[] = [];
    await expect(withKey('s2', {}, async (k) => (keys.push(k), Promise.reject(Object.assign(new Error('no'), { status: 403 }))))).rejects.toThrow();
    await withKey('s2', {}, async (k) => keys.push(k));
    expect(keys[1]).not.toBe(keys[0]);
  });
  it('a changed payload gets a new key', async () => {
    const keys: string[] = [];
    await expect(withKey('s3', { n: 1 }, async (k) => (keys.push(k), Promise.reject(Object.assign(new Error('x'), { status: 0 }))))).rejects.toThrow();
    await withKey('s3', { n: 2 }, async (k) => keys.push(k));
    expect(keys[1]).not.toBe(keys[0]);
  });
});

describe('api client', () => {
  it('sends the bearer token, the language and the audit reason', async () => {
    signIn(user(), { accessToken: 'tok-1', refreshToken: 'ref-1' });
    setApiLocale('pt');
    const m = mockApi({ 'POST /v1/admin/shipments/670S-X/override-status': () => json({ waybill: '670S-X', status: 'ON_HOLD_ISSUE' }) });
    vi.stubGlobal('fetch', m.fn);
    await request('/admin/shipments/670S-X/override-status', { body: { status: 'ON_HOLD_ISSUE' }, reason: 'customer called' });
    const h = m.last().init.headers;
    expect(h.Authorization).toBe('Bearer tok-1');
    expect(h['X-Lang']).toBe('pt');
    expect(h['X-Audit-Reason']).toBe('customer called');
    expect(h['Content-Type']).toBe('application/json');
    setApiLocale('tet');
  });

  it('refreshes once when parallel calls hit an expired token, then retries them', async () => {
    signIn(user(), { accessToken: 'old', refreshToken: 'ref-1' });
    let refreshes = 0;
    const m = mockApi({
      'POST /v1/auth/refresh': () => {
        refreshes++;
        return json({ accessToken: 'new', refreshToken: 'ref-2', expiresIn: 900 });
      },
      'GET /v1/a': ({ headers }) => ((headers as Record<string, string>).Authorization === 'Bearer new' ? json({ ok: 'a' }) : apiError(401, 'unauthorized', 'x')),
      'GET /v1/b': ({ headers }) => ((headers as Record<string, string>).Authorization === 'Bearer new' ? json({ ok: 'b' }) : apiError(401, 'unauthorized', 'x')),
    });
    vi.stubGlobal('fetch', m.fn);
    const [a, b] = await Promise.all([request<{ ok: string }>('/a'), request<{ ok: string }>('/b')]);
    expect([a.ok, b.ok]).toEqual(['a', 'b']);
    expect(refreshes).toBe(1);
    expect(sessionStore.get().refreshToken).toBe('ref-2');
  });

  it('ends the session when the refresh token is dead, but not when the network is down', async () => {
    signIn(user(), { accessToken: 'old', refreshToken: 'ref-1' });
    vi.stubGlobal('fetch', async (url: string) => (String(url).endsWith('/auth/refresh') ? apiError(401, 'refresh_invalid', 'x') : apiError(401, 'unauthorized', 'x')));
    await expect(request('/a')).rejects.toBeInstanceOf(ApiError);
    expect(sessionStore.get().user).toBeNull();
    expect(sessionStore.get().endedBecause).toBe('expired');

    signIn(user(), { accessToken: 'old', refreshToken: 'ref-1' });
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('network down');
    });
    const err = await request('/a').catch((e: unknown) => e);
    expect((err as ApiError).isNetwork).toBe(true);
    expect(sessionStore.get().user).not.toBeNull(); // offline is not a sign-out
  });

  it('surfaces the API error code and translated message', async () => {
    signIn();
    vi.stubGlobal('fetch', async () => apiError(403, 'self_approval_forbidden', 'You cannot approve your own request.'));
    const err = (await request('/x', { body: {} }).catch((e: unknown) => e)) as ApiError;
    expect(err.status).toBe(403);
    expect(err.code).toBe('self_approval_forbidden');
    expect(err.message).toBe('You cannot approve your own request.');
  });

  it('login does not send a token and stores nothing by itself', async () => {
    const m = mockApi({ 'POST /v1/auth/login': () => json({ accessToken: 'a', refreshToken: 'r', expiresIn: 900, user: user() }) });
    vi.stubGlobal('fetch', m.fn);
    await api.login('ana@670send.tl', 'secret');
    expect(m.last().init.headers.Authorization).toBeUndefined();
    expect(m.last().body).toEqual({ email: 'ana@670send.tl', password: 'secret' });
  });

  it('204 answers resolve to undefined', async () => {
    signIn();
    vi.stubGlobal('fetch', async () => noContent());
    await expect(api.changePassword('a', 'b')).resolves.toBeUndefined();
  });
});

describe('session storage', () => {
  it('survives a reload within the tab (refresh token + profile) but never keeps the access token', () => {
    signIn(user({ fullName: 'Ana' }), { accessToken: 'secret-access', refreshToken: 'ref-9' });
    const raw = sessionStorage.getItem('670send.admin.session') ?? '';
    expect(raw).toContain('ref-9');
    expect(raw).not.toContain('secret-access');
    expect(localStorage.getItem('670send.admin.session')).toBeNull(); // not in the long-lived store
  });
});
