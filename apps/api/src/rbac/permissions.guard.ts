import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { hasPermission } from '@670send/types';
import { AuditService } from '../audit/audit.service';
import {
  IS_AUTHENTICATED_ONLY,
  IS_PUBLIC,
  PERMISSIONS,
  type AuthedRequest,
  type PermissionRequirement,
} from '../common/decorators';
import { AppException, Err } from '../common/errors';

/**
 * Authorization guard (runs after JwtAuthGuard). DENY BY DEFAULT: an authenticated route must
 * declare either @Authenticated() or @RequirePermissions()/@RequireAnyPermission(); a forgotten
 * decorator results in 403, never in an accidentally open endpoint.
 *
 * Permission matching honours `*:*` and `module:*` wildcards (shared logic in @670send/types).
 * Ownership (`_own`) is enforced separately in services via rbac/scope.ts.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  private readonly log = new Logger('Authz');

  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = context.switchToHttp().getRequest<AuthedRequest & Request>();
    const actor = req.actor;
    if (!actor) throw Err.unauthorized(); // JwtAuthGuard should have set it

    const authenticatedOnly = this.reflector.getAllAndOverride<boolean>(IS_AUTHENTICATED_ONLY, targets);
    if (authenticatedOnly) return true;

    // A freshly provisioned account must set its own password before touching anything else.
    if (actor.mustChangePassword) throw new AppException('password_change_required', 403);

    const requirement = this.reflector.getAllAndOverride<PermissionRequirement | undefined>(PERMISSIONS, targets);
    if (!requirement || requirement.permissions.length === 0) {
      this.log.warn(`Route ${req.method} ${req.path} has no authorization metadata — denied`);
      throw Err.forbidden();
    }

    const test = (p: string) => hasPermission(actor.permissions, p);
    const ok =
      requirement.mode === 'all' ? requirement.permissions.every(test) : requirement.permissions.some(test);

    if (!ok) {
      void this.audit.write({
        action: 'AUTHZ_DENIED',
        entityType: 'route',
        entityId: `${req.method} ${req.path}`.slice(0, 200),
        after: { required: requirement.permissions, mode: requirement.mode },
      });
      throw Err.forbidden();
    }
    return true;
  }
}
