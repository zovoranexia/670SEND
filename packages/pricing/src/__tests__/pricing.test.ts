import { describe, expect, it } from 'vitest';
import {
  CanalRoutingError,
  assertCanalAllowed,
  chargeableWeightKg,
  formatMoneyDb,
  formatMoneyDisplay,
  insurancePremium,
  maxEligibleLiability,
  parseMoney,
  selectTransportCanal,
  uninsuredLiability,
  volumetricWeightKg,
} from '../index';

const small = { chargeableKg: 2, lengthCm: 30, widthCm: 20, heightCm: 10 };

describe('weight', () => {
  it('volumetric = LxWxH/6000', () => expect(volumetricWeightKg(40, 30, 30)).toBe(6));
  it('chargeable uses the larger value, rounded up, min 1', () => {
    expect(chargeableWeightKg(0.3, 0.1)).toBe(1);
    expect(chargeableWeightKg(2.01, 1)).toBe(3);
    expect(chargeableWeightKg(2, 6)).toBe(6);
    expect(chargeableWeightKg(10, 0)).toBe(10);
  });
});

describe('canal routing', () => {
  it('small mainland parcel -> bus', () =>
    expect(selectTransportCanal({ originCode: 'DIL', destCode: 'BCU', ...small })).toBe('BUS_BAGGAGE'));
  it('>10 kg -> cargo', () =>
    expect(
      selectTransportCanal({ originCode: 'DIL', destCode: 'BCU', ...small, chargeableKg: 11 }),
    ).toBe('CARGO_TRUCK_PICKUP'));
  it('oversize -> cargo', () =>
    expect(
      selectTransportCanal({ originCode: 'DIL', destCode: 'BCU', ...small, lengthCm: 41 }),
    ).toBe('CARGO_TRUCK_PICKUP'));
  it('fragile -> cargo', () =>
    expect(
      selectTransportCanal({ originCode: 'DIL', destCode: 'BCU', ...small, isFragile: true }),
    ).toBe('CARGO_TRUCK_PICKUP'));
  it('Oecusse and Ataúro are always sea, even for tiny parcels', () => {
    expect(selectTransportCanal({ originCode: 'DIL', destCode: 'OEC', ...small })).toBe('SEA_FERRY_CARGO');
    expect(selectTransportCanal({ originCode: 'ATA', destCode: 'DIL', ...small })).toBe('SEA_FERRY_CARGO');
  });
  it('blocks land assignment to Oecusse / Ataúro', () => {
    expect(() =>
      assertCanalAllowed('BUS_BAGGAGE', { originCode: 'DIL', destCode: 'OEC', ...small }),
    ).toThrow(CanalRoutingError);
    expect(() =>
      assertCanalAllowed('CARGO_TRUCK_PICKUP', { originCode: 'DIL', destCode: 'ATA', ...small }),
    ).toThrow(CanalRoutingError);
    expect(() =>
      assertCanalAllowed('SEA_FERRY_CARGO', { originCode: 'DIL', destCode: 'OEC', ...small }),
    ).not.toThrow();
  });
  it('rejects > 500 kg', () =>
    expect(() =>
      selectTransportCanal({ originCode: 'DIL', destCode: 'BCU', ...small, chargeableKg: 501 }),
    ).toThrow(CanalRoutingError));
});

describe('money', () => {
  it('round-trips without float drift', () => {
    expect(formatMoneyDb(parseMoney('4.00'))).toBe('4.0000');
    expect(formatMoneyDb(parseMoney(0.1) + parseMoney(0.2))).toBe('0.3000');
    expect(formatMoneyDisplay(parseMoney('3.4'))).toBe('$3.40');
  });
});

describe('insurance & liability', () => {
  it('premium is 1% with a $1.00 minimum', () => {
    expect(formatMoneyDb(insurancePremium('50').premium)).toBe('1.0000');
    expect(formatMoneyDb(insurancePremium('300').premium)).toBe('3.0000');
  });
  it('coverage is capped at $500', () => {
    const r = insurancePremium('2000');
    expect(formatMoneyDb(r.insuredAmount)).toBe('500.0000');
    expect(formatMoneyDb(r.premium)).toBe('5.0000');
  });
  it('uninsured liability = min(10x fee, $50)', () => {
    expect(formatMoneyDb(uninsuredLiability('4.00'))).toBe('40.0000');
    expect(formatMoneyDb(uninsuredLiability('6.00'))).toBe('50.0000');
  });
  it('eligible liability picks insured vs uninsured', () => {
    expect(
      formatMoneyDb(maxEligibleLiability({ isInsured: true, declaredValue: '120', baseShippingFee: '4' })),
    ).toBe('120.0000');
    expect(formatMoneyDb(maxEligibleLiability({ isInsured: false, baseShippingFee: '4' }))).toBe(
      '40.0000',
    );
  });
});
