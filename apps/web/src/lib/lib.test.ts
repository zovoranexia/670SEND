import { describe, expect, it } from 'vitest';
import { MUNICIPALITIES } from '@670send/types';
import { buildBookingRequest, emptyBooking, isInsideTL, type BookingForm } from './booking';
import { buildQuoteRequest, DEFAULT_FORM, type CalcForm } from './calculator';
import { formatDiliDateTime, mapLink, normalizeWaybill, parseDecimal, WAYBILL_SHAPE } from './format';
import { coerceRoute, groupByCorridor, MUNICIPALITY_OPTIONS } from './municipalities';

describe('waybill normalisation', () => {
  it('accepts what people actually paste (lowercase, spaces, typographic dashes)', () => {
    for (const raw of ['670s-dil-bcu-261121-0042', ' 670S-DIL-BCU-261121-0042 ', '670S–DIL–BCU–261121–0042', '670S−DIL−BCU−261121−0042', '670S DIL BCU 261121 0042'.replace(/ /g, '-'), '670S-DIL-BCU-261121-0042\n']) {
      expect(normalizeWaybill(raw)).toBe('670S-DIL-BCU-261121-0042');
      expect(WAYBILL_SHAPE.test(normalizeWaybill(raw))).toBe(true);
    }
  });
  it('does not turn garbage into something valid', () => {
    for (const bad of ['', 'hello', '670S-DIL-BCU-261121', '670S-DIL-BCU-261121-42', '670S-DI-BCU-261121-0042', "670S-DIL-BCU-261121-0042'; DROP TABLE"]) expect(WAYBILL_SHAPE.test(normalizeWaybill(bad))).toBe(false);
  });
  it('matches the shape the API enforces (same regex as @670send/validation)', async () => {
    const { WAYBILL_REGEX } = await import('@670send/validation');
    expect(WAYBILL_SHAPE.source).toBe(WAYBILL_REGEX.source);
  });
});

describe('formatting', () => {
  it('prints Díli time (UTC+9) with a day/month/year order in every language', () => {
    // 2026-11-21 03:05 UTC = 12:05 in Díli
    for (const l of ['tet', 'pt', 'en', 'id'] as const) expect(formatDiliDateTime('2026-11-21T03:05:00Z', l)).toMatch(/21[/.]11[/.]2026,? 12[.:]05/);
  });
  it('survives garbage dates', () => expect(formatDiliDateTime('not a date', 'en')).toBe(''));
  it('parses decimals typed with a comma, rejects everything else', () => {
    expect(parseDecimal('2,5')).toBe(2.5);
    expect(parseDecimal(' 12.75 ')).toBe(12.75);
    for (const bad of ['', 'abc', '1,2,3', '-1', '1e3', '2 kg', '.5']) expect(parseDecimal(bad)).toBeNull();
  });
  it('builds a keyless OpenStreetMap link', () => expect(mapLink(-8.5569, 125.5603)).toBe('https://www.openstreetmap.org/?mlat=-8.5569&mlon=125.5603#map=17/-8.5569/125.5603'));
});

describe('municipalities', () => {
  it('lists all 14, grouped into the five corridors, with Oecusse and Ataúro on the sea corridor', () => {
    expect(MUNICIPALITY_OPTIONS).toHaveLength(14);
    expect(MUNICIPALITY_OPTIONS).toHaveLength(MUNICIPALITIES.length);
    const groups = groupByCorridor();
    expect(groups.map((g) => g.corridor)).toEqual(['LOCAL', 'EAST', 'SOUTH', 'WEST', 'SEA']);
    expect(groups.find((g) => g.corridor === 'SEA')!.items.map((m) => m.code).sort()).toEqual(['ATA', 'OEC']);
  });

  it('coerceRoute: NO combination the visitor can click leaves a route without Díli', () => {
    const codes = MUNICIPALITY_OPTIONS.map((m) => m.code);
    for (const origin of codes)
      for (const dest of codes)
        for (const changed of ['origin', 'dest'] as const) {
          const r = coerceRoute({ origin, dest }, changed);
          expect(r.origin === 'DIL' || r.dest === 'DIL').toBe(true);
          expect(r.origin).not.toBe(r.dest);
          // the end the visitor just touched is never overwritten
          expect(changed === 'origin' ? r.origin : r.dest).toBe(changed === 'origin' ? origin : dest);
        }
  });
  it('leaves a valid route untouched', () => expect(coerceRoute({ origin: 'DIL', dest: 'OEC' }, 'dest')).toEqual({ origin: 'DIL', dest: 'OEC' }));
});

