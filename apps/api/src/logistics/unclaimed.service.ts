import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { formatMoneyDb, hoursBetween, storageDay, storagePenaltyForDay } from '@670send/pricing';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../common/settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { QueueService } from '../notifications/queue.service';
import { PrismaService } from '../prisma/prisma.service';
import { ShipmentStateService } from './shipment-state.service';

export interface SweepSummary {
  scanned: number;
  reminderDay3: number;
  reminderDay5: number;
  penaltiesUpdated: number;
  returnedToSender: number;
}

/**
 * Unclaimed-parcel policy (SOP §2.4), run daily at 08:00 Asia/Dili (+ hourly for perishables):
 *
 *   Day 1–5    free storage at the destination kiosk (Day 1 = arrival day, Dili calendar days)
 *   Day 3, 5   WhatsApp reminder to recipient AND sender, each language, sent once
 *   Day 6–14   storage penalty USD 0.50 per day accrues (collected at pick-up, split 70/30)
 *   Day 15+    flagged RETURN_TO_SENDER; CS/Ops alerted.   Short-shelf-life food: > 24 h.
 *
 * The sweep is idempotent and catch-up safe: it derives everything from `arrived_dest_at`, so a missed
 * run (outage) is corrected on the next one, and duplicate runs cannot double-send or double-charge.
 */
@Injectable()
export class UnclaimedService implements OnModuleInit {
  private readonly log = new Logger('Unclaimed');

  constructor(
    private readonly prisma: PrismaService,
    private readonly state: ShipmentStateService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
    private readonly queues: QueueService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit(): void {
    this.queues.registerSchedule('unclaimed-daily', '0 8 * * *', 'unclaimed-sweep');
    this.queues.registerSchedule('perishable-hourly', '0 * * * *', 'perishable-sweep');
    this.queues.registerHandler('unclaimed-sweep', async () => {
      const r = await this.sweep();
      this.log.log(`Daily sweep: ${JSON.stringify(r)}`);
    });
    this.queues.registerHandler('perishable-sweep', async () => {
      await this.sweep(new Date(), { perishableOnly: true });
    });
  }

  /** `onlyIds` restricts a run to specific parcels (ops re-run for one parcel, and deterministic tests). */
  async sweep(now = new Date(), opts: { perishableOnly?: boolean; onlyIds?: string[] } = {}): Promise<SweepSummary> {
    const policy = await this.settings.storagePolicy();
    const summary: SweepSummary = { scanned: 0, reminderDay3: 0, reminderDay5: 0, penaltiesUpdated: 0, returnedToSender: 0 };

    const parcels = await this.prisma.shipment.findMany({
      where: {
        status: 'ARRIVED_AT_DEST_AGENT',
        arrivedDestAt: { not: null },
        ...(opts.perishableOnly ? { isShortShelfLife: true } : {}),
        ...(opts.onlyIds ? { id: { in: opts.onlyIds } } : {}),
      },
      include: { destAgent: { select: { kioskName: true } } },
    });

    for (const s of parcels) {
      summary.scanned++;
      const arrived = s.arrivedDestAt!;
      const day = storageDay(arrived, now);
      const hours = hoursBetween(arrived, now);

      try {
        // ---- return to sender ---------------------------------------------------------------
        const perishableExpired = s.isShortShelfLife && hours > policy.shortShelfLifeRtsHours;
        if (perishableExpired || day > policy.rtsAfterDays) {
          await this.returnToSender(s.id, s.waybillNumber, s.destAgent?.kioskName, day, perishableExpired);
          summary.returnedToSender++;
          continue;
        }
        if (opts.perishableOnly) continue;

        // ---- reminders (once each; stale ones are skipped after an outage) ------------------------
        if (day >= 3 && day <= policy.freeDays && !s.storageReminderDay3SentAt) {
          await this.notifications.notifyShipment(s.id, 'STORAGE_REMINDER_DAY3', ['RECIPIENT', 'SENDER'], { daysLeft: policy.freeDays - day + 1 });
          await this.prisma.shipment.update({ where: { id: s.id }, data: { storageReminderDay3SentAt: now } });
          summary.reminderDay3++;
        }
        if (day === policy.freeDays && !s.storageReminderDay5SentAt) {
          await this.notifications.notifyShipment(s.id, 'STORAGE_REMINDER_DAY5', ['RECIPIENT', 'SENDER'], { dailyFee: policy.penaltyPerDayUsd });
          await this.prisma.shipment.update({ where: { id: s.id }, data: { storageReminderDay5SentAt: now } });
          summary.reminderDay5++;
        }

        // ---- penalty accrual (absolute value from the day number → idempotent) ----------------------
        const due = formatMoneyDb(storagePenaltyForDay(day));
        if (s.storagePenaltyUsd.toFixed(4) !== due) {
          const upd = await this.prisma.shipment.updateMany({
            where: { id: s.id, status: 'ARRIVED_AT_DEST_AGENT' },
            data: { storagePenaltyUsd: due },
          });
          if (upd.count === 1) summary.penaltiesUpdated++;
        }
      } catch (err) {
        this.log.error(`Sweep failed for ${s.waybillNumber}: ${(err as Error).message}`);
      }
    }
    return summary;
  }

  private async returnToSender(id: string, waybill: string, kiosk: string | undefined, day: number, perishable: boolean): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.state.transition(tx, id, 'RETURN_TO_SENDER', {
        from: ['ARRIVED_AT_DEST_AGENT'],
        notes: perishable ? 'Short-shelf-life food not collected within 24 hours' : `Not collected within 14 days (storage day ${day})`,
        meta: { kind: 'UNCLAIMED_RTS', day, perishable },
        data: { rtsFlaggedAt: new Date(), pickupOtpHash: null },
      });
      await this.audit.writeInTx(tx, { actorId: null, action: 'RTS_FLAGGED', entityType: 'shipment', entityId: id, after: { day, perishable } });
    });
    await this.notifications.notifyShipment(id, 'RETURN_TO_SENDER', ['SENDER', 'RECIPIENT']);
    await this.notifications.alertOps(`Parcel ${waybill} at ${kiosk ?? 'kiosk'} flagged RETURN_TO_SENDER (${perishable ? 'perishable > 24h' : `day ${day}`}). Arrange return to the Dili hub.`);
  }
}
