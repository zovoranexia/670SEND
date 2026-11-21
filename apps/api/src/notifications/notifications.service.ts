import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma, type LanguageCode, type NotificationAudience, type NotificationEventCode } from '@prisma/client';
import { fromPrismaLanguage, type Locale } from '@670send/types';
import { WHATSAPP_TEMPLATES, renderTemplate } from '@670send/i18n';
import { formatDiliTime } from '@670send/pricing';
import { FieldCrypto } from '../common/field-crypto';
import { ENV, type Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService, type JobContext } from './queue.service';
import { WHATSAPP_ADAPTER, WhatsAppSendError, type IWhatsAppAdapter } from './whatsapp.adapter';

export type TemplateVars = Record<string, string | number | null | undefined>;

interface WhatsAppJob {
  logId: string;
  to: string;
  /** AES-GCM encrypted: pickup OTPs must never sit in Redis in clear text. */
  bodyEnc: string;
}

const OTP_MASK = '******';

/**
 * Localized WhatsApp notifications.
 *  • templates come from `notification_templates` (editable in the admin console, 4 languages) with
 *    the built-in defaults as a safety net; recipient language = sender_lang / recipient_lang;
 *  • every message gets a `notification_logs` row first, with a unique dedupe key, so a retried
 *    business operation can never message a customer twice;
 *  • the stored log body has the OTP MASKED — only the encrypted queue payload carries the real code;
 *  • sending is asynchronous (BullMQ, 5 attempts, exponential backoff) and can never fail the
 *    business transaction that triggered it.
 */
