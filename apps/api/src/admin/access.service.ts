import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { toPrismaLanguage, type Locale } from '@670send/types';
import { AuditService } from '../audit/audit.service';
import { PasswordService } from '../auth/password.service';
import { TokenService } from '../auth/token.service';
import { AppException, Err } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';
import { ActorService } from '../rbac/actor.service';
import type { Actor } from '../rbac/actor';

/** Roles that belong to field partners — they are provisioned through the partner directory, not as staff. */
export const FIELD_ROLE_KEYS = ['AGENT', 'COURIER', 'FLEET_OWNER', 'DRIVER'] as const;
const isFieldRole = (k: string) => (FIELD_ROLE_KEYS as readonly string[]).includes(k);
const isSuper = (actor: Actor) => actor.permissions.includes('*:*');

export interface CreateStaffInput {
  fullName: string;
  phone: string;
  email: string;
  preferredLang: Locale;
  roles: string[];
  password: string;
}

/**
 * Access administration: dynamic RBAC (roles, permission matrix), staff accounts and their lifecycle.
 * Guard rails: SUPER_ADMIN is locked and is the only holder of `*:*`; only a Super Admin can grant or take away
 * Super Admin; nobody edits their own roles; the last active Super Admin can never be removed; every change is
 * audited with before / after; role changes bite immediately (actor cache flushed).
 */
