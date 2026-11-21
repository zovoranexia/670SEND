import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { yymmddDili } from '@670send/pricing';
import { AppException } from '../common/errors';

/** `670S-[ORIG_3]-[DEST_3]-[YYMMDD]-[4_DIGIT_SEQ]` — sequence per origin, destination and Dili calendar day. */
@Injectable()
export class WaybillService {
  /**
   * Atomically takes the next sequence number. The single INSERT … ON CONFLICT DO UPDATE statement
   * takes a row lock, so concurrent intakes on the same route/day get distinct numbers, and the
   * increment rolls back together with the intake transaction (no gaps from failed intakes).
   */
  async next(tx: Prisma.TransactionClient, originCode: string, destCode: string, now = new Date()): Promise<string> {
    const dateKey = yymmddDili(now);
    const rows = await tx.$queryRaw<Array<{ last_value: number }>>`
      INSERT INTO waybill_sequences (origin_code, dest_code, date_key, last_value, updated_at)
      VALUES (${originCode}, ${destCode}, ${dateKey}, 1, now())
      ON CONFLICT (origin_code, dest_code, date_key)
      DO UPDATE SET last_value = waybill_sequences.last_value + 1, updated_at = now()
      RETURNING last_value`;
    const seq = rows[0]!.last_value;
    if (seq > 9999) throw new AppException('waybill_sequence_exhausted', 409);
    return `670S-${originCode}-${destCode}-${dateKey}-${String(seq).padStart(4, '0')}`;
  }
}
