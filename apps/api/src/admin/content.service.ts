import { Injectable } from '@nestjs/common';
import { Prisma, type AddonServiceType, type LanguageCode, type NotificationEventCode } from '@prisma/client';
import { z } from 'zod';
import { LOCALES, NOTIFICATION_EVENT_CODES, NOTIFICATION_VARIABLES, fromPrismaLanguage, toPrismaLanguage, type Locale } from '@670send/types';
import { WHATSAPP_TEMPLATES, extractTemplateVariables, renderTemplate } from '@670send/i18n';
import { AuditService } from '../audit/audit.service';
import { AppException, Err } from '../common/errors';
import { SettingsService } from '../common/settings.service';
import { PrismaService } from '../prisma/prisma.service';
import type { Actor } from '../rbac/actor';

const usd = (d: Prisma.Decimal) => d.toFixed(4);

const SAMPLE_VARS: Record<string, string | number> = {
  waybill: '670S-DIL-BCU-261121-0042',
  trackUrl: 'https://670send.tl/tet/track?no=670S-DIL-BCU-261121-0042',
  hubName: 'Terminal Becora',
  originName: 'Díli',
  destName: 'Baucau',
  kioskName: 'Kios 670Link Baucau Vila',
  kioskLocation: 'Baucau Vila, Baucau',
  openingHours: '08:00–18:00',
  otp: '123456',
  courierName: 'Domingos Pereira',
  courierPhone: '+67077200001',
  collectorName: 'José Guterres',
  time: '10:05',
  daysLeft: 3,
  dailyFee: '0.50',
};

/** The settings the API may change. Every one of them is actually read by the running system. */
const EDITABLE_SETTINGS = {
  bus_capacity: z.object({ maxSmallParcels: z.number().int().min(1).max(100), maxMasterBags: z.number().int().min(0).max(10) }).strict(),
  claim_cs_approval_limit_usd: z.string().regex(/^\d{1,5}(\.\d{1,2})?$/),
  claim_handover_window_minutes: z.number().int().min(5).max(1440),
  dest_commission_wallet: z.enum(['COMMISSION', 'DEPOSIT']),
  otp: z.object({ length: z.literal(6), ttlDays: z.number().int().min(1).max(60), maxAttempts: z.number().int().min(3).max(10), lockMinutes: z.number().int().min(1).max(1440) }).strict(),
} as const;
export type EditableSettingKey = keyof typeof EDITABLE_SETTINGS;

