import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import argon2 from 'argon2';
import { ENV, type Env } from '../config/env';

/** Argon2id hashing for passwords and 6-digit PINs, with timing-equalisation for unknown users. */
@Injectable()
export class PasswordService implements OnModuleInit {
  private dummyHash = '';

  constructor(@Inject(ENV) private readonly env: Env) {}

  private options() {
    return {
      type: argon2.argon2id,
      memoryCost: this.env.ARGON2_MEMORY_KIB,
      timeCost: this.env.ARGON2_TIME_COST,
      parallelism: this.env.ARGON2_PARALLELISM,
    } as const;
  }

  async onModuleInit(): Promise<void> {
    // Verified against when the account does not exist, so "unknown user" and "wrong password"
    // take the same time and cannot be told apart.
    this.dummyHash = await this.hash('timing-equaliser-not-a-real-credential');
  }

  hash(plain: string): Promise<string> {
    return argon2.hash(plain, this.options());
  }

  async verify(hash: string | null | undefined, plain: string): Promise<boolean> {
    try {
      const ok = await argon2.verify(hash ?? this.dummyHash, plain);
      return hash ? ok : false;
    } catch {
      return false;
    }
  }

  /** Re-hash on login when cost parameters were raised since the hash was created. */
  needsRehash(hash: string): boolean {
    return argon2.needsRehash(hash, this.options());
  }
}
