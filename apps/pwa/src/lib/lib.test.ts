import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiError, json, mockApi, signIn, user } from '@/test/helpers';
import { ApiError, api, refreshTokens, request } from './api';
import { attemptKey, clearAttempt, hasPendingAttempt } from './idempotency';
import { PHOTO_DEFAULTS, PhotoError, compressPhoto, fitWithin, type Codec, type Decoded } from './image';
import { buildIntakeBody, buildQuoteRequest, emptyChecklist, emptyDraft, firstInvalidStep, loadDraft, saveDraft, schemesFor, validateStep, type Draft } from './intake';
import { BLE_SAFE_CHUNK, BluetoothPrinter, PRINTER_SERVICES, PrinterError, base64ToBytes, chunk, rawBtUrl } from './printer';
import { parseScanned, parseScannedAs } from './scan';
import { sessionStore } from './session';

afterEach(() => vi.unstubAllGlobals());

/* ============================================================================================ images */
describe('photo compression', () => {
  it('fits within the longest edge and never enlarges', () => {
    expect(fitWithin(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3000, 4000, 1600)).toEqual({ width: 1200, height: 1600 });
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(1, 5000, 1600)).toEqual({ width: 1, height: 1600 });
  });

  /** Fake codec whose output size shrinks with pixels and quality, like a real JPEG. */
  const fakeCodec = (bytesPerPixelAtQ1: number, log: Array<[number, number, number]> = []): Codec => ({
    decode: async () => ({ width: 4000, height: 3000, close: vi.fn() }) as Decoded,
    encode: async (_i, w, h, q) => {
      log.push([w, h, q]);
      return new Blob([new Uint8Array(Math.round(w * h * q * bytesPerPixelAtQ1))], { type: 'image/jpeg' });
    },
  });

  it('stops at the first size that fits: highest quality, largest edge first', async () => {
    const log: Array<[number, number, number]> = [];
    const r = await compressPhoto(new Blob([new Uint8Array(5_000_000)], { type: 'image/jpeg' }), {}, fakeCodec(0.2, log));
    // 1600×1200×0.8×0.2 = 307 KB ≤ 900 KB → first attempt wins
    expect(log).toEqual([[1600, 1200, 0.8]]);
    expect(r).toMatchObject({ width: 1600, height: 1200, quality: 0.8, originalBytes: 5_000_000 });
    expect(r.blob.size).toBeLessThanOrEqual(PHOTO_DEFAULTS.maxBytes);
  });

  it('lowers quality, then shrinks the picture, until it fits the target', async () => {
    const log: Array<[number, number, number]> = [];
    const r = await compressPhoto(new Blob([new Uint8Array(6_000_000)], { type: 'image/jpeg' }), {}, fakeCodec(1.2, log));
    expect(r.blob.size).toBeLessThanOrEqual(PHOTO_DEFAULTS.maxBytes);
    expect(log.length).toBeGreaterThan(1);
    expect(log[0]![0]).toBe(1600);
    expect(log.some(([w]) => w < 1600)).toBe(true); // had to shrink the pixels too
    const qualities = log.filter(([w]) => w === 1600).map(([, , q]) => q);
    expect(qualities).toEqual([...qualities].sort((a, b) => b - a)); // quality only goes down
  });

  it('accepts the smallest result below the hard limit when the target cannot be reached, and refuses beyond it', async () => {
    const stubborn = (size: number): Codec => ({ decode: async () => ({ width: 4000, height: 3000 }), encode: async () => new Blob([new Uint8Array(size)]) });
    const ok = await compressPhoto(new Blob([new Uint8Array(10)], { type: 'image/jpeg' }), {}, stubborn(1_500_000));
    expect(ok.blob.size).toBe(1_500_000); // over the 900 KB target but under the 2 MB server cap
    await expect(compressPhoto(new Blob([new Uint8Array(10)], { type: 'image/jpeg' }), {}, stubborn(2_500_000))).rejects.toMatchObject({ name: 'PhotoError', reason: 'too_large' });
  });

  it('rejects files that are not images or cannot be decoded, and always releases the decoded bitmap', async () => {
    await expect(compressPhoto(new Blob(['x'], { type: 'application/pdf' }), {}, fakeCodec(1))).rejects.toBeInstanceOf(PhotoError);
    const broken: Codec = { decode: async () => Promise.reject(new Error('bad')), encode: async () => new Blob() };
    await expect(compressPhoto(new Blob(['x'], { type: 'image/jpeg' }), {}, broken)).rejects.toMatchObject({ reason: 'decode_failed' });
    const close = vi.fn();
    const codec: Codec = { decode: async () => ({ width: 100, height: 100, close }), encode: async () => new Blob([new Uint8Array(10)]) };
    await compressPhoto(new Blob(['x'], { type: 'image/jpeg' }), {}, codec);
    expect(close).toHaveBeenCalledOnce();
  });
});

