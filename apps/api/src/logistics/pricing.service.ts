import { Injectable } from '@nestjs/common';
import type { AddonServiceType, ItemCategory, ServiceScheme, TransportCanal } from '@prisma/client';
import { SERVICE_SCHEME_META, getMunicipality } from '@670send/types';
import {
  CanalRoutingError,
  baseShippingFee,
  formatMoneyDb,
  formatMoneyDisplay,
  insurancePremium,
  measureParcel,
  parseMoney,
  selectTransportCanal,
  splitAddon,
  type MoneyUnits,
  type ParcelMeasure,
  type TariffTier,
  type ZoneRates,
} from '@670send/pricing';
import { AppException, Err } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';

export interface QuoteInput {
  originCode: string;
  destCode: string;
  scheme: ServiceScheme;
  actualWeightKg: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  itemCategory?: ItemCategory;
  isFragile?: boolean;
  isHeavyBulk?: boolean;
  declaredValue?: string;
  insure?: boolean;
  /** Wholesale rule: ≥ N parcels from one pick-up address pay the pick-up add-on once. */
  pickupBatch?: { parcelCount: number; alreadyChargedInBatch: boolean };
}

export interface AddonLine {
  service: AddonServiceType;
  fee: MoneyUnits;
  courierShare: MoneyUnits;
  platformShare: MoneyUnits;
  wholesaleApplied: boolean;
}

/** Internal quote with exact integer money. */
export interface Quote {
  originCode: string;
  destCode: string;
  originMunicipalityId: string;
  destMunicipalityId: string;
  scheme: ServiceScheme;
  canal: TransportCanal;
  tier: TariffTier;
  measure: ParcelMeasure;
  zoneCode: string;
  zoneEta: { tet: string; pt: string; en: string; id: string };
  base: MoneyUnits;
  pickup: AddonLine | null;
  delivery: AddonLine | null;
  premium: MoneyUnits;
  insuredAmount: MoneyUnits;
  total: MoneyUnits;
  isSea: boolean;
  /** Frozen inputs, stored on the shipment so disputes are judged on the tariff actually applied. */
  snapshot: Record<string, unknown>;
}

const m = (u: MoneyUnits) => ({ usd: formatMoneyDb(u), display: formatMoneyDisplay(u) });

/** JSON-safe view for the public calculator and API responses. */
export function quoteToDto(q: Quote) {
  const addon = (a: AddonLine | null) =>
    a && { service: a.service, fee: m(a.fee), courierShare: m(a.courierShare), platformShare: m(a.platformShare), wholesaleApplied: a.wholesaleApplied };
  return {
    origin: q.originCode,
    destination: q.destCode,
    scheme: q.scheme,
    canal: q.canal,
    tariffTier: q.tier,
    isSeaRoute: q.isSea,
    zone: q.zoneCode,
    eta: q.zoneEta,
    volumetricWeightKg: q.measure.volumetricKg,
    chargeableWeightKg: q.measure.chargeableKg,
    baseShippingFee: m(q.base),
    pickupAddon: addon(q.pickup),
    deliveryAddon: addon(q.delivery),
    insurance: q.premium > 0n ? { premium: m(q.premium), insuredAmount: m(q.insuredAmount) } : null,
    total: m(q.total),
    currency: 'USD',
  };
}

