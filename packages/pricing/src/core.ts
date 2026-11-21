import { isSeaMunicipality, type TransportCanal } from '@670send/types';

/* -------------------------------------------------------------------------- */
/* Money helpers — integer arithmetic in 1/10,000 USD (matches NUMERIC(14,4)) */
/* -------------------------------------------------------------------------- */

export type MoneyUnits = bigint;
const SCALE = 10_000n;

/** "4.00" | 4 → 40000n. Rejects more than 4 decimals instead of silently rounding. */
export function parseMoney(value: string | number): MoneyUnits {
  const s = typeof value === 'number' ? value.toFixed(4) : value.trim();
  const m = /^(-?)(\d+)(?:\.(\d{1,4}))?$/.exec(s);
  if (!m) throw new Error(`Invalid money value: ${String(value)}`);
  const [, sign, whole, frac = ''] = m;
  const units = BigInt(whole!) * SCALE + BigInt(frac.padEnd(4, '0'));
  return sign === '-' ? -units : units;
}

/** 40000n → "4.0000" (the exact string Prisma Decimal / PostgreSQL NUMERIC(14,4) accepts). */
export function formatMoneyDb(units: MoneyUnits): string {
  const neg = units < 0n;
  const abs = neg ? -units : units;
  const whole = abs / SCALE;
  const frac = (abs % SCALE).toString().padStart(4, '0');
  return `${neg ? '-' : ''}${whole}.${frac}`;
}

/** 40000n → "$4.00" for display (rounds half-up to cents). */
export function formatMoneyDisplay(units: MoneyUnits): string {
  const neg = units < 0n;
  const abs = neg ? -units : units;
  const cents = (abs + 50n) / 100n;
  const whole = cents / 100n;
  const c = (cents % 100n).toString().padStart(2, '0');
  return `${neg ? '-' : ''}$${whole}.${c}`;
}

/* -------------------------------------------------------------------------- */
/* Business constants (defaults — admin-editable values live in system_settings) */
/* -------------------------------------------------------------------------- */

/** Base-fee revenue split in basis points (SOP §6.1). Must sum to 10,000. */
export const REVENUE_SPLIT_BPS = {
  fleet: 4000,
  platform: 2500,
  originAgent: 1500,
  destAgent: 1500,
  claimReserve: 500,
} as const;

/** Courier / pickup-truck add-on split (SOP §6.3). */
export const ADDON_SPLIT_BPS = { partner: 8000, platform: 2000 } as const;

export const BUS_BAGGAGE_LIMITS = { maxKg: 10, maxLengthCm: 40, maxWidthCm: 30, maxHeightCm: 30 } as const;
export const CARGO_MAX_KG = 500;
export const VOLUMETRIC_DIVISOR = 6000;
export const DOCUMENT_MAX_KG = 0.5;

export const INSURANCE = { rate: 0.01, minPremium: '1.00', maxCoverage: '500.00' } as const;
export const UNINSURED_LIABILITY = { multiplier: 10, capUsd: '50.00' } as const;

export const STORAGE_POLICY = {
  freeDays: 5,
  reminderDays: [3, 5],
  penaltyPerDayUsd: '0.50',
  penaltyFromDay: 6,
  rtsAfterDays: 14,
  shortShelfLifeRtsHours: 24,
  /** Split of collected penalty, basis points. */
  destAgentBps: 7000,
  platformBps: 3000,
} as const;

export const BUS_CAPACITY_DEFAULTS = { maxSmallParcels: 20, maxMasterBags: 2 } as const;

(() => {
  const sum = Object.values(REVENUE_SPLIT_BPS).reduce((a, b) => a + b, 0);
  if (sum !== 10_000) throw new Error(`REVENUE_SPLIT_BPS must sum to 10000, got ${sum}`);
  if (ADDON_SPLIT_BPS.partner + ADDON_SPLIT_BPS.platform !== 10_000) {
    throw new Error('ADDON_SPLIT_BPS must sum to 10000');
  }
  if (STORAGE_POLICY.destAgentBps + STORAGE_POLICY.platformBps !== 10_000) {
    throw new Error('STORAGE_POLICY split must sum to 10000');
  }
})();

/* -------------------------------------------------------------------------- */
/* Weight                                                                     */
/* -------------------------------------------------------------------------- */

/** volumetric_kg = (L × W × H) / 6000, kept unrounded (3 decimals to remove float noise). */
export function volumetricWeightKg(lengthCm: number, widthCm: number, heightCm: number): number {
  const v = (lengthCm * widthCm * heightCm) / VOLUMETRIC_DIVISOR;
  return Math.round(v * 1000) / 1000;
}

/** chargeable_kg = ceil(max(actual, volumetric)), minimum 1 kg. */
export function chargeableWeightKg(actualKg: number, volumetricKg: number): number {
  const raw = Math.round(Math.max(actualKg, volumetricKg) * 1000) / 1000;
  return Math.max(1, Math.ceil(raw));
}

/** Document tier: ≤ 0.5 kg actual AND volumetric ≤ 0.5 kg AND category DOCUMENT. */
export function isDocumentTier(actualKg: number, volumetricKg: number, isDocumentCategory: boolean): boolean {
  return isDocumentCategory && actualKg <= DOCUMENT_MAX_KG && volumetricKg <= DOCUMENT_MAX_KG;
}

