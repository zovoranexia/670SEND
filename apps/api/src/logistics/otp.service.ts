import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AppException } from '../common/errors';
import { SettingsService } from '../common/settings.service';
import { ENV, type Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';

/**
 * 6-digit pickup OTP.
 * A plain hash of a 6-digit number falls to a million-guess offline attack in milliseconds, so the
 * stored value is HMAC-SHA256(OTP_PEPPER, shipmentId:otp): useless without the server-side pepper
 * (and bound to the shipment). Online guessing is capped by attempts + lock-out.
 */
@Injectable()
export class OtpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  generate(): string {
    return String(randomInt(0, 1_000_000)).padStart(6, '0');
  }

  hash(shipmentId: string, otp: string): string {
    return createHmac('sha256', this.env.OTP_PEPPER).update(`${shipmentId}:${otp}`).digest('hex');
  }

  /** New code (re-issuing invalidates the old one and resets the attempt counter). Returns the clear code ONCE. */
  async issue(tx: Prisma.TransactionClient, shipmentId: string, now = new Date()): Promise<string> {
    const policy = await this.settings.otpPolicy();
    const otp = this.generate();
    await tx.shipment.update({
      where: { id: shipmentId },
      data: {
        pickupOtpHash: this.hash(shipmentId, otp),
        pickupOtpExpiresAt: new Date(now.getTime() + policy.ttlDays * 86_400_000),
        pickupOtpAttempts: 0,
        pickupOtpLockedUntil: null,
      },
    });
    return otp;
  }

  /**
   * Check a code in its OWN transaction so a wrong guess is counted even though the caller then
   * aborts. Throws invalid_otp / otp_expired / otp_locked; resolves quietly when correct
   * (the caller clears the code in the delivery transaction).
   */
  async verify(shipmentId: string, otp: string, now = new Date()): Promise<void> {
    const policy = await this.settings.otpPolicy();
    const outcome = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM shipments WHERE id = ${shipmentId}::uuid FOR UPDATE`;
      const s = await tx.shipment.findUniqueOrThrow({
        where: { id: shipmentId },
        select: { pickupOtpHash: true, pickupOtpExpiresAt: true, pickupOtpAttempts: true, pickupOtpLockedUntil: true },
      });
      if (s.pickupOtpLockedUntil && s.pickupOtpLockedUntil > now) return 'locked' as const;
      if (!s.pickupOtpHash || !s.pickupOtpExpiresAt || s.pickupOtpExpiresAt <= now) return 'expired' as const;

      const given = Buffer.from(this.hash(shipmentId, otp), 'hex');
      const stored = Buffer.from(s.pickupOtpHash, 'hex');
      if (given.length === stored.length && timingSafeEqual(given, stored)) {
        if (s.pickupOtpAttempts > 0) await tx.shipment.update({ where: { id: shipmentId }, data: { pickupOtpAttempts: 0 } });
        return 'ok' as const;
      }

      const attempts = s.pickupOtpAttempts + 1;
      const lock = attempts >= policy.maxAttempts;
      await tx.shipment.update({
        where: { id: shipmentId },
        data: {
          pickupOtpAttempts: lock ? 0 : attempts,
          pickupOtpLockedUntil: lock ? new Date(now.getTime() + policy.lockMinutes * 60_000) : null,
        },
      });
      return lock ? ('locked' as const) : ('invalid' as const);
    });

    if (outcome === 'ok') return;
    if (outcome === 'locked') throw new AppException('otp_locked', 423);
    if (outcome === 'expired') throw new AppException('otp_expired', 410);
    throw new AppException('invalid_otp', 422);
  }
}