@Injectable()
export class ContentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  /* ============================== WhatsApp templates ============================== */

  async listTemplates() {
    const rows = await this.prisma.notificationTemplate.findMany({ include: { } });
    const byKey = new Map(rows.map((r) => [`${r.eventCode}:${r.lang}`, r]));
    const out = [];
    for (const eventCode of NOTIFICATION_EVENT_CODES) {
      for (const locale of LOCALES) {
        const row = byKey.get(`${eventCode}:${toPrismaLanguage(locale)}`);
        const def = WHATSAPP_TEMPLATES[eventCode][locale];
        out.push({
          eventCode,
          lang: locale,
          bodyTemplate: row?.bodyTemplate ?? def,
          isActive: row?.isActive ?? true,
          isDefaultText: (row?.bodyTemplate ?? def) === def,
          allowedVariables: NOTIFICATION_VARIABLES[eventCode],
          updatedAt: row?.updatedAt ?? null,
        });
      }
    }
    return out;
  }

  private checkTemplate(eventCode: NotificationEventCode, body: string, active: boolean): string[] {
    if (body.trim().length < 5 || body.length > 1000 || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(body)) {
      throw Err.validation([{ path: 'bodyTemplate', message: 'errors.validation_failed' }]);
    }
    const allowed = new Set<string>(NOTIFICATION_VARIABLES[eventCode]);
    const used = extractTemplateVariables(body);
    const bad = used.filter((v) => !allowed.has(v));
    if (bad.length) throw new AppException('template_variable_invalid', 422, { vars: bad.join(', ') });
    // The pickup message is useless without the code: an active ARRIVED template must carry it.
    if (eventCode === 'ARRIVED_AT_DEST_AGENT' && active && !used.includes('otp')) throw new AppException('template_otp_required', 422);
    return used;
  }

  async updateTemplate(actor: Actor, eventCode: NotificationEventCode, locale: Locale, input: { bodyTemplate?: string; isActive?: boolean }) {
    const lang = toPrismaLanguage(locale);
    const existing = await this.prisma.notificationTemplate.findUnique({ where: { eventCode_lang: { eventCode, lang } } });
    const body = input.bodyTemplate ?? existing?.bodyTemplate ?? WHATSAPP_TEMPLATES[eventCode][locale];
    const active = input.isActive ?? existing?.isActive ?? true;
    this.checkTemplate(eventCode, body, active);

    const saved = await this.prisma.notificationTemplate.upsert({
      where: { eventCode_lang: { eventCode, lang } },
      create: { eventCode, lang, bodyTemplate: body, isActive: active, updatedBy: actor.id },
      update: { bodyTemplate: body, isActive: active, updatedBy: actor.id },
    });
    await this.audit.write({
      action: 'TEMPLATE_UPDATED',
      entityType: 'notification_template',
      entityId: saved.id,
      before: existing ? { bodyTemplate: existing.bodyTemplate, isActive: existing.isActive } : null,
      after: { eventCode, lang: locale, bodyTemplate: body, isActive: active },
    });
    return (await this.listTemplates()).find((t) => t.eventCode === eventCode && t.lang === locale)!;
  }

  /** Render a draft with sample data so the editor can show exactly what a customer would read. */
  previewTemplate(eventCode: NotificationEventCode, body: string) {
    const used = this.checkTemplate(eventCode, body, false);
    const text = renderTemplate(body, SAMPLE_VARS);
    return { text, variablesUsed: used, length: text.length, sample: SAMPLE_VARS };
  }

  async resetTemplate(actor: Actor, eventCode: NotificationEventCode, locale: Locale) {
    return this.updateTemplate(actor, eventCode, locale, { bodyTemplate: WHATSAPP_TEMPLATES[eventCode][locale], isActive: true });
  }

  async notificationLogs(q: { shipmentId?: string; phone?: string; status?: string; eventCode?: string; limit: number; before?: string }) {
    const rows = await this.prisma.notificationLog.findMany({
      where: {
        ...(q.shipmentId ? { shipmentId: q.shipmentId } : {}),
        ...(q.phone ? { recipientPhone: q.phone } : {}),
        ...(q.status ? { deliveryStatus: q.status as never } : {}),
        ...(q.eventCode ? { eventCode: q.eventCode as never } : {}),
        ...(q.before ? { createdAt: { lt: new Date(q.before) } } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit,
      include: { shipment: { select: { waybillNumber: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      at: r.createdAt,
      waybill: r.shipment?.waybillNumber ?? null,
      event: r.eventCode,
      audience: r.audience,
      lang: fromPrismaLanguage(r.lang),
      to: r.recipientPhone,
      status: r.deliveryStatus,
      retries: r.retryCount,
      error: r.lastError,
      provider: r.provider,
      body: r.renderedBody, // OTP already masked at write time
    }));
  }

  /* ================================== tariffs ================================== */

  async getTariffs() {
    const [zones, addons, munis] = await Promise.all([
      this.prisma.pricingZone.findMany({ orderBy: { code: 'asc' } }),
      this.prisma.addonTariff.findMany({ orderBy: { serviceType: 'asc' } }),
      this.prisma.municipality.findMany({ orderBy: [{ corridor: 'asc' }, { code: 'asc' }], include: { zone: { select: { code: true } } } }),
    ]);
    return {
      zones: zones.map((z) => ({
        code: z.code,
        names: { tet: z.nameTet, pt: z.namePt, en: z.nameEn, id: z.nameId },
        eta: { tet: z.etaTet, pt: z.etaPt, en: z.etaEn, id: z.etaId },
        docRate: usd(z.docRateUsd),
        smallBase2kg: usd(z.smallBase2kgUsd),
        extraPerKg: usd(z.extraPerKgUsd),
        cargoBase10kg: usd(z.cargoBase10kgUsd),
        cargoExtraPerKg: usd(z.cargoExtraPerKgUsd),
        updatedAt: z.updatedAt,
      })),
      addons: addons.map((a) => ({
        serviceType: a.serviceType,
        labels: { tet: a.labelTet, pt: a.labelPt, en: a.labelEn, id: a.labelId },
        fee: usd(a.feeUsd),
        courierSplitPct: a.courierSplitPct.toFixed(2),
        platformSplitPct: a.platformSplitPct.toFixed(2),
        wholesaleMinParcels: a.wholesaleMinParcels,
        wholesaleFreePickup: a.wholesaleFreePickup,
        isActive: a.isActive,
      })),
      municipalities: munis.map((m) => ({ code: m.code, name: m.name, corridor: m.corridor, zone: m.zone?.code ?? null, isSeaRoute: m.isSeaRoute, surcharge: usd(m.tariffSurchargeUsd) })),
    };
  }

  /** Edits apply to FUTURE shipments only — every shipment keeps the pricing snapshot it was created with. */
  async updateZone(actor: Actor, code: string, input: Partial<Record<'docRate' | 'smallBase2kg' | 'extraPerKg' | 'cargoBase10kg' | 'cargoExtraPerKg', string>> & { names?: Partial<Record<Locale, string>>; eta?: Partial<Record<Locale, string>> }) {
    const z = await this.prisma.pricingZone.findUnique({ where: { code } });
    if (!z) throw Err.notFound();
    const data: Prisma.PricingZoneUpdateInput = { updatedBy: actor.id };
    if (input.docRate) data.docRateUsd = input.docRate;
    if (input.smallBase2kg) data.smallBase2kgUsd = input.smallBase2kg;
    if (input.extraPerKg) data.extraPerKgUsd = input.extraPerKg;
    if (input.cargoBase10kg) data.cargoBase10kgUsd = input.cargoBase10kg;
    if (input.cargoExtraPerKg) data.cargoExtraPerKgUsd = input.cargoExtraPerKg;
    if (input.names?.tet) data.nameTet = input.names.tet;
    if (input.names?.pt) data.namePt = input.names.pt;
    if (input.names?.en) data.nameEn = input.names.en;
    if (input.names?.id) data.nameId = input.names.id;
    if (input.eta?.tet) data.etaTet = input.eta.tet;
    if (input.eta?.pt) data.etaPt = input.eta.pt;
    if (input.eta?.en) data.etaEn = input.eta.en;
    if (input.eta?.id) data.etaId = input.eta.id;
    const before = (await this.getTariffs()).zones.find((x) => x.code === code);
    await this.prisma.pricingZone.update({ where: { code }, data });
    const after = (await this.getTariffs()).zones.find((x) => x.code === code);
    await this.audit.write({ action: 'TARIFF_ZONE_UPDATED', entityType: 'pricing_zone', entityId: z.id, before, after });
    return after!;
  }

  async updateAddon(actor: Actor, serviceType: AddonServiceType, input: { fee?: string; courierSplitPct?: string; wholesaleMinParcels?: number; wholesaleFreePickup?: boolean; isActive?: boolean }) {
    const a = await this.prisma.addonTariff.findUnique({ where: { serviceType } });
    if (!a) throw Err.notFound();
    const courier = new Prisma.Decimal(input.courierSplitPct ?? a.courierSplitPct);
    if (courier.lessThan(0) || courier.greaterThan(100)) throw Err.validation([{ path: 'courierSplitPct', message: 'errors.validation_failed' }]);
    const before = (await this.getTariffs()).addons.find((x) => x.serviceType === serviceType);
    await this.prisma.addonTariff.update({
      where: { serviceType },
      data: {
        ...(input.fee ? { feeUsd: input.fee } : {}),
        courierSplitPct: courier,
        platformSplitPct: new Prisma.Decimal(100).minus(courier), // always sums to exactly 100 (DB constraint too)
        ...(input.wholesaleMinParcels ? { wholesaleMinParcels: input.wholesaleMinParcels } : {}),
        ...(input.wholesaleFreePickup === undefined ? {} : { wholesaleFreePickup: input.wholesaleFreePickup }),
        ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
        updatedBy: actor.id,
      },
    });
    const after = (await this.getTariffs()).addons.find((x) => x.serviceType === serviceType);
    await this.audit.write({ action: 'TARIFF_ADDON_UPDATED', entityType: 'addon_tariff', entityId: a.id, before, after });
    return after!;
  }

  async updateSurcharge(actor: Actor, code: string, surcharge: string) {
    const m = await this.prisma.municipality.findUnique({ where: { code } });
    if (!m) throw Err.notFound();
    await this.prisma.municipality.update({ where: { code }, data: { tariffSurchargeUsd: surcharge } });
    await this.audit.write({ action: 'TARIFF_SURCHARGE_UPDATED', entityType: 'municipality', entityId: m.id, before: { surcharge: usd(m.tariffSurchargeUsd) }, after: { surcharge: new Prisma.Decimal(surcharge).toFixed(4) }, actorId: actor.id });
    return { code, surcharge: new Prisma.Decimal(surcharge).toFixed(4) };
  }

  /* ================================== settings ================================== */

  async listSettings() {
    const rows = await this.prisma.systemSetting.findMany({ orderBy: { key: 'asc' } });
    return rows.map((r) => ({ key: r.key, value: r.value, description: r.description, editable: r.key in EDITABLE_SETTINGS, updatedAt: r.updatedAt }));
  }

  async updateSetting(actor: Actor, key: string, value: unknown) {
    if (!(key in EDITABLE_SETTINGS)) throw new AppException('setting_not_editable', 403);
    const parsed = EDITABLE_SETTINGS[key as EditableSettingKey].safeParse(value);
    if (!parsed.success) throw Err.validation(parsed.error.issues.map((i) => ({ path: i.path.join('.') || 'value', message: i.message })));
    const existing = await this.prisma.systemSetting.findUnique({ where: { key } });
    await this.prisma.systemSetting.upsert({
      where: { key },
      create: { key, value: parsed.data as Prisma.InputJsonValue, updatedBy: actor.id },
      update: { value: parsed.data as Prisma.InputJsonValue, updatedBy: actor.id },
    });
    this.settings.invalidate();
    await this.audit.write({ action: 'SETTING_UPDATED', entityType: 'system_setting', entityId: key, before: { value: existing?.value ?? null }, after: { value: parsed.data } });
    return { key, value: parsed.data };
  }
}

export type { LanguageCode };
