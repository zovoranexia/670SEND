import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ActorService } from '../rbac/actor.service';
import { ENV, type Env } from '../config/env';
import { Err } from '../common/errors';

export const JWT_ISSUER = '670send-api';
export const JWT_AUDIENCE = '670send-clients';
/** A second refresh using a token that was rotated < 10 s ago is a double-click / two tabs, not theft. */
const REUSE_GRACE_MS = 10_000;

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
}

export interface AccessClaims {
  sub: string;
  sid: string;
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly actors: ActorService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Keyed hash: a leaked refresh_tokens table is useless without JWT_REFRESH_SECRET. */
  private hashRefresh(token: string): string {
    return createHmac('sha256', this.env.JWT_REFRESH_SECRET).update(token).digest('hex');
  }

  private signAccess(userId: string, familyId: string): Promise<string> {
    return this.jwt.signAsync(
      { sub: userId, sid: familyId },
      {
        secret: this.env.JWT_ACCESS_SECRET,
        expiresIn: this.env.jwtAccessTtlSeconds,
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
        algorithm: 'HS256',
      },
    );
  }

  async verifyAccess(token: string): Promise<AccessClaims> {
    return this.jwt.verifyAsync<AccessClaims>(token, {
      secret: this.env.JWT_ACCESS_SECRET,
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      algorithms: ['HS256'],
    });
  }

  private async mintRefresh(
    userId: string,
    familyId: string,
    meta: { ip?: string; userAgent?: string },
  ): Promise<{ raw: string; id: string }> {
    const raw = randomBytes(48).toString('base64url');
    const row = await this.prisma.refreshToken.create({
      data: {
        userId,
        familyId,
        tokenHash: this.hashRefresh(raw),
        expiresAt: new Date(Date.now() + this.env.jwtRefreshTtlSeconds * 1000),
        ip: meta.ip,
        userAgent: meta.userAgent,
      },
      select: { id: true },
    });
    return { raw, id: row.id };
  }

  /** New session (login). */
  async issue(userId: string, meta: { ip?: string; userAgent?: string } = {}): Promise<TokenPair> {
    const familyId = randomUUID();
    const [accessToken, refresh] = await Promise.all([
      this.signAccess(userId, familyId),
      this.mintRefresh(userId, familyId, meta),
    ]);
    return {
      accessToken,
      refreshToken: refresh.raw,
      tokenType: 'Bearer',
      expiresIn: this.env.jwtAccessTtlSeconds,
    };
  }

  /**
   * Rotate a refresh token. Reuse of an already-rotated token (outside the grace window) is treated
   * as theft: the whole session family is revoked and the event is audited.
   */
  async rotate(
    rawToken: string,
    meta: { ip?: string; userAgent?: string } = {},
  ): Promise<{ userId: string; tokens: TokenPair }> {
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash: this.hashRefresh(rawToken) } });
    if (!row) throw Err.refreshInvalid();

    if (row.revokedAt) {
      const withinGrace = Date.now() - row.revokedAt.getTime() < REUSE_GRACE_MS && row.replacedById !== null;
      if (!withinGrace) {
        await this.revokeFamily(row.familyId);
        await this.audit.write({
          actorId: row.userId,
          action: 'AUTH_REFRESH_REUSE_DETECTED',
          entityType: 'user',
          entityId: row.userId,
          after: { familyId: row.familyId },
        });
      }
      throw Err.refreshInvalid();
    }
    if (row.expiresAt.getTime() <= Date.now()) throw Err.refreshInvalid();

    const actor = await this.actors.load(row.userId);
    if (!actor) {
      await this.revokeFamily(row.familyId);
      throw Err.refreshInvalid();
    }

    // Claim the token atomically; if another request won the race, this one is a replay.
    const claimed = await this.prisma.refreshToken.updateMany({
      where: { id: row.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (claimed.count === 0) throw Err.refreshInvalid();

    const next = await this.mintRefresh(row.userId, row.familyId, meta);
    await this.prisma.refreshToken.update({ where: { id: row.id }, data: { replacedById: next.id } });

    return {
      userId: row.userId,
      tokens: {
        accessToken: await this.signAccess(row.userId, row.familyId),
        refreshToken: next.raw,
        tokenType: 'Bearer',
        expiresIn: this.env.jwtAccessTtlSeconds,
      },
    };
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeByToken(rawToken: string): Promise<string | null> {
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash: this.hashRefresh(rawToken) } });
    if (!row) return null;
    await this.revokeFamily(row.familyId);
    return row.userId;
  }

  /** Password / PIN change, deactivation: kill every session of the user. */
  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }
}