/* ========================================================================================== printer */
describe('Bluetooth printer', () => {
  it('decodes base64 and splits into chunks without losing a byte', () => {
    const bytes = base64ToBytes(btoa(String.fromCharCode(0x1b, 0x40, 72, 105, 10)));
    expect([...bytes]).toEqual([0x1b, 0x40, 72, 105, 10]);
    const big = new Uint8Array(250).map((_, i) => i % 256);
    const parts = chunk(big, 100);
    expect(parts.map((p) => p.length)).toEqual([100, 100, 50]);
    expect([...parts.flatMap((p) => [...p])]).toEqual([...big]);
    expect(() => chunk(big, 0)).toThrow(RangeError);
  });
  it('builds the RawBT fallback link', () => expect(rawBtUrl('AAA=')).toBe('rawbt:base64,AAA='));

  function fakeNav(opts: { props?: Partial<BluetoothCharacteristicProperties>; failWritesAbove?: number } = {}) {
    const written: number[][] = [];
    const characteristic = {
      properties: { write: true, writeWithoutResponse: true, ...opts.props },
      writeValueWithoutResponse: vi.fn(async (d: Uint8Array) => {
        if (opts.failWritesAbove && d.length > opts.failWritesAbove) throw new Error('GATT: value too long');
        written.push([...d]);
      }),
      writeValueWithResponse: vi.fn(async (d: Uint8Array) => void written.push([...d])),
    };
    const server = { connected: true, getPrimaryServices: async () => [{ getCharacteristics: async () => [{ properties: { read: true } }, characteristic] }] };
    const device = { name: 'MPT-II', gatt: { connected: false, connect: async () => ((device.gatt.connected = true), server), disconnect: vi.fn(() => (device.gatt.connected = false)) }, addEventListener: vi.fn() };
    const requestDevice = vi.fn(async () => device);
    return { nav: { bluetooth: { requestDevice } } as unknown as Navigator, written, characteristic, device, requestDevice };
  }

  it('asks for all the known printer services, finds the writable characteristic, and streams the job', async () => {
    const f = fakeNav();
    const p = new BluetoothPrinter(f.nav);
    expect(await p.choose()).toBe('MPT-II');
    expect(f.requestDevice).toHaveBeenCalledWith({ acceptAllDevices: true, optionalServices: PRINTER_SERVICES });
    const job = new Uint8Array(230).map((_, i) => i % 251);
    await p.print(job);
    expect(f.written.map((w) => w.length)).toEqual([100, 100, 30]);
    expect(f.written.flat()).toEqual([...job]);
    expect(p.connected).toBe(true);
  });

  it('retries the whole job with 20-byte writes when the printer rejects bigger ones (no duplicated or missing bytes)', async () => {
    const f = fakeNav({ failWritesAbove: 20 });
    const p = new BluetoothPrinter(f.nav);
    await p.choose();
    const job = new Uint8Array(65).map((_, i) => i);
    await p.print(job);
    expect(f.written.every((w) => w.length <= BLE_SAFE_CHUNK)).toBe(true);
    expect(f.written.flat()).toEqual([...job]);
  });

  it('uses write-with-response when that is all the characteristic supports', async () => {
    const f = fakeNav({ props: { writeWithoutResponse: false } });
    const p = new BluetoothPrinter(f.nav);
    await p.choose();
    await p.print(new Uint8Array(10));
    expect(f.characteristic.writeValueWithResponse).toHaveBeenCalled();
    expect(f.characteristic.writeValueWithoutResponse).not.toHaveBeenCalled();
  });

  it('reports a cancelled chooser, an unsupported browser and a printer without a writable characteristic', async () => {
    const cancelled = { bluetooth: { requestDevice: async () => Promise.reject(Object.assign(new Error('x'), { name: 'NotFoundError' })) } } as unknown as Navigator;
    await expect(new BluetoothPrinter(cancelled).choose()).rejects.toMatchObject({ reason: 'cancelled' });
    await expect(new BluetoothPrinter({} as Navigator).choose()).rejects.toMatchObject({ reason: 'unsupported' });
    const f = fakeNav();
    (f.device.gatt as { connect: () => unknown }).connect = async () => ({ getPrimaryServices: async () => [{ getCharacteristics: async () => [{ properties: { read: true } }] }] });
    await expect(new BluetoothPrinter(f.nav).choose()).rejects.toBeInstanceOf(PrinterError);
  });

  it('reconnects by itself after the printer went to sleep', async () => {
    const f = fakeNav();
    const p = new BluetoothPrinter(f.nav);
    await p.choose();
    f.device.gatt.connected = false; // printer slept and dropped the link
    (p as unknown as { characteristic: unknown }).characteristic = null;
    await p.print(new Uint8Array(5));
    expect(f.written.flat()).toEqual([0, 0, 0, 0, 0]);
  });
});

