import { Inject, Injectable } from '@nestjs/common';
import type { User } from '@prisma/client';
import { toPrismaLanguage, type Locale } from '@670send/types';
import { normalizeTlPhone } from '@670send/validation';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ActorService } from '../rbac/actor.service';
import type { Actor } from '../rbac/actor';
import { ENV, type Env } from '../config/env';
import { Err } from '../common/errors';
import { PasswordService } from './password.service';
import { TokenService, type TokenPair } from './token.service';

/** Only these roles may sign in with phone + 6-digit PIN. Backoffice roles require email + password. */
const PIN_LOGIN_ROLES = new Set(['AGENT', 'COURIER', 'DRIVER', 'FLEET_OWNER']);

export interface SessionResult extends TokenPair {
  user: PublicUser;
}

export interface PublicUser {
  id: string;
  fullName: string;
  phone: string;
  email: string | null;
  lang: Locale;
  roles: string[];
  permissions: string[];
  scope: { agentId?: string; courierId?: string; driverId?: string; fleetPartnerId?: string };
  mustChangePassword: boolean;
}

export function toPublicUser(a: Actor): PublicUser {
  return {
    id: a.id,
    fullName: a.fullName,
    phone: a.phone,
    email: a.email,
    lang: a.lang,
    roles: a.roles,
    permissions: a.permissions,
    scope: { agentId: a.agentId, courierId: a.courierId, driverId: a.driverId, fleetPartnerId: a.fleetPartnerId },
    mustChangePassword: a.mustChangePassword,
  };
}

interface ClientMeta {
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly actors: ActorService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /* ------------------------------ login ------------------------------ */

  /** Backoffice / fleet-owner login: email + password. */
  async loginWithPassword(email: string, password: string, meta: ClientMeta): Promise<SessionResult> {
    const user = await this.prisma.user.findFirst({
      where: { email: email.trim().toLowerCase(), deletedAt: null },
    });
    return this.finishLogin(user, 'password', await this.checkSecret(user, 'password', password), meta);
  }

  /** Field login: +670 phone + 6-digit PIN (agents, couriers, drivers, fleet owners only). */
  async loginWithPin(phone: string, pin: string, meta: ClientMeta): Promise<SessionResult> {
    const user = await this.prisma.user.findFirst({
      where: { phone: normalizeTlPhone(phone), deletedAt: null },
    });
    return this.finishLogin(user, 'pin', await this.checkSecret(user, 'pin', pin), meta);
  }

  /**
   * Verify a secret without revealing whether the account exists, and enforce lockout.
   * Returns true only for a correct secret on an unlocked account.
   */
  private async checkSecret(user: User | null, kind: 'password' | 'pin', plain: string): Promise<boolean> {
    const hash = user ? (kind === 'password' ? user.passwordHash : user.pinHash) : null;
    const locked = !!user?.lockedUntil && user.lockedUntil.getTime() > Date.now();
    // Always burn one argon2 verification so timing is identical in every branch.
    const ok = await this.passwords.verify(hash, plain);
    if (locked) return false;
    if (ok && user && hash && this.passwords.needsRehash(hash)) {
      const fresh = await this.passwords.hash(plain);
      await this.prisma.user.update({
        where: { id: user.id },
        data: kind === 'password' ? { passwordHash: fresh } : { pinHash: fresh },
      });
    }
    return ok;
  }

