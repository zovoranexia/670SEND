import { describe, expect, it } from 'vitest';
import {
  baseShippingFee,
  fitsBusDimensions,
  formatDiliDateTime,
  formatMoneyDb,
  measureParcel,
  parseMoney,
  splitAddon,
  splitBaseFee,
  storageDay,
  storagePenaltyForDay,
  yymmddDili,
  defaultPayoutPeriod,
  diliStartOfDayUtc,
  diliStartOfMonthUtc,
  diliWeekday,
  type ZoneRates,
} from '../index';

const Z1: ZoneRates = { docRate: '2.50', smallBase2kg: '3.00', extraPerKg: '0.75', cargoBase10kg: '12.00', cargoExtraPerKg: '0.75' };
const Z2: ZoneRates = { docRate: '3.00', smallBase2kg: '4.00', extraPerKg: '1.00', cargoBase10kg: '14.00', cargoExtraPerKg: '0.85' };
const Z4: ZoneRates = { docRate: '5.00', smallBase2kg: '6.00', extraPerKg: '1.50', cargoBase10kg: '18.00', cargoExtraPerKg: '1.00' };
const db = formatMoneyDb;

describe('measureParcel', () => {
  it('picks the tariff tier', () => {
    expect(measureParcel({ actualKg: 0.3, lengthCm: 30, widthCm: 20, heightCm: 2, isDocumentCategory: true }).tier).toBe('DOCUMENT');
    expect(measureParcel({ actualKg: 0.3, lengthCm: 30, widthCm: 20, heightCm: 2 }).tier).toBe('SMALL'); // not a document
    expect(measureParcel({ actualKg: 2, lengthCm: 30, widthCm: 20, heightCm: 10 }).tier).toBe('SMALL');
    expect(measureParcel({ actualKg: 11, lengthCm: 30, widthCm: 20, heightCm: 10 }).tier).toBe('CARGO');
    expect(measureParcel({ actualKg: 2, lengthCm: 50, widthCm: 20, heightCm: 10 }).tier).toBe('CARGO'); // oversize
    expect(measureParcel({ actualKg: 2, lengthCm: 30, widthCm: 20, heightCm: 10, isFragile: true }).tier).toBe('CARGO');
  });
  it('charges volumetric weight for big, light boxes', () => {
    const m = measureParcel({ actualKg: 1, lengthCm: 40, widthCm: 30, heightCm: 30 });
    expect(m.volumetricKg).toBe(6);
    expect(m.chargeableKg).toBe(6);
  });
  it('a document that is bulky is not the document tier', () => {
    expect(measureParcel({ actualKg: 0.4, lengthCm: 40, widthCm: 30, heightCm: 30, isDocumentCategory: true }).tier).toBe('SMALL');
  });
});

describe('fitsBusDimensions', () => {
  it('ignores orientation', () => {
    expect(fitsBusDimensions(30, 40, 30)).toBe(true);
    expect(fitsBusDimensions(30, 30, 40)).toBe(true);
    expect(fitsBusDimensions(41, 10, 10)).toBe(false);
    expect(fitsBusDimensions(35, 35, 10)).toBe(false);
  });
});

describe('baseShippingFee (SOP §6.2)', () => {
  it('reproduces the published prices', () => {
    expect(db(baseShippingFee('SMALL', 2, Z1))).toBe('3.0000');
    expect(db(baseShippingFee('SMALL', 2, Z2))).toBe('4.0000'); // the SOP example: 2 kg Dili → Baucau
    expect(db(baseShippingFee('DOCUMENT', 1, Z2))).toBe('3.0000');
    expect(db(baseShippingFee('DOCUMENT', 1, Z4))).toBe('5.0000');
  });
  it('adds per-kg for kg 3-10 and beyond 10 for cargo', () => {
    expect(db(baseShippingFee('SMALL', 5, Z1))).toBe('5.2500'); // 3.00 + 3 × 0.75
    expect(db(baseShippingFee('SMALL', 10, Z2))).toBe('12.0000'); // 4.00 + 8 × 1.00
    expect(db(baseShippingFee('CARGO', 10, Z2))).toBe('14.0000');
    expect(db(baseShippingFee('CARGO', 30, Z2))).toBe('31.0000'); // 14 + 20 × 0.85
  });
  it('applies the Oecusse surcharge to small & cargo but never to documents', () => {
    expect(db(baseShippingFee('SMALL', 2, Z4, '0'))).toBe('6.0000'); // Ataúro
    expect(db(baseShippingFee('SMALL', 2, Z4, '2.00'))).toBe('8.0000'); // Oecusse
    expect(db(baseShippingFee('DOCUMENT', 1, Z4, '2.00'))).toBe('5.0000');
  });
});

