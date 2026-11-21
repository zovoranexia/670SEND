import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError, publicApi } from './api';
import { json } from '@/test/render';

afterEach(() => vi.unstubAllGlobals());

const lastCall = (fetchMock: ReturnType<typeof vi.fn>) => {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit & { headers: Record<string, string> }];
  return { url, init };
};

describe('publicApi', () => {
  it('posts the quote as JSON with the visitor’s language and never caches', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ total: { usd: '4.0000', display: '$4.00' } }));
    vi.stubGlobal('fetch', fetchMock);
    await publicApi.quote({ originMunicipalityCode: 'DIL', destMunicipalityCode: 'BCU', scheme: 'SCHEME_A', parcel: { actualWeightKg: 2, lengthCm: 30, widthCm: 20, heightCm: 10 }, itemCategory: 'GENERAL', isFragile: false, isHeavyBulk: false, insure: false }, 'pt');
    const { url, init } = lastCall(fetchMock);
    expect(url).toMatch(/\/v1\/public\/quote$/);
    expect(init.method).toBe('POST');
    expect(init.headers['X-Lang']).toBe('pt');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.cache).toBe('no-store');
    expect(JSON.parse(init.body as string).destMunicipalityCode).toBe('BCU');
  });

  it('url-encodes the waybill and sends no body on GET', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ waybill: 'x' }));
    vi.stubGlobal('fetch', fetchMock);
    await publicApi.track('670S-DIL-BCU-261121-0001/../admin', 'en');
    const { url, init } = lastCall(fetchMock);
    expect(url).toContain('/v1/public/track/670S-DIL-BCU-261121-0001%2F..%2Fadmin');
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
    expect(init.headers['Content-Type']).toBeUndefined();
  });

  it('turns the API error body into an ApiRequestError carrying the already-translated message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ statusCode: 422, code: 'route_not_supported', message: 'Rota ne’e seidauk disponivel.', details: [{ path: 'x', message: 'm' }] }, 422)));
    const err = (await publicApi.quote({} as never, 'tet').catch((e: unknown) => e)) as ApiRequestError;
    expect(err).toBeInstanceOf(ApiRequestError);
    expect(err).toMatchObject({ status: 422, code: 'route_not_supported', message: 'Rota ne’e seidauk disponivel.', isNetwork: false, isNotFound: false });
    expect(err.details).toHaveLength(1);
  });

  it('flags 404 for the tracker', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ statusCode: 404, code: 'not_found', message: 'x' }, 404)));
    const err = (await publicApi.track('670S-DIL-BCU-261121-9999', 'en').catch((e: unknown) => e)) as ApiRequestError;
    expect(err.isNotFound).toBe(true);
  });

  it('survives a proxy error page that is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>Bad gateway</html>', { status: 502 })));
    const err = (await publicApi.track('670S-DIL-BCU-261121-0001', 'en').catch((e: unknown) => e)) as ApiRequestError;
    expect(err).toMatchObject({ status: 502, code: 'generic', message: '' });
  });

  it('reports a dead connection as a network error, but lets an abort pass through untouched', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const net = (await publicApi.track('670S-DIL-BCU-261121-0001', 'en').catch((e: unknown) => e)) as ApiRequestError;
    expect(net.isNetwork).toBe(true);

    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abort));
    const a = (await publicApi.track('670S-DIL-BCU-261121-0001', 'en').catch((e: unknown) => e)) as Error;
    expect(a).toBe(abort);
  });
});
