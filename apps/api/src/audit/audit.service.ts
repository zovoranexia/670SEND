import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RequestContext } from '../common/request-context';

export interface AuditEntryInput {
  actorId?: string | null;
  actorRoles?: string[];
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

const SENSITIVE_KEY = /pass(word)?|pin|otp|token|secret|authorization|cookie|hash|bank_?account|account_?no/i;
const MAX_DEPTH = 6;
const MAX_STRING = 2_000;

/** Deep-copies a value for JSONB storage, masking secrets and bounding size. */
export function redact(value: unknown, depth = 0): Prisma.InputJsonValue | null {
  if (value === null || value === undefined) return null;
  if (depth > MAX_DEPTH) return '[truncated]';
  if (typeof value === 'string') return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Prisma.Decimal) return value.toFixed(4);
  if (Buffer.isBuffer(value)) return '[binary]';
  if (Array.isArray(value)) return value.slice(0, 100).map((v) => redact(v, depth + 1) ?? null);
  if (typeof value === 'object') {
    const out: Record<string, Prisma.InputJsonValue | null> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) ? '[REDACTED]' : redact(v, depth + 1);
    }
    return out;
  }
  return String(value);
}

@Injectable()
export class AuditService {
  private readonly log = new Logger('Audit');

  constructor(private readonly prisma: PrismaService) {}

  /** Builds the row, filling actor / ip / request id from the ambient request context. */
  private toData(input: AuditEntryInput): Prisma.AuditLogUncheckedCreateInput {
    const ctx = RequestContext.current();
    const actor = ctx?.actor;
    const before = redact(input.before);
    const after = redact(input.after);
    return {
      actorId: input.actorId === undefined ? (actor?.id ?? null) : input.actorId,
      actorRoles: input.actorRoles ?? actor?.roles ?? [],
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      before: before === null ? Prisma.JsonNull : before,
      after: after === null ? Prisma.JsonNull : after,
      reason: input.reason ?? ctx?.audit.reason ?? null,
      ip: input.ip ?? ctx?.ip ?? null,
      userAgent: input.userAgent ?? ctx?.userAgent ?? null,
      requestId: input.requestId ?? ctx?.requestId ?? null,
    };
  }

  /**
   * Write inside the caller's transaction — use for critical mutations so the change and its
   * audit row commit (or roll back) together.
   */
  async writeInTx(tx: Prisma.TransactionClient, input: AuditEntryInput): Promise<void> {
    await tx.auditLog.create({ data: this.toData(input) });
  }

  /** Fire-and-log: used by the interceptor and by security events where failing the request would be worse. */
  async write(input: AuditEntryInput): Promise<void> {
    try {
      await this.prisma.auditLog.create({ data: this.toData(input) });
    } catch (err) {
      this.log.error(`Failed to write audit log (${input.action})`, err instanceof Error ? err.stack : String(err));
    }
  }
}
