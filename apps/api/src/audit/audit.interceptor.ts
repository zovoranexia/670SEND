import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AUDIT, AUDIT_REASON_REQUIRED, type AuditMeta } from '../common/decorators';
import { Err } from '../common/errors';
import { RequestContext } from '../common/request-context';
import { AuditService } from './audit.service';

/**
 * Global interceptor. For routes decorated with @Audit(action, entityType) it writes an immutable
 * audit_logs row after the handler succeeds. Handlers/services enrich it through
 * RequestContext.audit({ entityId, before, after }). @AuditReasonRequired() routes (force-overrides)
 * are rejected up-front unless a reason is supplied.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const targets = [context.getHandler(), context.getClass()];
    const meta = this.reflector.getAllAndOverride<AuditMeta | undefined>(AUDIT, targets);
    const reasonRequired = this.reflector.getAllAndOverride<boolean | undefined>(AUDIT_REASON_REQUIRED, targets);
    if (!meta && !reasonRequired) return next.handle();

    const req = context.switchToHttp().getRequest<Request>();

    if (reasonRequired) {
      const fromHeader = req.header('x-audit-reason');
      const fromBody = (req.body as { reason?: unknown } | undefined)?.reason;
      const reason = (typeof fromHeader === 'string' ? fromHeader : typeof fromBody === 'string' ? fromBody : '').trim();
      if (reason.length < 5) throw Err.auditReasonRequired();
      RequestContext.audit({ reason: reason.slice(0, 500) });
    }

    if (!meta) return next.handle();

    return next.handle().pipe(
      tap((result) => {
        const scratch = RequestContext.current()?.audit ?? {};
        const body = (result ?? {}) as { id?: unknown };
        const entityId =
          scratch.entityId ??
          (typeof body.id === 'string' ? body.id : undefined) ??
          (typeof req.params?.['id'] === 'string' ? req.params['id'] : undefined);

        void this.audit.write({
          action: meta.action,
          entityType: meta.entityType,
          entityId,
          before: scratch.before,
          after: scratch.after ?? req.body,
          reason: scratch.reason,
        });
      }),
    );
  }
}
