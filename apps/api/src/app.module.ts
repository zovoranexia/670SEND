import { MiddlewareConsumer, Module, NestModule, RequestMethod, type ExecutionContext } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { CryptoModule } from './common/field-crypto';
import { SettingsModule } from './common/settings.service';
import { AdminModule } from './admin/admin.module';
import { LogisticsModule } from './logistics/logistics.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AuditInterceptor } from './audit/audit.interceptor';
import { AuditModule } from './audit/audit.module';
import { AUTH_THROTTLE } from './auth/auth.controller';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { RequestContextMiddleware } from './common/request-context';
import { ConfigModule } from './config/config.module';
import { ENV, type Env } from './config/env';
import { HealthController } from './health/health.controller';
import { AppI18nModule } from './i18n/i18n.module';
import { IdempotencyInterceptor } from './idempotency/idempotency.interceptor';
import { IdempotencyModule } from './idempotency/idempotency.module';
import { LedgerModule } from './ledger/ledger.module';
import { PrismaModule } from './prisma/prisma.service';
import { PermissionsGuard } from './rbac/permissions.guard';
import { RbacModule } from './rbac/rbac.module';
import { StorageModule } from './storage/storage.module';

const isAuthRoute = (ctx: ExecutionContext): boolean =>
  Reflect.getMetadata(AUTH_THROTTLE, ctx.getHandler()) === true;

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    AppI18nModule,
    AuditModule,
    RbacModule,
    AuthModule,
    IdempotencyModule,
    LedgerModule,
    StorageModule,
    SettingsModule,
    CryptoModule,
    NotificationsModule,
    LogisticsModule,
    AdminModule,
    // Two per-IP buckets: the general API limit, and a much stricter one for login / refresh /
    // credential changes (brute-force protection on top of the per-account lockout).
    ThrottlerModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        throttlers: [
          { name: 'default', ttl: 60_000, limit: env.RATE_LIMIT_PUBLIC_PER_MIN, skipIf: isAuthRoute },
          { name: 'auth', ttl: 60_000, limit: env.RATE_LIMIT_AUTH_PER_MIN, skipIf: (ctx) => !isAuthRoute(ctx) },
        ],
      }),
    }),
  ],
  controllers: [HealthController],
  providers: [
    // Guard order matters: throttle → authenticate → authorize.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    // Interceptor order matters: idempotency is the OUTER layer so a replayed response never re-runs audit.
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes({ path: '{*path}', method: RequestMethod.ALL });
  }
}
