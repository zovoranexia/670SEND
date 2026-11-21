import type { RouteCorridor } from './domain';

export const ZONE_CODES = ['ZONE_1', 'ZONE_2', 'ZONE_3', 'ZONE_4'] as const;
export type ZoneCode = (typeof ZONE_CODES)[number];

export const HUB_CODES = ['HUB_BECORA', 'HUB_TAIBESI', 'HUB_TASI_TOLU', 'HUB_DILI_PORT'] as const;
export type HubCode = (typeof HUB_CODES)[number];

export interface MunicipalityDef {
  /** 3-letter code used inside waybill numbers. */
  code: string;
  name: string;
  /** Local names of the main town (used for display / agent location). */
  mainTown: string;
  corridor: RouteCorridor;
  /** Null only for Dili (the origin of every tariff). */
  zone: ZoneCode | null;
  /** Ataúro & Oecusse: bus land-transit is FORBIDDEN, sea manifest only. */
  isSeaRoute: boolean;
  hub: HubCode | null;
  /** Extra USD added to the zone base rate (Zone 4 spans $6.00–$8.00). */
  tariffSurchargeUsd: string;
}

/** All 14 municipalities of Timor-Leste. Codes are the ones mandated by the spec. */
export const MUNICIPALITIES: readonly MunicipalityDef[] = [
  { code: 'DIL', name: 'Díli', mainTown: 'Díli', corridor: 'LOCAL', zone: null, isSeaRoute: false, hub: null, tariffSurchargeUsd: '0.00' },
  // East corridor — Terminal Becora
  { code: 'MAN', name: 'Manatuto', mainTown: 'Manatuto', corridor: 'EAST', zone: 'ZONE_1', isSeaRoute: false, hub: 'HUB_BECORA', tariffSurchargeUsd: '0.00' },
  { code: 'BCU', name: 'Baucau', mainTown: 'Baucau', corridor: 'EAST', zone: 'ZONE_2', isSeaRoute: false, hub: 'HUB_BECORA', tariffSurchargeUsd: '0.00' },
  { code: 'VIQ', name: 'Viqueque', mainTown: 'Viqueque', corridor: 'EAST', zone: 'ZONE_3', isSeaRoute: false, hub: 'HUB_BECORA', tariffSurchargeUsd: '0.00' },
  { code: 'LAU', name: 'Lautém', mainTown: 'Lospalos', corridor: 'EAST', zone: 'ZONE_3', isSeaRoute: false, hub: 'HUB_BECORA', tariffSurchargeUsd: '0.00' },
  // South corridor — Terminal Taibesi
  { code: 'AIL', name: 'Aileu', mainTown: 'Aileu', corridor: 'SOUTH', zone: 'ZONE_1', isSeaRoute: false, hub: 'HUB_TAIBESI', tariffSurchargeUsd: '0.00' },
  { code: 'AIN', name: 'Ainaro', mainTown: 'Maubisse', corridor: 'SOUTH', zone: 'ZONE_2', isSeaRoute: false, hub: 'HUB_TAIBESI', tariffSurchargeUsd: '0.00' },
  { code: 'MFH', name: 'Manufahi', mainTown: 'Same', corridor: 'SOUTH', zone: 'ZONE_2', isSeaRoute: false, hub: 'HUB_TAIBESI', tariffSurchargeUsd: '0.00' },
  { code: 'COV', name: 'Cova Lima', mainTown: 'Suai', corridor: 'SOUTH', zone: 'ZONE_3', isSeaRoute: false, hub: 'HUB_TAIBESI', tariffSurchargeUsd: '0.00' },
  // West corridor — Terminal Tasi Tolu
  { code: 'LIQ', name: 'Liquiçá', mainTown: 'Liquiçá', corridor: 'WEST', zone: 'ZONE_1', isSeaRoute: false, hub: 'HUB_TASI_TOLU', tariffSurchargeUsd: '0.00' },
  { code: 'ERM', name: 'Ermera', mainTown: 'Gleno', corridor: 'WEST', zone: 'ZONE_1', isSeaRoute: false, hub: 'HUB_TASI_TOLU', tariffSurchargeUsd: '0.00' },
  { code: 'BOB', name: 'Bobonaro', mainTown: 'Maliana', corridor: 'WEST', zone: 'ZONE_2', isSeaRoute: false, hub: 'HUB_TASI_TOLU', tariffSurchargeUsd: '0.00' },
  // Sea corridor — Porto Dili (ferry / port cargo manifest ONLY)
  { code: 'ATA', name: 'Ataúro', mainTown: 'Vila Maumeta', corridor: 'SEA', zone: 'ZONE_4', isSeaRoute: true, hub: 'HUB_DILI_PORT', tariffSurchargeUsd: '0.00' },
  { code: 'OEC', name: 'Oecusse (RAEOA)', mainTown: 'Pante Macassar', corridor: 'SEA', zone: 'ZONE_4', isSeaRoute: true, hub: 'HUB_DILI_PORT', tariffSurchargeUsd: '2.00' },
] as const;

export const MUNICIPALITY_CODES = MUNICIPALITIES.map((m) => m.code);

const BY_CODE = new Map(MUNICIPALITIES.map((m) => [m.code, m] as const));

export function getMunicipality(code: string): MunicipalityDef | undefined {
  return BY_CODE.get(code.toUpperCase());
}

/** True when a shipment touching this municipality must use SEA_FERRY_CARGO only. */
export function isSeaMunicipality(code: string): boolean {
  return getMunicipality(code)?.isSeaRoute === true;
}

export interface HubDef {
  code: HubCode;
  name: string;
  type: 'TERMINAL' | 'PORT';
  corridor: RouteCorridor;
  address: string;
  /** Approximate coordinates — replace with surveyed positions before launch. */
  lat: number;
  lng: number;
}

export const HUBS: readonly HubDef[] = [
  { code: 'HUB_BECORA', name: 'Terminal Becora', type: 'TERMINAL', corridor: 'EAST', address: 'Terminal Becora, Díli', lat: -8.5583, lng: 125.5897 },
  { code: 'HUB_TAIBESI', name: 'Terminal Taibesi', type: 'TERMINAL', corridor: 'SOUTH', address: 'Terminal Taibesi, Díli', lat: -8.5575, lng: 125.5615 },
  { code: 'HUB_TASI_TOLU', name: 'Terminal Tasi Tolu', type: 'TERMINAL', corridor: 'WEST', address: 'Terminal Tasi Tolu, Díli', lat: -8.542, lng: 125.509 },
  { code: 'HUB_DILI_PORT', name: 'Porto Díli', type: 'PORT', corridor: 'SEA', address: 'Porto Díli (Ferry / Kargu Laut), Díli', lat: -8.5565, lng: 125.576 },
] as const;
