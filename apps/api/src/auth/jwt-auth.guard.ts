import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC, type AuthedRequest } from '../common/decorators';
import { Err } from '../common/errors';
import { RequestContext } from '../common/request-context';
import { ActorService } from '../rbac/actor.service';
import { TokenService } from './token.service';

/**
 * Global authentication guard. Verifies the Bearer access token (HS256, issuer + audience pinned),
 * rebuilds the Actor from the DB (so deactivation / role changes apply within seconds) and exposes
 * it on `req.actor` and in the request context (audit log, locale, ledger `createdBy`).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly actors: ActorService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()])) {
      return true;
    }

    const req = context.switchToHttp().getRequest<AuthedRequest & Request>();
    const header = req.header('authorization') ?? '';
    const [scheme, token] = header.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) throw Err.unauthorized();

    let sub: string;
    try {
      ({ sub } = await this.tokens.verifyAccess(token));
    } catch {
      throw Err.unauthorized();
    }

    const actor = await this.actors.load(sub);
    if (!actor) throw Err.unauthorized();

    req.actor = actor;
    const store = RequestContext.current();
    if (store) {
      store.actor = actor;
      store.locale ??= actor.lang; // an explicit X-Lang header (set by the middleware) wins
    }
    return true;
  }
}
