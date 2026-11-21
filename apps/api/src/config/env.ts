import { z } from 'zod';

/** "15m" | "14d" | "3600s" | "2h" → seconds. */
export function parseDurationSeconds(input: string): number {
  const m = /^(\d+)\s*(s|m|h|d)$/.exec(input.trim());
  if (!m) throw new Error(`Invalid duration "${input}" (use e.g. 15m, 14d)`);
  const n = Number(m[1]);
  return n * { s: 1, m: 60, h: 3600, d: 86400 }[m[2] as 's' | 'm' | 'h' | 'd'];
}

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const duration = z.string().refine((v) => /^\d+\s*(s|m|h|d)$/.test(v), 'use e.g. 15m, 14d');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  LOG_LEVEL: z
    .enum(['error', 'warn', 'info', 'log', 'debug', 'verbose'])
    .default('log')
    .transform((v) => (v === 'info' ? ('log' as const) : v)),

  DATABASE_URL: z.string().min(10),
  CORS_ORIGINS: z.string().default(''),

  DEFAULT_LOCALE: z.enum(['tet', 'pt', 'en', 'id']).default('tet'),

  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: duration.default('15m'),
  JWT_REFRESH_TTL: duration.default('14d'),
  OTP_PEPPER: z.string().min(32),
  FIELD_ENCRYPTION_KEY: z.string().min(16),

  ARGON2_MEMORY_KIB: z.coerce.number().int().min(8192).default(65536),
  ARGON2_TIME_COST: z.coerce.number().int().min(2).default(3),
  ARGON2_PARALLELISM: z.coerce.number().int().min(1).default(1),

  AUTH_MAX_FAILED_ATTEMPTS: z.coerce.number().int().min(3).default(5),
  AUTH_LOCK_MINUTES: z.coerce.number().int().min(1).default(15),

  RATE_LIMIT_PUBLIC_PER_MIN: z.coerce.number().int().min(1).default(60),
  RATE_LIMIT_AUTH_PER_MIN: z.coerce.number().int().min(1).default(10),

  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default('auto'),
  S3_BUCKET: z.string().min(3),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: bool.default(false),
  S3_SIGNED_URL_TTL_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),
  S3_AUTO_CREATE_BUCKET: bool.default(false),
  UPLOAD_MAX_BYTES: z.coerce.number().int().min(10_000).max(10_000_000).default(2_097_152),

  // --- Phase 3: queues + WhatsApp -------------------------------------------------------------
  /** false in tests: jobs run inline instead of through Redis / BullMQ. */
  QUEUES_ENABLED: bool.default(true),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  WHATSAPP_PROVIDER: z.enum(['console', 'meta', 'fonnte', 'waha']).default('console'),
  META_WA_PHONE_NUMBER_ID: z.string().optional(),
  META_WA_ACCESS_TOKEN: z.string().optional(),
  META_WA_API_VERSION: z.string().default('v22.0'),
  FONNTE_TOKEN: z.string().optional(),
  WAHA_BASE_URL: z.string().url().optional(),
  WAHA_API_KEY: z.string().optional(),
  WAHA_SESSION: z.string().default('default'),
  /** Public website, used in tracking links inside WhatsApp messages. */
  WEB_URL: z.string().url().default('https://670send.tl'),
  /** Optional WhatsApp number that receives ops alerts (e.g. a parcel flagged return-to-sender). */
  OPS_ALERT_PHONE: z.string().optional(),
});

export type Env = z.infer<typeof schema> & {
  jwtAccessTtlSeconds: number;
  jwtRefreshTtlSeconds: number;
  corsOrigins: string[];
  isProd: boolean;
};

export const ENV = Symbol('ENV');

const SECRET_KEYS = ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'OTP_PEPPER', 'FIELD_ENCRYPTION_KEY'] as const;

/** Validate process.env once at boot. Fails fast with every problem listed. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  const e = parsed.data;
  const isProd = e.NODE_ENV === 'production';

  if (isProd) {
    for (const k of SECRET_KEYS) {
      if (/change_?me|example|secret_min/i.test(e[k])) {
        throw new Error(`Refusing to start in production: ${k} still holds a placeholder value`);
      }
    }
    if (e.JWT_ACCESS_SECRET === e.JWT_REFRESH_SECRET) {
      throw new Error('Refusing to start in production: JWT access and refresh secrets must differ');
    }
    if (e.S3_AUTO_CREATE_BUCKET) {
      throw new Error('Refusing to start in production: S3_AUTO_CREATE_BUCKET must be false');
    }
    if (e.WHATSAPP_PROVIDER === 'console') {
      throw new Error('Refusing to start in production: WHATSAPP_PROVIDER=console only logs messages');
    }
    if (e.WHATSAPP_PROVIDER === 'meta' && (!e.META_WA_PHONE_NUMBER_ID || !e.META_WA_ACCESS_TOKEN)) {
      throw new Error('Refusing to start in production: META_WA_PHONE_NUMBER_ID / META_WA_ACCESS_TOKEN missing');
    }
    if (e.WHATSAPP_PROVIDER === 'fonnte' && !e.FONNTE_TOKEN) {
      throw new Error('Refusing to start in production: FONNTE_TOKEN missing');
    }
    if (e.WHATSAPP_PROVIDER === 'waha' && !e.WAHA_BASE_URL) {
      throw new Error('Refusing to start in production: WAHA_BASE_URL missing');
    }
    if (!e.QUEUES_ENABLED) {
      throw new Error('Refusing to start in production: QUEUES_ENABLED must be true');
    }
    if (!e.CORS_ORIGINS) {
      throw new Error('Refusing to start in production: CORS_ORIGINS must list the exact allowed origins');
    }
  }

  return {
    ...e,
    isProd,
    jwtAccessTtlSeconds: parseDurationSeconds(e.JWT_ACCESS_TTL),
    jwtRefreshTtlSeconds: parseDurationSeconds(e.JWT_REFRESH_TTL),
    corsOrigins: e.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
  };
}
