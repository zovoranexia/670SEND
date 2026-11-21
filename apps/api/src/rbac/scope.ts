import { hasPermission, type PermissionKey } from '@670send/types';
import { Err } from '../common/errors';
import type { Actor } from './actor';

type MaybeId = string | null | undefined;

/** Who "owns" a resource. Any one match grants access to a scoped (`_own`) actor. */
export interface ResourceOwners {
  agentIds?: MaybeId[];
  courierIds?: MaybeId[];
  driverIds?: MaybeId[];
  fleetPartnerId?: MaybeId;
}

/**
 * Ownership check backing every `_own` permission.
 * `bypass` is the "see everything" permission (e.g. `shipments:read_all`) that lifts the scope.
 * An actor with no scope id (agent suspended, wrong role…) can never match.
 */
export function canAccess(actor: Actor, owners: ResourceOwners, bypass?: PermissionKey): boolean {
  if (bypass && hasPermission(actor.permissions, bypass)) return true;
  if (actor.agentId && owners.agentIds?.includes(actor.agentId)) return true;
  if (actor.courierId && owners.courierIds?.includes(actor.courierId)) return true;
  if (actor.driverId && owners.driverIds?.includes(actor.driverId)) return true;
  if (actor.fleetPartnerId && owners.fleetPartnerId === actor.fleetPartnerId) return true;
  return false;
}

/**
 * Same check, throwing 404 (not 403) so a scoped user cannot tell whether someone else's
 * resource exists.
 */
export function assertCanAccess(actor: Actor, owners: ResourceOwners, bypass?: PermissionKey): void {
  if (!canAccess(actor, owners, bypass)) throw Err.notFound();
}
