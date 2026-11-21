import { Global, Injectable, Module } from '@nestjs/common';
import { BUS_CAPACITY_DEFAULTS, INSURANCE, STORAGE_POLICY, UNINSURED_LIABILITY } from '@670send/pricing';
import { PrismaService } from '../prisma/prisma.service';

const TTL_MS = 30_000;

/** Typed access to `system_settings` with safe built-in defaults and a short cache. */
@Injectable()
export class SettingsService {
  private cache = new Map<string, { value: unknown; expires: number }>();

  constructor(private readonly prisma: PrismaService) {}

  invalidate(): void {
    this.cache.clear();
  }

  async get<T>(key: string, fallback: T): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && hit.expires > Date.now()) return hit.value as T;
    const row = await this.prisma.systemSetting.findUnique({ where: { key } });
    const value = (row?.value ?? fallback) as T;
    this.cache.set(key, { value, expires: Date.now() + TTL_MS });
    return value;
  }

  busCapacity() {
    return this.get('bus_capacity', { ...BUS_CAPACITY_DEFAULTS });
  }

  storagePolicy() {
    return this.get('storage_policy', { ...STORAGE_POLICY, reminderDays: [...STORAGE_POLICY.reminderDays] });
  }

  insurance() {
    return this.get('insurance', { ...INSURANCE });
  }

  uninsuredLiability() {
    return this.get('uninsured_liability', { ...UNINSURED_LIABILITY });
  }

  otpPolicy() {
    return this.get('otp', { length: 6, ttlDays: 15, maxAttempts: 5, lockMinutes: 15 });
  }

  /** Where the destination agent's 15 % lands: COMMISSION (default) or DEPOSIT. */
  destCommissionWallet(): Promise<'COMMISSION' | 'DEPOSIT'> {
    return this.get<'COMMISSION' | 'DEPOSIT'>('dest_commission_wallet', 'COMMISSION');
  }
}

@Global()
@Module({ providers: [SettingsService], exports: [SettingsService] })
export class SettingsModule {}