/* -------------------------------------------------------------------------- */
/* Canal (fleet) routing                                                      */
/* -------------------------------------------------------------------------- */

export type CanalErrorCode =
  | 'SEA_ROUTE_BUS_FORBIDDEN'
  | 'OVER_MAX_WEIGHT'
  | 'BUS_LIMIT_EXCEEDED';

export class CanalRoutingError extends Error {
  constructor(
    public readonly code: CanalErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CanalRoutingError';
  }
}

export interface CanalInput {
  originCode: string;
  destCode: string;
  chargeableKg: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  isFragile?: boolean;
  isHeavyBulk?: boolean;
}

/**
 * Bus-baggage dimension rule 40 × 30 × 30 cm. Orientation does not matter (a 30×40×30 box fits),
 * so both the parcel and the limit are compared longest-side-first.
 */
export function fitsBusDimensions(lengthCm: number, widthCm: number, heightCm: number): boolean {
  const parcel = [lengthCm, widthCm, heightCm].sort((a, b) => b - a);
  const limit = [BUS_BAGGAGE_LIMITS.maxLengthCm, BUS_BAGGAGE_LIMITS.maxWidthCm, BUS_BAGGAGE_LIMITS.maxHeightCm].sort((a, b) => b - a);
  return parcel.every((v, i) => v <= limit[i]!);
}

/** Auto-assign the transport canal (SOP §2.1 step 3 + compliance rule for Oecusse/Ataúro). */
export function selectTransportCanal(input: CanalInput): TransportCanal {
  if (input.chargeableKg > CARGO_MAX_KG) {
    throw new CanalRoutingError('OVER_MAX_WEIGHT', `Chargeable weight ${input.chargeableKg}kg exceeds ${CARGO_MAX_KG}kg`);
  }
  if (isSeaMunicipality(input.originCode) || isSeaMunicipality(input.destCode)) {
    return 'SEA_FERRY_CARGO';
  }
  const fitsBus =
    input.chargeableKg <= BUS_BAGGAGE_LIMITS.maxKg &&
    fitsBusDimensions(input.lengthCm, input.widthCm, input.heightCm) &&
    !input.isFragile &&
    !input.isHeavyBulk;
  return fitsBus ? 'BUS_BAGGAGE' : 'CARGO_TRUCK_PICKUP';
}

/**
 * Hard guard used when a canal is assigned manually (manifest building):
 * Oecusse / Ataúro may NEVER travel by land, and bus baggage limits still apply.
 */
export function assertCanalAllowed(canal: TransportCanal, input: CanalInput): void {
  const sea = isSeaMunicipality(input.originCode) || isSeaMunicipality(input.destCode);
  if (sea && canal !== 'SEA_FERRY_CARGO') {
    throw new CanalRoutingError(
      'SEA_ROUTE_BUS_FORBIDDEN',
      'Shipments to/from Oecusse (RAEOA) and Ataúro must use SEA_CARGO_MANIFEST only',
    );
  }
  if (canal === 'BUS_BAGGAGE' && selectTransportCanal(input) !== 'BUS_BAGGAGE') {
    throw new CanalRoutingError('BUS_LIMIT_EXCEEDED', 'Parcel exceeds bus baggage limits');
  }
}

/* -------------------------------------------------------------------------- */
/* Insurance & liability                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Premium = max($1.00, 1% of the insured amount). Coverage is capped at $500.00,
 * so the premium is computed on min(declared, $500) — a customer is never
 * charged for cover they cannot claim. (Assumption flagged in ARCHITECTURE.md.)
 */
export function insurancePremium(declaredValue: string | number): { insuredAmount: MoneyUnits; premium: MoneyUnits } {
  const declared = parseMoney(declaredValue);
  const cap = parseMoney(INSURANCE.maxCoverage);
  const insuredAmount = declared > cap ? cap : declared;
  const onePercent = insuredAmount / 100n; // 1% in 1/10,000 USD units (truncated)
  const min = parseMoney(INSURANCE.minPremium);
  return { insuredAmount, premium: onePercent > min ? onePercent : min };
}

/** Uninsured liability = min(10 × base shipping fee, $50.00). */
export function uninsuredLiability(baseShippingFee: string | number): MoneyUnits {
  const cap = parseMoney(UNINSURED_LIABILITY.capUsd);
  const tenX = parseMoney(baseShippingFee) * BigInt(UNINSURED_LIABILITY.multiplier);
  return tenX < cap ? tenX : cap;
}

/** Max eligible liability for a claim (auto-calculated by SOP rule). */
export function maxEligibleLiability(args: {
  isInsured: boolean;
  declaredValue?: string | number | null;
  baseShippingFee: string | number;
}): MoneyUnits {
  if (args.isInsured && args.declaredValue != null) {
    const declared = parseMoney(args.declaredValue);
    const cap = parseMoney(INSURANCE.maxCoverage);
    return declared > cap ? cap : declared;
  }
  return uninsuredLiability(args.baseShippingFee);
}
