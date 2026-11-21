import { MUNICIPALITIES } from '@670send/types';

export const CORRIDOR_ORDER = ['LOCAL', 'EAST', 'SOUTH', 'WEST', 'SEA'] as const;
export type Corridor = (typeof CORRIDOR_ORDER)[number];

export interface MunicipalityOption {
  code: string;
  name: string;
  corridor: Corridor;
  isSea: boolean;
}

export const MUNICIPALITY_OPTIONS: readonly MunicipalityOption[] = MUNICIPALITIES.map((m) => ({
  code: m.code,
  name: m.name,
  corridor: m.corridor as Corridor,
  isSea: m.isSeaRoute,
}));

export function groupByCorridor(): Array<{ corridor: Corridor; items: MunicipalityOption[] }> {
  return CORRIDOR_ORDER.map((corridor) => ({ corridor, items: MUNICIPALITY_OPTIONS.filter((m) => m.corridor === corridor) })).filter((g) => g.items.length > 0);
}

/**
 * Every launch route starts or ends in Díli. When the visitor changes one end to a province, the other end
 * snaps to Díli (and vice versa), so an impossible route can never be put together by accident.
 */
export function coerceRoute(route: { origin: string; dest: string }, changed: 'origin' | 'dest'): { origin: string; dest: string } {
  const { origin, dest } = route;
  if (origin !== 'DIL' && dest !== 'DIL') return changed === 'origin' ? { origin, dest: 'DIL' } : { origin: 'DIL', dest };
  if (origin === 'DIL' && dest === 'DIL') return changed === 'origin' ? { origin, dest: 'BCU' } : { origin: 'BCU', dest };
  return route;
}
