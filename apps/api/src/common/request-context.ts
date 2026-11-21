import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { isLocale, type Locale } from '@670send/types';
import type { Actor } from '../rbac/actor';

export interface AuditScratch {
  entityId?: string;
  before?: unknown;
  after?: unknown;
  reason?: string;
}

export interface RequestStore {
  requestId: string;
  ip?: string;
  userAgent?: string;
  /** Set by JwtAuthGuard once the bearer token is verified. */
  actor?: Actor;
  /** Locale resolved for this request (user preference → Accept-Language → Tetun). */
  locale?: Locale;
  /** Services can drop context here for the AuditInterceptor to persist (before/after, reason). */
  audit: AuditScratch;
}

const als = new AsyncLocalStorage<RequestStore>();

/** Ambient per-request data without threading `req` through every service call. */
export const RequestContext = {
  run<T>(store: RequestStore, fn: () => T): T {
    return als.run(store, fn);
  },
  current(): RequestStore | undefined {
    return als.getStore();
  },
  actor(): Actor | undefined {
    return als.getStore()?.actor;
  },
  /** Attach before/after/entity info for the audit interceptor. */
  audit(patch: AuditScratch): void {
    const s = als.getStore();
    if (s) Object.assign(s.audit, patch);
  },
};

const REQUEST_ID_RE = /^[A-Za-z0-9._-]{8,64}$/;

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.header('x-request-id');
    const requestId = incoming && REQUEST_ID_RE.test(incoming) ? incoming : randomUUID();
    res.setHeader('x-request-id', requestId);
    // Explicit language chosen in the app's language switcher (applies instantly, before the
    // profile sync): X-Lang beats the stored preference, which beats Accept-Language.
    const xLang = req.header('x-lang')?.trim().toLowerCase();
    RequestContext.run(
      {
        requestId,
        ip: req.ip,
        userAgent: req.header('user-agent')?.slice(0, 300),
        locale: xLang && isLocale(xLang) ? xLang : undefined,
        audit: {},
      },
      next,
    );
  }
}