  private async finishLogin(
    user: User | null,
    kind: 'password' | 'pin',
    secretOk: boolean,
    meta: ClientMeta,
  ): Promise<SessionResult> {
    if (user?.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      await this.audit.write({ actorId: user.id, action: 'AUTH_LOGIN_BLOCKED_LOCKED', entityType: 'user', entityId: user.id, ip: meta.ip });
      throw Err.accountLocked();
    }

    if (!user || !secretOk) {
      if (user) await this.registerFailure(user, kind, meta);
      else await this.audit.write({ actorId: null, action: 'AUTH_LOGIN_FAILED', entityType: 'user', after: { kind, reason: 'unknown_account' }, ip: meta.ip });
      throw Err.invalidCredentials();
    }

    this.actors.invalidate(user.id);
    const actor = await this.actors.load(user.id);
    if (!actor) throw Err.accountInactive();

    if (kind === 'pin' && !actor.roles.every((r) => PIN_LOGIN_ROLES.has(r))) {
      // Same error as a wrong PIN: do not reveal that this account is a backoffice account.
      await this.audit.write({ actorId: user.id, action: 'AUTH_LOGIN_FAILED', entityType: 'user', entityId: user.id, after: { kind, reason: 'pin_login_not_allowed_for_role' }, ip: meta.ip });
      throw Err.invalidCredentials();
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, failedPinCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    });
    const tokens = await this.tokens.issue(user.id, meta);
    await this.audit.write({ actorId: user.id, actorRoles: actor.roles, action: 'AUTH_LOGIN_SUCCESS', entityType: 'user', entityId: user.id, after: { kind }, ip: meta.ip, userAgent: meta.userAgent });
    return { ...tokens, user: toPublicUser(actor) };
  }

  private async registerFailure(user: User, kind: 'password' | 'pin', meta: ClientMeta): Promise<void> {
    const field = kind === 'password' ? 'failedLoginCount' : 'failedPinCount';
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { [field]: { increment: 1 } },
      select: { failedLoginCount: true, failedPinCount: true },
    });
    const count = kind === 'password' ? updated.failedLoginCount : updated.failedPinCount;
    const lock = count >= this.env.AUTH_MAX_FAILED_ATTEMPTS;
    if (lock) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { lockedUntil: new Date(Date.now() + this.env.AUTH_LOCK_MINUTES * 60_000), failedLoginCount: 0, failedPinCount: 0 },
      });
    }
    await this.audit.write({
      actorId: user.id,
      action: lock ? 'AUTH_ACCOUNT_LOCKED' : 'AUTH_LOGIN_FAILED',
      entityType: 'user',
      entityId: user.id,
      after: { kind, attempts: count },
      ip: meta.ip,
    });
  }

  /* ----------------------------- sessions ---------------------------- */

  async refresh(rawToken: string, meta: ClientMeta): Promise<SessionResult> {
    const { userId, tokens } = await this.tokens.rotate(rawToken, meta);
    const actor = await this.actors.load(userId);
    if (!actor) throw Err.refreshInvalid();
    return { ...tokens, user: toPublicUser(actor) };
  }

  async logout(actor: Actor, rawRefreshToken?: string): Promise<void> {
    if (rawRefreshToken) await this.tokens.revokeByToken(rawRefreshToken);
    await this.audit.write({ actorId: actor.id, actorRoles: actor.roles, action: 'AUTH_LOGOUT', entityType: 'user', entityId: actor.id });
  }

  async setLanguage(actor: Actor, lang: Locale): Promise<PublicUser> {
    await this.prisma.user.update({ where: { id: actor.id }, data: { preferredLang: toPrismaLanguage(lang) } });
    this.actors.invalidate(actor.id);
    const fresh = await this.actors.load(actor.id);
    return toPublicUser(fresh ?? actor);
  }

  /* ------------------------ credential changes ----------------------- */

  async changePassword(actor: Actor, currentPassword: string, newPassword: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: actor.id } });
    if (!(await this.passwords.verify(user.passwordHash, currentPassword))) throw Err.invalidCredentials();
    await this.prisma.user.update({
      where: { id: actor.id },
      data: { passwordHash: await this.passwords.hash(newPassword), mustChangePassword: false },
    });
    await this.tokens.revokeAllForUser(actor.id);
    this.actors.invalidate(actor.id);
    await this.audit.write({ actorId: actor.id, actorRoles: actor.roles, action: 'AUTH_PASSWORD_CHANGED', entityType: 'user', entityId: actor.id });
  }

  async changePin(actor: Actor, currentPin: string | undefined, newPin: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: actor.id } });
    if (user.pinHash) {
      if (!currentPin) throw Err.invalidPin();
      await this.verifyTransactionPin(actor.id, currentPin);
    }
    await this.prisma.user.update({ where: { id: actor.id }, data: { pinHash: await this.passwords.hash(newPin) } });
    await this.tokens.revokeAllForUser(actor.id);
    await this.audit.write({ actorId: actor.id, actorRoles: actor.roles, action: 'AUTH_PIN_CHANGED', entityType: 'user', entityId: actor.id });
  }

  /**
   * Re-confirm the acting user's 6-digit PIN (drop-off confirmation step 5, cash handovers…).
   * Shares the lockout counter, so a stolen unlocked phone cannot brute-force the PIN.
   */
  async verifyTransactionPin(userId: string, pin: string): Promise<void> {
    const user = await this.prisma.user.findFirst({ where: { id: userId, deletedAt: null, isActive: true } });
    if (!user) throw Err.unauthorized();
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) throw Err.accountLocked();

    const ok = await this.passwords.verify(user.pinHash, pin);
    if (!ok) {
      await this.registerFailure(user, 'pin', {});
      throw Err.invalidPin();
    }
    if (user.failedPinCount > 0) {
      await this.prisma.user.update({ where: { id: user.id }, data: { failedPinCount: 0 } });
    }
  }
}
