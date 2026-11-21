import type { Locale } from '@670send/types';

/** The authenticated principal, rebuilt from the database (short cache) on every request. */
export interface Actor {
  id: string;
  fullName: string;
  phone: string;
  email: string | null;
  lang: Locale;
  roles: string[];
  /** Flat permission keys, may contain the wildcard `*:*`. */
  permissions: string[];
  /** Resource ownership scope — drives the `_own` permission checks. */
  agentId?: string;
  courierId?: string;
  driverId?: string;
  /** Fleet partner the actor belongs to (as owner or as driver). */
  fleetPartnerId?: string;
  mustChangePassword: boolean;
}
