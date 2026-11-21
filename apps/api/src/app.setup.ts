import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { ENV, type Env } from './config/env';

/** Shared by main.ts and the e2e tests so tests exercise the real HTTP configuration. */
export function configureApp(app: INestApplication): void {
  const env = app.get<Env>(ENV);
  const express = app as NestExpressApplication;

  // Behind Nginx (1 proxy) req.ip must be the client IP, otherwise rate limits hit the proxy.
  express.set('trust proxy', env.TRUST_PROXY);
  express.disable('x-powered-by');

  app.use(helmet());
  app.setGlobalPrefix('v1');
  app.enableCors({
    origin: env.corsOrigins.length > 0 ? env.corsOrigins : !env.isProd,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Accept-Language', 'Idempotency-Key', 'X-Request-Id', 'X-Audit-Reason', 'X-Lang'],
    exposedHeaders: ['X-Request-Id', 'Idempotent-Replayed', 'Retry-After'],
    maxAge: 600,
  });
  app.enableShutdownHooks();
}