/* ============================================================================================== scan */
describe('scanned codes', () => {
  it.each([
    ['670S-DIL-BCU-261121-0042', 'WAYBILL', '670S-DIL-BCU-261121-0042'],
    ['  670s-dil-bcu-261121-0042 ', 'WAYBILL', '670S-DIL-BCU-261121-0042'],
    ['https://670send.tl/pt/track?no=670S-DIL-BCU-261121-0042', 'WAYBILL', '670S-DIL-BCU-261121-0042'],
    ['670S–DIL–BCU–261121–0042', 'WAYBILL', '670S-DIL-BCU-261121-0042'],
    ['MB-261121-7K3M9Q', 'BAG', 'MB-261121-7K3M9Q'],
    ['mf-261121-4fq8td', 'MANIFEST', 'MF-261121-4FQ8TD'],
    ['PB-261121-9XQ2HC', 'BOOKING', 'PB-261121-9XQ2HC'],
  ])('%s → %s', (raw, kind, code) => expect(parseScanned(raw)).toEqual({ kind, code }));

  it('rejects anything else, including look-alike codes with forbidden letters', () => {
    for (const bad of ['', 'hello', 'https://example.com', 'MB-261121-7K3M9I', 'MB-261121-7K3M9', '670S-DIL-BCU-26112-0042']) expect(parseScanned(bad)).toBeNull();
  });
  it('can be limited to what a screen accepts', () => {
    expect(parseScannedAs('MF-261121-4FQ8TD', ['MANIFEST'])).toEqual({ kind: 'MANIFEST', code: 'MF-261121-4FQ8TD' });
    expect(parseScannedAs('MB-261121-7K3M9Q', ['MANIFEST'])).toBeNull();
  });
});

/* ===================================================================================== idempotency */
describe('idempotency keys', () => {
  it('the same payload keeps the same key until cleared (a retry after a timeout is safe)', async () => {
    const a = await attemptKey('intake', { x: 1 });
    expect(await attemptKey('intake', { x: 1 })).toBe(a);
    expect(hasPendingAttempt('intake')).toBe(true);
    clearAttempt('intake');
    expect(hasPendingAttempt('intake')).toBe(false);
    expect(await attemptKey('intake', { x: 1 })).not.toBe(a);
  });
  it('a changed payload gets a new key (the server would reject a reused key with different content)', async () => {
    const a = await attemptKey('intake', { x: 1 });
    const b = await attemptKey('intake', { x: 2 });
    expect(b).not.toBe(a);
    expect(await attemptKey('intake', { x: 2 })).toBe(b);
  });
  it('scopes are independent', async () => {
    expect(await attemptKey('a', { x: 1 })).not.toBe(await attemptKey('b', { x: 1 }));
  });
});