@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly log = new Logger('Notifications');

  constructor(
    private readonly prisma: PrismaService,
    private readonly queues: QueueService,
    private readonly crypto: FieldCrypto,
    @Inject(WHATSAPP_ADAPTER) private readonly adapter: IWhatsAppAdapter,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onModuleInit(): void {
    this.queues.registerHandler('whatsapp.send', (data: WhatsAppJob, ctx) => this.process(data, ctx));
  }

  /* ------------------------------ composing ------------------------------ */

  private async resolveBody(eventCode: NotificationEventCode, lang: LanguageCode): Promise<{ body: string; templateId?: string }> {
    const tpl =
      (await this.prisma.notificationTemplate.findUnique({ where: { eventCode_lang: { eventCode, lang } } })) ??
      (await this.prisma.notificationTemplate.findUnique({ where: { eventCode_lang: { eventCode, lang: 'TET' } } }));
    if (tpl?.isActive) return { body: tpl.bodyTemplate, templateId: tpl.id };
    // Template disabled / missing → built-in default in the requested language (never English by accident).
    const locale: Locale = fromPrismaLanguage(lang);
    return { body: WHATSAPP_TEMPLATES[eventCode][locale] };
  }

  /** Create the log row (idempotent) and enqueue the encrypted send job. */
  async notify(args: {
    eventCode: NotificationEventCode;
    audience: NotificationAudience;
    phone: string;
    lang: LanguageCode;
    vars: TemplateVars;
    shipmentId?: string;
    dedupeKey?: string;
  }): Promise<void> {
    try {
      const { body, templateId } = await this.resolveBody(args.eventCode, args.lang);
      const clean = (text: string) => {
        const left = text.match(/\{\{\s*\w+\s*\}\}/g);
        if (left) this.log.warn(`Template ${args.eventCode}/${args.lang} has unresolved placeholders: ${left.join(', ')}`);
        return text.replace(/\{\{\s*\w+\s*\}\}/g, '').replace(/ {2,}/g, ' ').trim();
      };
      const realBody = clean(renderTemplate(body, args.vars));
      const loggedBody = clean(renderTemplate(body, { ...args.vars, otp: args.vars['otp'] ? OTP_MASK : args.vars['otp'] }));

      let logId: string;
      try {
        const row = await this.prisma.notificationLog.create({
          data: {
            shipmentId: args.shipmentId,
            audience: args.audience,
            recipientPhone: args.phone,
            eventCode: args.eventCode,
            lang: args.lang,
            templateId,
            renderedBody: loggedBody,
            provider: this.adapter.name,
            dedupeKey: args.dedupeKey,
          },
          select: { id: true },
        });
        logId = row.id;
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return; // already queued once
        throw err;
      }

      const job: WhatsAppJob = { logId, to: args.phone, bodyEnc: this.crypto.encrypt(realBody) };
      await this.queues.enqueue('whatsapp', 'whatsapp.send', job);
    } catch (err) {
      // A notification problem must never roll back or fail the parcel operation.
      this.log.error(`notify ${args.eventCode} failed: ${(err as Error).message}`);
    }
  }

  /**
   * Notify sender and/or recipient of a shipment in THEIR language.
   * `dedupeSuffix` lets deliberately repeatable messages (OTP re-send, a second hold) go out again.
   */
  async notifyShipment(
    shipmentId: string,
    eventCode: NotificationEventCode,
    audiences: NotificationAudience[],
    extraVars: TemplateVars = {},
    dedupeSuffix = '',
  ): Promise<void> {
    try {
      const s = await this.prisma.shipment.findUnique({
        where: { id: shipmentId },
        include: {
          originMunicipality: { select: { name: true } },
          destMunicipality: { select: { name: true } },
          originHub: { select: { name: true } },
          destAgent: { select: { kioskName: true, address: true, openingHours: true } },
          pickupCourier: { select: { user: { select: { fullName: true, phone: true } } } },
          deliveryCourier: { select: { user: { select: { fullName: true, phone: true } } } },
        },
      });
      if (!s) return;
      const courier = s.deliveryCourier ?? s.pickupCourier;
      const webBase = this.env.WEB_URL.replace(/\/$/, '');
      const vars: TemplateVars = {
        waybill: s.waybillNumber,
        trackUrl: `${webBase}/tet/track?no=${s.waybillNumber}`, // overridden per audience below
        hubName: s.originHub?.name,
        originName: s.originMunicipality.name,
        destName: s.destMunicipality.name,
        kioskName: s.destAgent?.kioskName,
        kioskLocation: s.destAgent?.address,
        openingHours: s.destAgent?.openingHours,
        courierName: courier?.user.fullName,
        courierPhone: courier?.user.phone,
        collectorName: s.collectorName,
        time: formatDiliTime(s.deliveredAt ?? new Date()),
        dailyFee: '0.50',
        ...extraVars,
      };
      await Promise.all(
        audiences.map((audience) =>
          this.notify({
            eventCode,
            audience,
            phone: audience === 'SENDER' ? s.senderPhone : s.recipientPhone,
            lang: audience === 'SENDER' ? s.senderLang : s.recipientLang,
            // The tracker link opens in the reader's own language (locale segment of the public site).
            vars: { ...vars, trackUrl: `${webBase}/${fromPrismaLanguage(audience === 'SENDER' ? s.senderLang : s.recipientLang)}/track?no=${s.waybillNumber}` },
            shipmentId,
            dedupeKey: `${shipmentId}:${eventCode}:${audience}${dedupeSuffix}`,
          }),
        ),
      );
    } catch (err) {
      this.log.error(`notifyShipment ${eventCode} failed: ${(err as Error).message}`);
    }
  }

  /** Alert the ops team (e.g. parcel flagged return-to-sender). Best-effort, plain text, no log row. */
  async alertOps(text: string): Promise<void> {
    this.log.warn(`OPS ALERT: ${text}`);
    if (!this.env.OPS_ALERT_PHONE) return;
    try {
      await this.adapter.send({ to: this.env.OPS_ALERT_PHONE, body: `[670Send OPS] ${text}` });
    } catch (err) {
      this.log.error(`ops alert delivery failed: ${(err as Error).message}`);
    }
  }

  /* ------------------------------ sending -------------------------------- */

  /** Queue worker entry point (also called inline when queues are disabled). */
  async process(job: WhatsAppJob, ctx: JobContext): Promise<void> {
    const row = await this.prisma.notificationLog.findUnique({ where: { id: job.logId } });
    if (!row || row.deliveryStatus === 'SENT' || row.deliveryStatus === 'DELIVERED' || row.deliveryStatus === 'READ') return;

    try {
      const body = this.crypto.decrypt(job.bodyEnc);
      const res = await this.adapter.send({ to: job.to, body });
      await this.prisma.notificationLog.update({
        where: { id: row.id },
        data: { deliveryStatus: 'SENT', providerMessageId: res.providerMessageId, sentAt: new Date(), lastError: null },
      });
    } catch (err) {
      const retryable = !(err instanceof WhatsAppSendError) || err.retryable;
      const lastAttempt = ctx.attempt >= ctx.maxAttempts;
      await this.prisma.notificationLog.update({
        where: { id: row.id },
        data: {
          retryCount: { increment: 1 },
          lastError: (err as Error).message.slice(0, 300),
          deliveryStatus: !retryable || lastAttempt ? 'FAILED' : 'QUEUED',
        },
      });
      if (retryable && !lastAttempt) throw err; // BullMQ schedules the retry with backoff
      this.log.error(`WhatsApp ${row.eventCode} → ${row.recipientPhone} FAILED: ${(err as Error).message}`);
    }
  }
}