@Injectable()
export class AccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly actors: ActorService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
  ) {}

  /* ------------------------------------- roles ------------------------------------- */

  async listRoles() {
    const roles = await this.prisma.role.findMany({
      orderBy: [{ isSystem: 'desc' }, { key: 'asc' }],
      include: { permissions: { include: { permission: { select: { key: true } } } }, _count: { select: { userRoles: true } } },
    });
    return roles.map((r) => ({
      id: r.id,
      key: r.key,
      name: r.name,
      description: r.description,
      isSystem: r.isSystem,
      locked: r.key === 'SUPER_ADMIN',
      userCount: r._count.userRoles,
      permissions: r.permissions.map((p) => p.permission.key).sort(),
    }));
  }

  /** Catalog grouped by module, for the permission-matrix editor. */
  async listPermissions() {
    const perms = await this.prisma.permission.findMany({ where: { key: { not: '*:*' } }, orderBy: [{ module: 'asc' }, { action: 'asc' }] });
    const groups = new Map<string, Array<{ key: string; action: string; description: string | null }>>();
    for (const p of perms) {
      if (!groups.has(p.module)) groups.set(p.module, []);
      groups.get(p.module)!.push({ key: p.key, action: p.action, description: p.description });
    }
    return [...groups].map(([module, permissions]) => ({ module, permissions }));
  }

  private async validatePermissionKeys(keys: string[]): Promise<Array<{ id: string; key: string }>> {
    const unique = [...new Set(keys)];
    if (unique.includes('*:*')) throw new AppException('role_locked', 403); // the wildcard belongs to SUPER_ADMIN alone
    const found = await this.prisma.permission.findMany({ where: { key: { in: unique } }, select: { id: true, key: true } });
    if (found.length !== unique.length) {
      const missing = unique.filter((k) => !found.some((f) => f.key === k));
      throw Err.validation(missing.map((m) => ({ path: 'permissions', message: `unknown permission: ${m}` })));
    }
    return found;
  }

  async createRole(actor: Actor, input: { key: string; name: string; description?: string; permissions: string[] }) {
    const perms = await this.validatePermissionKeys(input.permissions);
    if (await this.prisma.role.findUnique({ where: { key: input.key } })) throw new AppException('user_exists', 409);
    const role = await this.prisma.$transaction(async (tx) => {
      const r = await tx.role.create({ data: { key: input.key, name: input.name, description: input.description, isSystem: false } });
      await tx.rolePermission.createMany({ data: perms.map((p) => ({ roleId: r.id, permissionId: p.id })) });
      await this.audit.writeInTx(tx, { action: 'ROLE_CREATED', entityType: 'role', entityId: r.id, after: { key: r.key, permissions: perms.map((p) => p.key).sort() } });
      return r;
    });
    void actor;
    return this.roleDto(role.id);
  }

  private async roleDto(id: string) {
    return (await this.listRoles()).find((r) => r.id === id)!;
  }

  async updateRoleMeta(actor: Actor, id: string, input: { name?: string; description?: string }) {
    const role = await this.prisma.role.findUnique({ where: { id } });
    if (!role) throw Err.notFound();
    if (role.key === 'SUPER_ADMIN') throw new AppException('role_locked', 403);
    await this.prisma.role.update({ where: { id }, data: input });
    await this.audit.write({ action: 'ROLE_UPDATED', entityType: 'role', entityId: id, before: { name: role.name, description: role.description }, after: input, actorId: actor.id });
    return this.roleDto(id);
  }

  /** Replace the whole permission set of a role (atomic). */
  async setRolePermissions(actor: Actor, id: string, keys: string[]) {
    const role = await this.prisma.role.findUnique({ where: { id }, include: { permissions: { include: { permission: { select: { key: true } } } } } });
    if (!role) throw Err.notFound();
    if (role.key === 'SUPER_ADMIN') throw new AppException('role_locked', 403);
    const next = await this.validatePermissionKeys(keys);
    const before = role.permissions.map((p) => p.permission.key).sort();

    await this.prisma.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId: id } });
      await tx.rolePermission.createMany({ data: next.map((p) => ({ roleId: id, permissionId: p.id })) });
      await this.audit.writeInTx(tx, { action: 'ROLE_PERMISSIONS_CHANGED', entityType: 'role', entityId: id, before: { permissions: before }, after: { permissions: next.map((p) => p.key).sort() } });
    });
    this.actors.invalidate(); // every cached actor may hold the old matrix
    void actor;
    return this.roleDto(id);
  }

  async deleteRole(actor: Actor, id: string) {
    const role = await this.prisma.role.findUnique({ where: { id }, include: { _count: { select: { userRoles: true } } } });
    if (!role) throw Err.notFound();
    if (role.isSystem) throw new AppException('role_locked', 403);
    if (role._count.userRoles > 0) throw new AppException('role_in_use', 409);
    await this.prisma.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId: id } });
      await tx.role.delete({ where: { id } });
      await this.audit.writeInTx(tx, { action: 'ROLE_DELETED', entityType: 'role', entityId: id, before: { key: role.key } });
    });
    this.actors.invalidate();
    void actor;
  }

  /* ------------------------------------- users ------------------------------------- */

  private async userDto(id: string) {
    const u = await this.prisma.user.findUniqueOrThrow({
      where: { id },
      include: { userRoles: { include: { role: { select: { key: true } } } }, agent: { select: { id: true } }, courier: { select: { id: true } }, driver: { select: { id: true } } },
    });
    return {
      id: u.id,
      fullName: u.fullName,
      email: u.email,
      phone: u.phone,
      lang: u.preferredLang.toLowerCase() as Locale,
      isActive: u.isActive,
      mustChangePassword: u.mustChangePassword,
      locked: !!u.lockedUntil && u.lockedUntil > new Date(),
      lastLoginAt: u.lastLoginAt,
      roles: u.userRoles.map((r) => r.role.key).sort(),
      profile: u.agent ? 'AGENT' : u.courier ? 'COURIER' : u.driver ? 'DRIVER' : null,
      createdAt: u.createdAt,
    };
  }

  async listUsers(q: { q?: string; role?: string; active?: boolean; limit: number; before?: string }) {
    const rows = await this.prisma.user.findMany({
      where: {
        deletedAt: null,
        phone: { not: '+67000000000' }, // technical system user stays out of the directory
        ...(q.active === undefined ? {} : { isActive: q.active }),
        ...(q.role ? { userRoles: { some: { role: { key: q.role } } } } : {}),
        ...(q.before ? { createdAt: { lt: new Date(q.before) } } : {}),
        ...(q.q ? { OR: [{ fullName: { contains: q.q, mode: 'insensitive' } }, { email: { contains: q.q.toLowerCase() } }, { phone: { contains: q.q } }] } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit,
      select: { id: true },
    });
    return Promise.all(rows.map((r) => this.userDto(r.id)));
  }

  async getUser(id: string) {
    const u = await this.prisma.user.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
    if (!u) throw Err.notFound();
    return this.userDto(id);
  }

  private async assertRolesAssignable(actor: Actor, roleKeys: string[]) {
    const roles = await this.prisma.role.findMany({ where: { key: { in: roleKeys } }, select: { id: true, key: true } });
    if (roles.length !== new Set(roleKeys).size) throw Err.validation([{ path: 'roles', message: 'errors.validation_failed' }]);
    if (roleKeys.some(isFieldRole)) throw Err.validation([{ path: 'roles', message: 'errors.validation_failed' }]); // via partner directory
    if (roleKeys.includes('SUPER_ADMIN') && !isSuper(actor)) throw Err.forbidden();
    return roles;
  }

  /** Staff account (backoffice roles). Field partners are created through the partner directory. */
  async createStaff(actor: Actor, input: CreateStaffInput) {
    const roles = await this.assertRolesAssignable(actor, input.roles);
    const exists = await this.prisma.user.findFirst({ where: { OR: [{ email: input.email.toLowerCase() }, { phone: input.phone }] }, select: { id: true } });
    if (exists) throw new AppException('user_exists', 409);

    const user = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: {
          fullName: input.fullName,
          email: input.email.toLowerCase(),
          phone: input.phone,
          preferredLang: toPrismaLanguage(input.preferredLang),
          passwordHash: await this.passwords.hash(input.password),
          mustChangePassword: true, // the admin knows the first password; the owner must replace it
          userRoles: { create: roles.map((r) => ({ roleId: r.id, assignedBy: actor.id })) },
        },
      });
      await this.audit.writeInTx(tx, { action: 'USER_CREATED', entityType: 'user', entityId: u.id, after: { email: u.email, roles: input.roles } });
      return u;
    });
    return this.userDto(user.id);
  }

  async updateUser(actor: Actor, id: string, input: { fullName?: string; preferredLang?: Locale }) {
    const u = await this.prisma.user.findFirst({ where: { id, deletedAt: null } });
    if (!u) throw Err.notFound();
    await this.prisma.user.update({
      where: { id },
      data: { ...(input.fullName ? { fullName: input.fullName } : {}), ...(input.preferredLang ? { preferredLang: toPrismaLanguage(input.preferredLang) } : {}) },
    });
    this.actors.invalidate(id);
    await this.audit.write({ action: 'USER_UPDATED', entityType: 'user', entityId: id, before: { fullName: u.fullName }, after: input, actorId: actor.id });
    return this.userDto(id);
  }

  private async activeSuperAdminsExcept(userId: string): Promise<number> {
    return this.prisma.user.count({ where: { id: { not: userId }, isActive: true, deletedAt: null, userRoles: { some: { role: { key: 'SUPER_ADMIN' } } } } });
  }

  async setUserRoles(actor: Actor, id: string, roleKeys: string[]) {
    if (id === actor.id) throw Err.forbidden(); // no self-escalation, no self-demotion
    const u = await this.prisma.user.findFirst({ where: { id, deletedAt: null }, include: { userRoles: { include: { role: { select: { key: true } } } } } });
    if (!u) throw Err.notFound();
    const roles = await this.assertRolesAssignable(actor, roleKeys);
    const before = u.userRoles.map((r) => r.role.key).sort();
    if (before.some(isFieldRole)) throw Err.validation([{ path: 'roles', message: 'errors.validation_failed' }]); // partner roles are managed in the directory

    const hadSuper = before.includes('SUPER_ADMIN');
    const willHaveSuper = roleKeys.includes('SUPER_ADMIN');
    if (hadSuper !== willHaveSuper && !isSuper(actor)) throw Err.forbidden();
    if (hadSuper && !willHaveSuper && u.isActive && (await this.activeSuperAdminsExcept(id)) === 0) throw new AppException('last_super_admin', 409);

    await this.prisma.$transaction(async (tx) => {
      await tx.userRole.deleteMany({ where: { userId: id } });
      await tx.userRole.createMany({ data: roles.map((r) => ({ userId: id, roleId: r.id, assignedBy: actor.id })) });
      await this.audit.writeInTx(tx, { action: 'USER_ROLES_CHANGED', entityType: 'user', entityId: id, before: { roles: before }, after: { roles: [...roleKeys].sort() } });
    });
    this.actors.invalidate(id);
    return this.userDto(id);
  }

  async setActive(actor: Actor, id: string, active: boolean, reason?: string) {
    if (id === actor.id) throw Err.forbidden();
    const u = await this.prisma.user.findFirst({ where: { id, deletedAt: null }, include: { userRoles: { include: { role: { select: { key: true } } } } } });
    if (!u) throw Err.notFound();
    if (!active && u.userRoles.some((r) => r.role.key === 'SUPER_ADMIN') && (await this.activeSuperAdminsExcept(id)) === 0) throw new AppException('last_super_admin', 409);
    await this.prisma.user.update({ where: { id }, data: { isActive: active } });
    if (!active) await this.tokens.revokeAllForUser(id); // kill every session right away
    this.actors.invalidate(id);
    await this.audit.write({ action: active ? 'USER_ACTIVATED' : 'USER_DEACTIVATED', entityType: 'user', entityId: id, after: { reason }, actorId: actor.id });
    return this.userDto(id);
  }

  /** Admin sets a new password and/or PIN (they hand it over); sessions end, lock is cleared, password change is forced. */
  async resetCredentials(actor: Actor, id: string, input: { password?: string; pin?: string }) {
    const u = await this.prisma.user.findFirst({ where: { id, deletedAt: null } });
    if (!u) throw Err.notFound();
    await this.prisma.user.update({
      where: { id },
      data: {
        ...(input.password ? { passwordHash: await this.passwords.hash(input.password), mustChangePassword: true } : {}),
        ...(input.pin ? { pinHash: await this.passwords.hash(input.pin) } : {}),
        failedLoginCount: 0,
        failedPinCount: 0,
        lockedUntil: null,
      },
    });
    await this.tokens.revokeAllForUser(id);
    this.actors.invalidate(id);
    await this.audit.write({ action: 'USER_CREDENTIALS_RESET', entityType: 'user', entityId: id, after: { password: Boolean(input.password), pin: Boolean(input.pin) }, actorId: actor.id });
    return this.userDto(id);
  }

  async unlock(actor: Actor, id: string) {
    const u = await this.prisma.user.findFirst({ where: { id, deletedAt: null } });
    if (!u) throw Err.notFound();
    await this.prisma.user.update({ where: { id }, data: { lockedUntil: null, failedLoginCount: 0, failedPinCount: 0 } });
    await this.audit.write({ action: 'USER_UNLOCKED', entityType: 'user', entityId: id, actorId: actor.id });
    return this.userDto(id);
  }

  /** Immutable audit trail viewer with filters. */
  async auditLogs(q: { entityType?: string; entityId?: string; actorId?: string; action?: string; from?: string; to?: string; limit: number; before?: string }) {
    const rows = await this.prisma.auditLog.findMany({
      where: {
        ...(q.entityType ? { entityType: q.entityType } : {}),
        ...(q.entityId ? { entityId: q.entityId } : {}),
        ...(q.actorId ? { actorId: q.actorId } : {}),
        ...(q.action ? { action: q.action } : {}),
        ...(q.from || q.to || q.before ? { createdAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lt: new Date(q.to) } : {}), ...(q.before ? { lt: new Date(q.before) } : {}) } } : {}),
      },
      orderBy: { id: 'desc' },
      take: q.limit,
      include: { actor: { select: { fullName: true } } },
    });
    return rows.map((r) => ({
      id: r.id.toString(),
      at: r.createdAt,
      actor: r.actor?.fullName ?? null,
      actorRoles: r.actorRoles,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      before: r.before,
      after: r.after,
      reason: r.reason,
      ip: r.ip,
      requestId: r.requestId,
    }));
  }
}

export type { Prisma };
