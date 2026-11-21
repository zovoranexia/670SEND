import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import type { PermissionKey } from '@670send/types';
import type { Actor } from '../rbac/actor';

export const IS_PUBLIC = 'isPublic';
export const IS_AUTHENTICATED_ONLY = 'isAuthenticatedOnly';
export const PERMISSIONS = 'requiredPermissions';
export const AUDIT = 'auditMeta';
export const AUDIT_REASON_REQUIRED = 'auditReasonRequired';
export const IDEMPOTENT = 'idempotent';

/** No authentication at all (login, health, public tracker). Use sparingly. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Any signed-in user (e.g. /auth/me). Without this or @RequirePermissions a route is DENIED. */
export const Authenticated = () => SetMetadata(IS_AUTHENTICATED_ONLY, true);

export interface PermissionRequirement {
  mode: 'all' | 'any';
  permissions: PermissionKey[];
}

/** Actor must hold ALL listed permissions. */
export const RequirePermissions = (...permissions: PermissionKey[]) =>
  SetMetadata<string, PermissionRequirement>(PERMISSIONS, { mode: 'all', permissions });

/** Actor must hold AT LEAST ONE of the listed permissions. */
export const RequireAnyPermission = (...permissions: PermissionKey[]) =>
  SetMetadata<string, PermissionRequirement>(PERMISSIONS, { mode: 'any', permissions });

export interface AuditMeta {
  action: string;
  entityType: string;
}

/** Persist an immutable audit_logs row after the handler succeeds. */
export const Audit = (action: string, entityType: string) =>
  SetMetadata<string, AuditMeta>(AUDIT, { action, entityType });

/** Force-override style actions: a non-empty reason (header X-Audit-Reason or body.reason) is mandatory. */
export const AuditReasonRequired = () => SetMetadata(AUDIT_REASON_REQUIRED, true);

export interface IdempotentOptions {
  /** Missing Idempotency-Key → 400. Default true. */
  required?: boolean;
}

/** Enforce replay-safe execution for financial / intake endpoints (Idempotency-Key header). */
export const Idempotent = (options: IdempotentOptions = {}) =>
  SetMetadata<string, IdempotentOptions>(IDEMPOTENT, { required: options.required ?? true });

export type AuthedRequest = Request & { actor?: Actor };

export const CurrentActor = createParamDecorator((_data: unknown, ctx: ExecutionContext): Actor => {
  const req = ctx.switchToHttp().getRequest<AuthedRequest>();
  if (!req.actor) throw new Error('CurrentActor used on a route that is not authenticated');
  return req.actor;
});