describe('splitBaseFee (40/25/15/15/5)', () => {
  it('matches the SOP worked example for $4.00', () => {
    const s = splitBaseFee(parseMoney('4.00'));
    expect([db(s.fleet), db(s.platform), db(s.originAgent), db(s.destAgent), db(s.claimReserve)]).toEqual([
      '1.6000', '1.0000', '0.6000', '0.6000', '0.2000',
    ]);
  });
  it('always adds up to the fee to the last unit, remainder going to the platform', () => {
    for (const fee of ['3.00', '5.25', '12.00', '31.00', '2.50', '0.0001', '7.3333', '1234.5678']) {
      const f = parseMoney(fee);
      const s = splitBaseFee(f);
      expect(s.fleet + s.platform + s.originAgent + s.destAgent + s.claimReserve).toBe(f);
      expect(s.platform).toBeGreaterThanOrEqual((f * 2500n) / 10_000n);
    }
  });
  it('splits add-ons 80/20', () => {
    const a = splitAddon(parseMoney('1.50'));
    expect([db(a.partner), db(a.platform)]).toEqual(['1.2000', '0.3000']);
    const c = splitAddon(parseMoney('5.00'));
    expect([db(c.partner), db(c.platform)]).toEqual(['4.0000', '1.0000']);
  });
});

describe('Dili time', () => {
  it('uses UTC+9 for dates (waybill suffix, storage days)', () => {
    // 15:30 UTC on 21 Nov = 00:30 on 22 Nov in Dili
    expect(yymmddDili(new Date('2026-11-21T15:30:00Z'))).toBe('261122');
    expect(yymmddDili(new Date('2026-11-21T14:59:00Z'))).toBe('261121');
    expect(formatDiliDateTime(new Date('2026-11-21T01:05:00Z'))).toBe('21/11/2026 10:05');
  });
  it('counts storage days by Dili calendar day, arrival day = Day 1', () => {
    const arrived = new Date('2026-11-21T14:00:00Z'); // 23:00 Dili
    expect(storageDay(arrived, new Date('2026-11-21T14:30:00Z'))).toBe(1);
    expect(storageDay(arrived, new Date('2026-11-21T15:30:00Z'))).toBe(2); // just after Dili midnight
    expect(storageDay(arrived, new Date('2026-11-25T01:00:00Z'))).toBe(5);
    expect(storageDay(arrived, new Date('2026-11-26T01:00:00Z'))).toBe(6);
    expect(storageDay(arrived, new Date('2026-12-05T01:00:00Z'))).toBe(15);
  });
  it('charges $0.50 from Day 6 up to a cap at Day 14', () => {
    expect(db(storagePenaltyForDay(5))).toBe('0.0000');
    expect(db(storagePenaltyForDay(6))).toBe('0.5000');
    expect(db(storagePenaltyForDay(10))).toBe('2.5000');
    expect(db(storagePenaltyForDay(14))).toBe('4.5000');
    expect(db(storagePenaltyForDay(30))).toBe('4.5000');
  });
});

describe('Dili calendar helpers (payout periods, month-to-date)', () => {
  const iso = (d: Date) => d.toISOString();
  it('midnight in Dili is 15:00 UTC the day before', () => {
    expect(iso(diliStartOfDayUtc(new Date('2026-11-21T01:00:00Z')))).toBe('2026-11-20T15:00:00.000Z'); // 10:00 Dili on the 21st
    expect(iso(diliStartOfDayUtc(new Date('2026-11-21T16:00:00Z')))).toBe('2026-11-21T15:00:00.000Z'); // 01:00 Dili on the 22nd
    expect(iso(diliStartOfMonthUtc(new Date('2026-11-21T01:00:00Z')))).toBe('2026-10-31T15:00:00.000Z');
  });
  it('ISO weekday in Dili', () => {
    expect(diliWeekday(new Date('2026-11-23T01:00:00Z'))).toBe(1); // Monday 23 Nov 2026
    expect(diliWeekday(new Date('2026-11-22T16:00:00Z'))).toBe(1); // still Sunday in UTC, already Monday in Dili
    expect(diliWeekday(new Date('2026-11-22T10:00:00Z'))).toBe(7);
  });
  it('DAILY = yesterday, WEEKLY = the previous Monday-Sunday week', () => {
    const now = new Date('2026-11-23T00:30:00Z'); // Monday 09:30 Dili
    const d = defaultPayoutPeriod('DAILY', now);
    expect([iso(d.start), iso(d.end)]).toEqual(['2026-11-21T15:00:00.000Z', '2026-11-22T15:00:00.000Z']);
    const w = defaultPayoutPeriod('WEEKLY', now);
    expect([iso(w.start), iso(w.end)]).toEqual(['2026-11-15T15:00:00.000Z', '2026-11-22T15:00:00.000Z']); // Mon 16 → Sun 22 (Dili)
    // mid-week run still returns the last complete week
    const mid = defaultPayoutPeriod('WEEKLY', new Date('2026-11-26T04:00:00Z'));
    expect(iso(mid.start)).toBe('2026-11-15T15:00:00.000Z');
  });
});