/* ======================================================================================== API client */
describe('API client', () => {
  it('sends the language, the bearer token and the idempotency key; parses JSON', async () => {
    signIn();
    const m = mockApi({ 'POST /v1/shipments': () => json({ ok: true }) });
    vi.stubGlobal('fetch', m.fn);
    await request('/shipments', { body: { a: 1 }, key: 'key-1' });
    const h = m.last().init.headers;
    expect(h).toMatchObject({ Authorization: 'Bearer access-1', 'Idempotency-Key': 'key-1', 'Content-Type': 'application/json', 'X-Lang': 'tet' });
  });

  it('turns the API error into an ApiError with the already translated message', async () => {
    signIn();
    vi.stubGlobal('fetch', mockApi({ 'GET /v1/shipments/x': () => apiError(404, 'not_found', 'Informasaun la hetan.') }).fn);
    const err = await api.shipment('x').catch((e: unknown) => e as ApiError);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 404, code: 'not_found', message: 'Informasaun la hetan.', isNetwork: false });
  });

  it('a dead connection is a network error (status 0), never a crash', async () => {
    signIn();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const err = (await api.wallets().catch((e: unknown) => e)) as ApiError;
    expect(err.isNetwork).toBe(true);
  });

  it('refreshes an expired access token once and replays the request with the new one', async () => {
    signIn();
    let n = 0;
    const m = mockApi({
      'GET /v1/wallets/me': (init) => ((init.headers as Record<string, string>).Authorization === 'Bearer access-2' ? json([{ id: 'w' }]) : apiError(401, 'unauthorized', 'x')),
      'POST /v1/auth/refresh': () => (n++, json({ accessToken: 'access-2', refreshToken: 'refresh-2', expiresIn: 900 })),
    });
    vi.stubGlobal('fetch', m.fn);
    expect(await api.wallets()).toEqual([{ id: 'w' }]);
    expect(n).toBe(1);
    expect(sessionStore.get().refreshToken).toBe('refresh-2'); // rotated token is kept
  });

  it('parallel requests share ONE refresh (a second use of the rotated token would look like theft)', async () => {
    signIn();
    let refreshes = 0;
    const m = mockApi({
      'GET /v1/wallets/me': (init) => ((init.headers as Record<string, string>).Authorization === 'Bearer access-2' ? json([]) : apiError(401, 'unauthorized', 'x')),
      'GET /v1/courier/jobs': (init) => ((init.headers as Record<string, string>).Authorization === 'Bearer access-2' ? json({}) : apiError(401, 'unauthorized', 'x')),
      'POST /v1/auth/refresh': async () => {
        refreshes++;
        await new Promise((r) => setTimeout(r, 30));
        return json({ accessToken: 'access-2', refreshToken: 'refresh-2', expiresIn: 900 });
      },
    });
    vi.stubGlobal('fetch', m.fn);
    await Promise.all([api.wallets(), api.courierJobs()]);
    expect(refreshes).toBe(1);
  });

  it('gets an access token first after an app restart (only the refresh token survived)', async () => {
    signIn();
    sessionStore.setTokens({ accessToken: null as never, refreshToken: 'refresh-1' });
    const m = mockApi({
      'POST /v1/auth/refresh': () => json({ accessToken: 'fresh', refreshToken: 'refresh-2', expiresIn: 900 }),
      'GET /v1/wallets/me': (init) => ((init.headers as Record<string, string>).Authorization === 'Bearer fresh' ? json([]) : apiError(401, 'unauthorized', 'x')),
    });
    vi.stubGlobal('fetch', m.fn);
    await api.wallets();
    expect(m.calls.map((c) => c.path)).toEqual(['/v1/auth/refresh', '/v1/wallets/me']); // no wasted 401 round trip
  });

  it('a REVOKED session signs the user out; being OFFLINE during refresh does not', async () => {
    signIn();
    vi.stubGlobal('fetch', mockApi({ 'GET /v1/wallets/me': () => apiError(401, 'unauthorized', 'x'), 'POST /v1/auth/refresh': () => apiError(401, 'refresh_invalid', 'x') }).fn);
    await api.wallets().catch(() => undefined);
    expect(sessionStore.get().user).toBeNull();
    expect(sessionStore.get().endedBecause).toBe('expired');

    signIn(user());
    const offline = vi.fn(async (url: string) => {
      if (String(url).includes('/auth/refresh')) throw new TypeError('offline');
      return apiError(401, 'unauthorized', 'x');
    });
    vi.stubGlobal('fetch', offline);
    await api.wallets().catch(() => undefined);
    expect(sessionStore.get().user).not.toBeNull(); // still signed in; will refresh when back online
    expect(await refreshTokens()).toBe(false);
  });

  it('the login call itself never tries to refresh', async () => {
    const m = mockApi({ 'POST /v1/auth/login/pin': () => apiError(401, 'invalid_credentials', 'PIN la loos.') });
    vi.stubGlobal('fetch', m.fn);
    const err = (await api.loginPin('+67077123456', '482913').catch((e: unknown) => e)) as ApiError;
    expect(err.code).toBe('invalid_credentials');
    expect(m.calls).toHaveLength(1);
  });

  it('uploads a photo as multipart with its type', async () => {
    signIn();
    const m = mockApi({ 'POST /v1/uploads/photos': () => json({ id: 'up-1' }) });
    vi.stubGlobal('fetch', m.fn);
    await api.uploadPhoto(new Blob(['x'], { type: 'image/jpeg' }), 'SEALED_PARCEL');
    const body = m.last().body as FormData;
    expect(body.get('photoType')).toBe('SEALED_PARCEL');
    expect((body.get('file') as File).name).toBe('photo.jpg');
    expect(m.last().init.headers['Content-Type']).toBeUndefined(); // the browser sets the multipart boundary
  });
});

