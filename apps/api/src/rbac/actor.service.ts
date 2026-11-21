import { Injectable } from '@nestjs/common';
import { normalizeLocale } from '@670send/types';
import { PrismaService } from '../prisma/prisma.service';
import type { Actor } from './actor';

const CACHE_TTL_MS = 30_000;

/**
 * Rebuilds the acting principal (roles, permissions, ownership scope) from the DB.
 * A 30 s in-process cache keeps this off the hot path while still letting an admin's
 * role change or account deactivation take effect almost immediately
 * (and instantly on this instance via invalidate()).
 */
@Injectable()
export class ActorService {
  private readonly cache = new Map<string, { actor: Actor | null; expires: number }>();

  constructor(private readonly prisma: PrismaService) {}

  invalidate(userId?: string): void {
    if (userId) this.cache.delete(userId);
    else this.cache.clear();
  }

  async load(userId: string): Promise<Actor | null> {
    const hit = this.cache.get(userId);
    if (hit && hit.expires > Date.now()) return hit.actor;

    const actor = await this.build(userId);
    this.cache.set(userId, { actor, expires: Date.now() + CACHE_TTL_MS });
    return actor;
  }

  private async build(userId: string): Promise<Actor | null> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, isActive: true, deletedAt: null },
      include: {
        userRoles: {
          include: { role: { include: { permissions: { include: { permission: true } } } } },
        },
        agent: { select: { id: true, status: true, deletedAt: true } },
        courier: { select: { id: true, status: true, deletedAt: true } },
        driver: { select: { id: true, isActive: true, deletedAt: true, fleetPartnerId: true } },
        fleetPartners: { where: { deletedAt: null, status: 'ACTIVE' }, select: { id: true }, take: 1 },
      },
    });
    if (!user) return null;

    const permissions = new Set<string>();
    const roles: string[] = [];
    for (const ur of user.userRoles) {
      roles.push(ur.role.key);
      for (const rp of ur.role.permissions) permissions.add(rp.permission.key);
    }

    const agentOk = user.agent && user.agent.status === 'ACTIVE' && !user.agent.deletedAt;
    const courierOk = user.courier && user.courier.status === 'ACTIVE' && !user.courier.deletedAt;
    const driverOk = user.driver && user.driver.isActive && !user.driver.deletedAt;

    return {
      id: user.id,
      fullName: user.fullName,
      phone: user.phone,
      email: user.email,
      lang: normalizeLocale(user.preferredLang),
      roles,
      permissions: [...permissions],
      agentId: agentOk ? user.agent!.id : undefined,
      courierId: courierOk ? user.courier!.id : undefined,
      driverId: driverOk ? user.driver!.id : undefined,
      fleetPartnerId: driverOk ? user.driver!.fleetPartnerId : user.fleetPartners[0]?.id,
      mustChangePassword: user.mustChangePassword,
    };
  }
}
