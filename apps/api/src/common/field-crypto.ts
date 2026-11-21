import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { Global, Inject, Injectable, Module } from '@nestjs/common';
import { ENV, type Env } from '../config/env';

/**
 * AES-256-GCM for sensitive fields and queue payloads (pickup OTPs must not sit in Redis in clear
 * text; bank details must not sit in the DB in clear text). Format: base64url(iv ‖ tag ‖ ciphertext).
 */
@Injectable()
export class FieldCrypto {
  private readonly key: Buffer;

  constructor(@Inject(ENV) env: Env) {
    // Any string ≥ 16 chars is accepted and stretched to a 32-byte key.
    this.key = createHash('sha256').update(`670send-field-key:${env.FIELD_ENCRYPTION_KEY}`).digest();
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64url');
  }

  decrypt(payload: string): string {
    const raw = Buffer.from(payload, 'base64url');
    if (raw.length < 29) throw new Error('Invalid encrypted payload');
    const decipher = createDecipheriv('aes-256-gcm', this.key, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
  }
}

@Global()
@Module({ providers: [FieldCrypto], exports: [FieldCrypto] })
export class CryptoModule {}