describe('calculator form → quote request', () => {
  const form = (over: Partial<CalcForm> = {}): CalcForm => ({ ...DEFAULT_FORM, ...over });

  it('builds the exact request the API expects', () => {
    const r = buildQuoteRequest(form({ weight: '2,5', fragile: true, category: 'ELECTRONICS' }));
    expect(r).toEqual({
      ok: true,
      request: { originMunicipalityCode: 'DIL', destMunicipalityCode: 'BCU', scheme: 'SCHEME_A', parcel: { actualWeightKg: 2.5, lengthCm: 30, widthCm: 20, heightCm: 10 }, itemCategory: 'ELECTRONICS', isFragile: true, isHeavyBulk: false, insure: false },
    });
  });
  it('insurance needs a declared value, sent as a 2-decimal string', () => {
    const missing = buildQuoteRequest(form({ insure: true, declared: '' }));
    expect(missing.ok).toBe(false);
    expect(!missing.ok && missing.errors.declared).toEqual({ key: 'required' });
    const ok = buildQuoteRequest(form({ insure: true, declared: '100,5' }));
    expect(ok.ok && ok.request).toMatchObject({ insure: true, declaredValueUsd: '100.50' });
    expect(buildQuoteRequest(form({ insure: false, declared: '999' })).ok && 'declaredValueUsd' in (buildQuoteRequest(form({ insure: false, declared: '999' })) as { request: object }).request).toBe(false);
  });
  it('mirrors the API limits on weight and dimensions (positive, ≤ 500)', () => {
    const errs = (over: Partial<CalcForm>) => {
      const r = buildQuoteRequest(form(over));
      return r.ok ? {} : r.errors;
    };
    expect(errs({ weight: '0' }).weight).toEqual({ key: 'positive' });
    expect(errs({ weight: '501' }).weight).toEqual({ key: 'max', params: { max: 500 } });
    expect(errs({ weight: 'abc' }).weight).toEqual({ key: 'number' });
    expect(errs({ length: '' }).length).toEqual({ key: 'required' });
    expect(errs({ height: '-3' }).height).toEqual({ key: 'number' });
    expect(buildQuoteRequest(form({ weight: '500', length: '500', width: '500', height: '500' })).ok).toBe(true);
  });
  it('refuses routes the launch tariff does not cover', () => {
    const same = buildQuoteRequest(form({ origin: 'BCU', dest: 'BCU' }));
    expect(!same.ok && same.errors.route).toEqual({ key: 'sameRoute' });
    const noDili = buildQuoteRequest(form({ origin: 'BCU', dest: 'LAU' }));
    expect(!noDili.ok && noDili.errors.route).toEqual({ key: 'needDili' });
    expect(buildQuoteRequest(form({ origin: 'OEC', dest: 'DIL' })).ok).toBe(true);
  });
});

describe('booking form → request', () => {
  const good = (over: Partial<BookingForm> = {}): BookingForm => ({ ...emptyBooking('pt'), name: 'Maria da Costa', phone: '7712 3456', address: 'Rua Central 12, Colmera', ...over });

  it('normalises the phone and builds the request (optional fields omitted)', () => {
    expect(buildBookingRequest(good())).toEqual({
      ok: true,
      request: { senderName: 'Maria da Costa', senderPhone: '+67077123456', preferredLang: 'pt', scheme: 'SCHEME_B', parcelCount: 1, pickupAddress: 'Rua Central 12, Colmera' },
    });
  });
  it('includes the pin (rounded to ~10 cm), destination, weight and notes when given', () => {
    const r = buildBookingRequest(good({ pin: { lat: -8.556912345, lng: 125.560312345 }, dest: 'OEC', weight: '12,5', notes: ' ring twice ', count: '3', scheme: 'SCHEME_D' }));
    expect(r.ok && r.request).toMatchObject({ lat: -8.556912, lng: 125.560312, destMunicipalityCode: 'OEC', estimatedWeightKg: 12.5, notes: 'ring twice', parcelCount: 3, scheme: 'SCHEME_D' });
  });
  it('accepts every phone notation people use, rejects landlines and foreign numbers', () => {
    for (const p of ['77123456', '+670 7712 3456', '00670 7712-3456', '670 77123456']) {
      const r = buildBookingRequest(good({ phone: p }));
      expect(r.ok && r.request.senderPhone).toBe('+67077123456');
    }
    for (const p of ['', '3312345', '+62 812 3456 789', '1234']) expect(buildBookingRequest(good({ phone: p })).ok).toBe(false);
  });
  it('validates name, address, count and weight like the API does', () => {
    const e = (over: Partial<BookingForm>) => {
      const r = buildBookingRequest(good(over));
      return r.ok ? {} : r.errors;
    };
    expect(e({ name: 'Al' }).name).toEqual({ key: 'name' });
    expect(e({ address: 'abc' }).address).toEqual({ key: 'minChars', params: { min: 5 } });
    expect(e({ count: '0' }).count).toEqual({ key: 'positive' });
    expect(e({ count: '51' }).count).toEqual({ key: 'max', params: { max: 50 } });
    expect(e({ count: '2.5' }).count).toEqual({ key: 'number' });
    expect(e({ weight: '501' }).weight).toEqual({ key: 'max', params: { max: 500 } });
    expect(e({ notes: 'x'.repeat(301) }).notes).toEqual({ key: 'max', params: { max: 300 } });
  });
  it('keeps the pin inside Timor-Leste (Oecusse and Jaco island count, Jakarta and Darwin do not)', () => {
    expect(isInsideTL(-8.5569, 125.5603)).toBe(true); // Díli
    expect(isInsideTL(-9.2, 124.35)).toBe(true); // Oecusse enclave
    expect(isInsideTL(-8.45, 127.3)).toBe(true); // Jaco island
    expect(isInsideTL(-6.2, 106.8)).toBe(false); // Jakarta
    expect(isInsideTL(-12.46, 130.84)).toBe(false); // Darwin
    expect(isInsideTL(Number.NaN, 125)).toBe(false);
    const r = buildBookingRequest(good({ pin: { lat: -6.2, lng: 106.8 } }));
    expect(!r.ok && r.errors.pin).toEqual({ key: 'outsideTL' });
  });
});