/* ========================================================================================== intake */
describe('drop-off wizard logic', () => {
  const full = (over: Partial<Draft> = {}): Draft => {
    const d = emptyDraft({ scheme: 'SCHEME_A', lang: 'pt' });
    return {
      ...d,
      destCode: 'BCU',
      sender: { ...d.sender, name: 'Maria da Costa', idNumber: 'BI123456', phone: '7712 3456' },
      recipient: { ...d.recipient, name: 'José Guterres', phone: '+670 7798 7654' },
      checklist: Object.fromEntries(Object.keys(emptyChecklist()).map((k) => [k, true])) as Draft['checklist'],
      photos: { open: 'up-1', sealed: 'up-2' },
      item: { ...d.item, description: 'Roupa' },
      parcel: { weight: '2,5', length: '30', width: '20', height: '10' },
      ...over,
    };
  };
  const ctx = { kioskCount: 1 };

  it('kiosks take drop-off schemes, couriers take pick-up schemes', () => {
    expect(schemesFor('AGENT')).toEqual(['SCHEME_A', 'SCHEME_C']);
    expect(schemesFor('COURIER')).toEqual(['SCHEME_B', 'SCHEME_D']);
  });

  it('a complete draft passes every step', () => {
    for (const s of [1, 2, 3] as const) expect(validateStep(s, full(), ctx)).toEqual({});
    expect(firstInvalidStep(full(), ctx)).toBeNull();
  });

  it('step 1: KYC fields, phone format, kiosk choice and the door-delivery address', () => {
    const d = emptyDraft({ scheme: 'SCHEME_C', lang: 'tet' });
    const e = validateStep(1, d, { kioskCount: 3 });
    expect(Object.keys(e).sort()).toEqual(['destAgentId'.slice(0, 0) + 'destCode', 'recipient.address', 'recipient.name', 'recipient.phone', 'sender.idNumber', 'sender.name', 'sender.phone'].sort());
    expect(validateStep(1, full({ destAgentId: '' }), { kioskCount: 3 })['destAgentId']).toEqual({ key: 'required' }); // several kiosks → must choose
    expect(validateStep(1, full(), { kioskCount: 0 })['destAgentId']).toEqual({ key: 'kiosk' }); // none → cannot send there yet
    expect(validateStep(1, full({ scheme: 'SCHEME_C' }), ctx)['recipient.address']).toEqual({ key: 'minChars', params: { min: 5 } });
    expect(validateStep(1, full({ recipient: { ...full().recipient, phone: '3312345' } }), ctx)['recipient.phone']).toEqual({ key: 'phone' }); // landline: no WhatsApp
  });

  it('step 2: every prohibited line must be ticked and BOTH photos taken', () => {
    const d = full();
    expect(validateStep(2, full({ checklist: { ...d.checklist, narcotics: false } }), ctx)['checklist']).toBeDefined();
    expect(validateStep(2, full({ photos: { open: 'up-1' } }), ctx)['photos']).toBeDefined();
    expect(validateStep(2, full({ photos: {} }), ctx)['photos']).toBeDefined();
  });

  it('step 3: weight and dimensions positive and ≤ 500 (API limits); insurance needs a declared value', () => {
    expect(validateStep(3, full({ parcel: { weight: '0', length: '30', width: '20', height: '10' } }), ctx)['parcel.weight']).toEqual({ key: 'positive' });
    expect(validateStep(3, full({ parcel: { weight: '2', length: '501', width: '20', height: '10' } }), ctx)['parcel.length']).toEqual({ key: 'max', params: { max: 500 } });
    expect(validateStep(3, full({ parcel: { weight: 'abc', length: '30', width: '20', height: '10' } }), ctx)['parcel.weight']).toEqual({ key: 'number' });
    expect(validateStep(3, full({ insure: true }), ctx)['item.declared']).toEqual({ key: 'required' });
    expect(validateStep(3, full({ insure: true, item: { ...full().item, declared: '120' } }), ctx)).toEqual({});
  });

  it('builds the quote request (comma decimals, declared value to 2 decimals) and refuses an incomplete draft', () => {
    expect(buildQuoteRequest(full(), 'DIL')).toEqual({
      originMunicipalityCode: 'DIL', destMunicipalityCode: 'BCU', scheme: 'SCHEME_A',
      parcel: { actualWeightKg: 2.5, lengthCm: 30, widthCm: 20, heightCm: 10 }, itemCategory: 'GENERAL', isFragile: false, isHeavyBulk: false, insure: false,
    });
    expect(buildQuoteRequest(full({ insure: true, item: { ...full().item, declared: '99,5' } }), 'DIL')).toMatchObject({ insure: true, declaredValueUsd: '99.50' });
    expect(buildQuoteRequest(emptyDraft({ scheme: 'SCHEME_A', lang: 'tet' }), 'DIL')).toBeNull();
  });

  it('builds the exact POST /shipments body: all 7 prohibited lines true, both photos, the PIN, the checklist language', () => {
    const body = buildIntakeBody(full({ destAgentId: 'k-1', pickupBookingId: '' }), '482913', 'pt');
    expect(body).toMatchObject({
      scheme: 'SCHEME_A', destMunicipalityCode: 'BCU', destAgentId: 'k-1', insure: false, pin: '482913', checklistLang: 'pt', photoUploadIds: ['up-1', 'up-2'],
      sender: { name: 'Maria da Costa', idType: 'BI', idNumber: 'BI123456', phone: '7712 3456', lang: 'pt' },
      item: { description: 'Roupa', category: 'GENERAL', isFragile: false, isHeavyBulk: false },
      parcel: { actualWeightKg: 2.5, lengthCm: 30, widthCm: 20, heightCm: 10 },
    });
    expect(Object.keys(body.prohibitedChecklist)).toHaveLength(7);
    expect(Object.values(body.prohibitedChecklist).every((v) => v === true)).toBe(true);
    expect('pickupBookingId' in body).toBe(false);
    expect(buildIntakeBody(full({ pickupBookingId: 'b-1' }), '482913', 'tet').pickupBookingId).toBe('b-1');
    expect(() => buildIntakeBody(emptyDraft({ scheme: 'SCHEME_A', lang: 'tet' }), '482913', 'tet')).toThrow();
  });

  it('keeps an unfinished parcel across a reload — per user, without ever storing the PIN', () => {
    saveDraft('u-1', full({ step: 3 }));
    expect(loadDraft('u-1')?.step).toBe(3);
    expect(loadDraft('u-2')).toBeNull();
    expect(JSON.stringify(sessionStorage)).not.toMatch(/482913|pin/i);
    sessionStorage.setItem('670send.draft.u-3', '{"v":999,"draft":{}}');
    expect(loadDraft('u-3')).toBeNull(); // incompatible old draft is ignored, not crashed on
  });
});
