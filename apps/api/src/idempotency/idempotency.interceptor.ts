import { createHash } from 'node:crypto';
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { Observable, from, of, throwError } from 'rxjs';
import { catchError, mergeMap } from 'rxjs/operators';
import { IDEMPOTENT, type AuthedRequest, type IdempotentOptions } from '../common/decorators';
import { Err } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';

const KEY_RE = /^[A-Za-z0-9_.:-]{8,128}$/;
const TTL_MS = 24 * 60 * 60 * 1000;

/** JSON.stringify with recursively sorted keys → identical hash for semantically identical bodies. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

/**
 * Replay-safe execution for @Idempotent() routes (financial + intake endpoints).
 *
 *  first call            → claims (scope, key) as IN_PROGRESS, runs the handler, stores the response
 *  same key + same body  → returns the STORED response (header Idempotent-Replayed: true), handler not run
 *  same key + other body → 422 idempotency_conflict (client bug: key reuse)
 *  same key, still busy  → 409 request_in_progress (+ Retry-After)
 *  handler throws        → the claim is released so the client can retry with the same key
 *
 * Keys are scoped per caller (user id, or IP for anonymous calls) so one user can never replay
 * — or probe — another user's key. Ledger postings carry the same key as a second line of defence.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const options = this.reflector.getAllAndOverride<IdempotentOptions | undefined>(IDEMPOTENT, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!options) return next.handle();

    const http = context.switchToHttp();
    const req = http.getRequest<AuthedRequest & Request>();
    const res = http.getResponse<Response>();

    const key = req.header('idempotency-key');
    if (!key) {
      if (options.required) throw Err.idempotencyKeyRequired();
      return next.handle();
    }
    if (!KEY_RE.test(key)) throw Err.idempotencyKeyRequired();

    const scope = req.actor?.id ?? `ip:${req.ip ?? 'unknown'}`;
    const requestHash = createHash('sha256')
      .update(`${req.method} ${req.originalUrl.split('?')[0]}\n${stableStringify(req.body)}`)
      .digest('hex');

    const claim = await this.claim(scope, key, req, requestHash);
    if (claim.replay) {
      res.setHeader('Idempotent-Replayed', 'true');
      return of(claim.replay.body);
    }

    const successCode =
      (Reflect.getMetadata(HTTP_CODE_METADATA, context.getHandler()) as number | undefined) ??
      (req.method === 'POST' ? 201 : 200);

    return next.handle().pipe(
      mergeMap((body) =>
        from(
          this.prisma.idempotencyKey.update({
            where: { id: claim.id },
            data: {
              status: 'COMPLETED',
              responseCode: successCode,
              responseBody: body === undefined || body === null ? Prisma.JsonNull : (JSON.parse(JSON.stringify(body)) as Prisma.InputJsonValue),
            },
          }),
        ).pipe(mergeMap(() => of(body))),
      ),
      catchError((err) =>
        from(this.prisma.idempotencyKey.deleteMany({ where: { id: claim.id, status: 'IN_PROGRESS' } })).pipe(
          mergeMap(() => throwError(() => err)),
        ),
      ),
    );
  }

  private async claim(
    scope: string,
    key: string,
    req: Request,
    requestHash: string,
  ): Promise<{ id: string; replay?: { body: unknown } }> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const row = await this.prisma.idempotencyKey.create({
          data: {
            scope,
            key,
            method: req.method,
            path: req.originalUrl.split('?')[0]!.slice(0, 300),
            requestHash,
            expiresAt: new Date(Date.now() + TTL_MS),
          },
          select: { id: true },
        });
        return { id: row.id };
      } catch (err) {
        if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') throw err;
      }

      const existing = await this.prisma.idempotencyKey.findUnique({ where: { scope_key: { scope, key } } });
      if (!existing) continue; // released between create and read → try to claim again

      if (existing.expiresAt.getTime() <= Date.now()) {
        await this.prisma.idempotencyKey.deleteMany({ where: { id: existing.id } });
        continue;
      }
      if (existing.requestHash !== requestHash) throw Err.idempotencyConflict();
      if (existing.status === 'COMPLETED') {
        return { id: existing.id, replay: { body: existing.responseBody ?? undefined } };
      }
      throw Err.requestInProgress();
    }
    throw Err.requestInProgress();
  }
}