@Injectable()
export class PricingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Price a parcel and decide how it travels. Launch scope (per the tariff): every route starts or
   * ends in Díli. Oecusse / Ataúro are forced onto the ferry canal and can never be priced as bus freight.
   */
  async quote(input: QuoteInput): Promise<Quote> {
    const origin = getMunicipality(input.originCode);
    const dest = getMunicipality(input.destCode);
    if (!origin || !dest) throw Err.validation([{ path: 'municipality', message: 'errors.validation_failed' }]);
    if (origin.code === dest.code || (origin.code !== 'DIL' && dest.code !== 'DIL')) {
      throw new AppException('route_not_supported', 422);
    }

    const [originRow, destRow] = await Promise.all([
      this.prisma.municipality.findUniqueOrThrow({ where: { code: origin.code }, include: { zone: true } }),
      this.prisma.municipality.findUniqueOrThrow({ where: { code: dest.code }, include: { zone: true } }),
    ]);
    const priced = origin.code === 'DIL' ? destRow : originRow; // tariff zone = the non-Díli end
    if (!priced.zone) throw new AppException('route_not_supported', 422);

    const measure = measureParcel({
      actualKg: input.actualWeightKg,
      lengthCm: input.lengthCm,
      widthCm: input.widthCm,
      heightCm: input.heightCm,
      isFragile: input.isFragile,
      isHeavyBulk: input.isHeavyBulk,
      isDocumentCategory: input.itemCategory === 'DOCUMENT',
    });

    let canal: TransportCanal;
    try {
      canal = selectTransportCanal({
        originCode: origin.code,
        destCode: dest.code,
        chargeableKg: measure.chargeableKg,
        lengthCm: input.lengthCm,
        widthCm: input.widthCm,
        heightCm: input.heightCm,
        isFragile: input.isFragile,
        isHeavyBulk: input.isHeavyBulk,
      });
    } catch (err) {
      if (err instanceof CanalRoutingError) throw new AppException(err.code === 'OVER_MAX_WEIGHT' ? 'over_max_weight' : 'bus_limit_exceeded', 422);
      throw err;
    }

    const zone = priced.zone;
    const rates: ZoneRates = {
      docRate: zone.docRateUsd.toFixed(4),
      smallBase2kg: zone.smallBase2kgUsd.toFixed(4),
      extraPerKg: zone.extraPerKgUsd.toFixed(4),
      cargoBase10kg: zone.cargoBase10kgUsd.toFixed(4),
      cargoExtraPerKg: zone.cargoExtraPerKgUsd.toFixed(4),
    };
    const surcharge = priced.tariffSurchargeUsd.toFixed(4);
    const base = baseShippingFee(measure.tier, measure.chargeableKg, rates, surcharge);

    // --- insurance ----------------------------------------------------------------------------
    const needsValue = input.itemCategory === 'ELECTRONICS' || input.insure === true;
    if (needsValue && !input.declaredValue) throw new AppException('declared_value_required', 422);
    let premium = 0n;
    let insuredAmount = 0n;
    if (input.insure && input.declaredValue) {
      ({ premium, insuredAmount } = insurancePremium(input.declaredValue));
    }

    // --- courier add-ons (80 % courier / 20 % platform) -------------------------------------------
    const tariffs = new Map((await this.prisma.addonTariff.findMany({ where: { isActive: true } })).map((t) => [t.serviceType, t]));
    const line = (service: AddonServiceType, applyCharge: (fee: MoneyUnits) => { fee: MoneyUnits; wholesale: boolean }): AddonLine => {
      const t = tariffs.get(service);
      if (!t) throw new AppException('addon_not_available', 422);
      const { fee, wholesale } = applyCharge(parseMoney(t.feeUsd.toFixed(4)));
      const sp = splitAddon(fee, {
        partner: Math.round(Number(t.courierSplitPct) * 100),
        platform: Math.round(Number(t.platformSplitPct) * 100),
      });
      return { service, fee, courierShare: sp.partner, platformShare: sp.platform, wholesaleApplied: wholesale };
    };

    const meta = SERVICE_SCHEME_META[input.scheme];
    const cargo = measure.tier === 'CARGO';
    let pickup: AddonLine | null = null;
    let delivery: AddonLine | null = null;

    if (meta.pickup) {
      if (cargo && origin.code !== 'DIL') throw new AppException('addon_not_available', 422); // pick-up trucks: Díli urban only
      const service: AddonServiceType = cargo ? 'CARGO_PICKUP' : 'MOTOR_PICKUP';
      const t = tariffs.get(service);
      pickup = line(service, (fee) => {
        const b = input.pickupBatch;
        if (t && b && b.parcelCount >= t.wholesaleMinParcels) {
          if (t.wholesaleFreePickup) return { fee: 0n, wholesale: true };
          if (b.alreadyChargedInBatch) return { fee: 0n, wholesale: true };
        }
        return { fee, wholesale: false };
      });
    }
    if (meta.delivery) {
      if (cargo && dest.code !== 'DIL') throw new AppException('addon_not_available', 422);
      delivery = line(cargo ? 'CARGO_DELIVERY' : 'MOTOR_DELIVERY', (fee) => ({ fee, wholesale: false }));
    }

    const total = base + premium + (pickup?.fee ?? 0n) + (delivery?.fee ?? 0n);

    return {
      originCode: origin.code,
      destCode: dest.code,
      originMunicipalityId: originRow.id,
      destMunicipalityId: destRow.id,
      scheme: input.scheme,
      canal,
      tier: measure.tier,
      measure,
      zoneCode: zone.code,
      zoneEta: { tet: zone.etaTet, pt: zone.etaPt, en: zone.etaEn, id: zone.etaId },
      base,
      pickup,
      delivery,
      premium,
      insuredAmount,
      total,
      isSea: canal === 'SEA_FERRY_CARGO',
      snapshot: {
        zone: zone.code,
        rates,
        surcharge,
        tier: measure.tier,
        canal,
        chargeableKg: measure.chargeableKg,
        volumetricKg: measure.volumetricKg,
        addons: {
          pickup: pickup && { service: pickup.service, fee: formatMoneyDb(pickup.fee), wholesale: pickup.wholesaleApplied },
          delivery: delivery && { service: delivery.service, fee: formatMoneyDb(delivery.fee) },
        },
        premium: formatMoneyDb(premium),
        total: formatMoneyDb(total),
        pricedAt: new Date().toISOString(),
      },
    };
  }
}
