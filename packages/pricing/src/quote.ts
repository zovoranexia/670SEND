import {
  ADDON_SPLIT_BPS,
  REVENUE_SPLIT_BPS,
  chargeableWeightKg,
  fitsBusDimensions,
  isDocumentTier,
  parseMoney,
  volumetricWeightKg,
  BUS_BAGGAGE_LIMITS,
  type MoneyUnits,
} from './core';

/**
 * Pure tariff + money-split rules (no I/O). The API loads zone / add-on rates from the database
 * (admin-editable) and feeds them to these functions; the public calculator uses the same ones.
 */

/** Which column of the tariff table prices the parcel. Independent of the fleet canal. */
export type TariffTier = 'DOCUMENT' | 'SMALL' | 'CARGO';

export interface ParcelFacts {
  actualKg: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  isFragile?: boolean;
  isHeavyBulk?: boolean;
  isDocumentCategory?: boolean;
}

export interface ParcelMeasure {
  volumetricKg: number;
  chargeableKg: number;
  /** ≤ 10 kg chargeable, ≤ 40×30×30 cm, not fragile / heavy bulk. */
  fitsBus: boolean;
  tier: TariffTier;
}

export function measureParcel(f: ParcelFacts): ParcelMeasure {
  const volumetricKg = volumetricWeightKg(f.lengthCm, f.widthCm, f.heightCm);
  const chargeableKg = chargeableWeightKg(f.actualKg, volumetricKg);
  const fitsBus =
    chargeableKg <= BUS_BAGGAGE_LIMITS.maxKg &&
    fitsBusDimensions(f.lengthCm, f.widthCm, f.heightCm) &&
    !f.isFragile &&
    !f.isHeavyBulk;
  const tier: TariffTier = isDocumentTier(f.actualKg, volumetricKg, f.isDocumentCategory === true)
    ? 'DOCUMENT'
    : fitsBus
      ? 'SMALL'
      : 'CARGO';
  return { volumetricKg, chargeableKg, fitsBus, tier };
}

export interface ZoneRates {
  docRate: string;
  smallBase2kg: string;
  extraPerKg: string;
  cargoBase10kg: string;
  cargoExtraPerKg: string;
}

/**
 * Base shipping fee F (USD, 1/10,000 units).
 *  DOCUMENT  flat document rate (≤ 0.5 kg)
 *  SMALL     base for the first 2 kg + extra per kg for kg 3…10
 *  CARGO     base for the first 10 kg + extra per kg beyond 10
 * `surcharge` is the per-municipality extra (Oecusse +$2.00 → Zone 4 spans $6–$8); it is not
 * applied to documents, whose Zone 4 price is a single $5.00.
 */
export function baseShippingFee(
  tier: TariffTier,
  chargeableKg: number,
  rates: ZoneRates,
  surcharge: string = '0',
): MoneyUnits {
  const extra = (perKg: string, over: number) => parseMoney(perKg) * BigInt(Math.max(0, chargeableKg - over));
  switch (tier) {
    case 'DOCUMENT':
      return parseMoney(rates.docRate);
    case 'SMALL':
      return parseMoney(rates.smallBase2kg) + extra(rates.extraPerKg, 2) + parseMoney(surcharge);
    case 'CARGO':
      return parseMoney(rates.cargoBase10kg) + extra(rates.cargoExtraPerKg, 10) + parseMoney(surcharge);
  }
}

export interface BaseFeeSplit {
  fleet: MoneyUnits;
  platform: MoneyUnits;
  originAgent: MoneyUnits;
  destAgent: MoneyUnits;
  claimReserve: MoneyUnits;
}

const pct = (amount: MoneyUnits, bps: number): MoneyUnits => (amount * BigInt(bps)) / 10_000n;

/**
 * 40 / 25 / 15 / 15 / 5 split of the base fee (SOP §6.1) in exact integer units.
 * Every partner share is rounded DOWN; the platform takes the remainder, so the five parts always
 * add up to F to the last 1/10,000 USD (the DB also checks this).
 */
export function splitBaseFee(
  fee: MoneyUnits,
  bps: Record<keyof typeof REVENUE_SPLIT_BPS, number> = REVENUE_SPLIT_BPS,
): BaseFeeSplit {
  const fleet = pct(fee, bps.fleet);
  const originAgent = pct(fee, bps.originAgent);
  const destAgent = pct(fee, bps.destAgent);
  const claimReserve = pct(fee, bps.claimReserve);
  return { fleet, originAgent, destAgent, claimReserve, platform: fee - fleet - originAgent - destAgent - claimReserve };
}

/** 80 % courier / partner, 20 % platform (remainder). */
export function splitAddon(
  fee: MoneyUnits,
  bps: { partner: number; platform: number } = ADDON_SPLIT_BPS,
): { partner: MoneyUnits; platform: MoneyUnits } {
  const partner = pct(fee, bps.partner);
  return { partner, platform: fee - partner };
}
