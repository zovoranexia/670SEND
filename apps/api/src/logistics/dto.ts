import { z } from 'zod';
import type { Prisma, Shipment } from '@prisma/client';
import { ID_TYPES, ITEM_CATEGORIES, SERVICE_SCHEMES } from '@670send/types';
import { formatMoneyDb, formatMoneyDisplay, parseMoney } from '@670send/pricing';
import {
  languageSchema,
  parcelDimensionsSchema,
  prohibitedChecklistSchema,
  tlWhatsAppPhoneSchema,
} from '@670send/validation';

const code3 = z
  .string()
  .trim()
  .length(3)
  .transform((v) => v.toUpperCase());

/** "3", "3.5", 3.5 → "3.5000"; rejects > 4 decimals and negatives. */
export const moneyInput = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .refine((v) => /^\d{1,10}(\.\d{1,4})?$/.test(v), { message: 'errors.validation_failed' });

export const uuid = z.string().uuid();
export const pin6 = z.string().regex(/^\d{6}$/, { message: 'errors.validation.pin' });

const person = {
  phone: tlWhatsAppPhoneSchema,
  lang: languageSchema,
  address: z.string().trim().max(300).optional(),
};

export const quoteSchema = z.object({
  originMunicipalityCode: code3.default('DIL'),
  destMunicipalityCode: code3,
  scheme: z.enum(SERVICE_SCHEMES).default('SCHEME_A'),
  parcel: parcelDimensionsSchema,
  itemCategory: z.enum(ITEM_CATEGORIES).default('GENERAL'),
  isFragile: z.boolean().default(false),
  isHeavyBulk: z.boolean().default(false),
  declaredValueUsd: moneyInput.optional(),
  insure: z.boolean().default(false),
});

/** Shipment intake at an agent kiosk, by a courier on site, or at a company hub desk. */
export const intakeSchema = z.object({
  scheme: z.enum(SERVICE_SCHEMES),
  /** Only for company-hub-desk intake; kiosks and couriers always start from their own municipality. */
  originMunicipalityCode: code3.optional(),
  destMunicipalityCode: code3,
  destAgentId: uuid.optional(),
  pickupBookingId: uuid.optional(),
  sender: z.object({
    name: z.string().trim().min(3, { message: 'errors.validation.name' }).max(120),
    idType: z.enum(ID_TYPES),
    idNumber: z.string().trim().min(4, { message: 'errors.validation.id_number' }).max(40),
    ...person,
  }),
  recipient: z.object({
    name: z.string().trim().min(2, { message: 'errors.validation.name' }).max(120),
    ...person,
  }),
  item: z.object({
    description: z.string().trim().min(2).max(300),
    category: z.enum(ITEM_CATEGORIES).default('GENERAL'),
    isFragile: z.boolean().default(false),
    isHeavyBulk: z.boolean().default(false),
    declaredValueUsd: moneyInput.optional(),
  }),
  parcel: parcelDimensionsSchema,
  insure: z.boolean().default(false),
  /** Every line must be explicitly ticked in the agent's UI language (SOP §3.1). */
  prohibitedChecklist: prohibitedChecklistSchema,
  checklistLang: languageSchema,
  /** ≥ 2 staged photos: OPEN_BOX_CONTENT + SEALED_PARCEL. */
  photoUploadIds: z.array(uuid).min(2).max(8),
  sealCode: z.string().trim().min(4).max(32).optional(),
  /** Step 5 of the wizard: the acting user's 6-digit PIN. */
  pin: pin6,
});
export type IntakeInput = z.infer<typeof intakeSchema>;

export const listQuerySchema = z.object({
  status: z.string().optional(),
  q: z.string().trim().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  before: z.string().datetime().optional(),
});

/* ---------------------------------------------------------------------------------------------- */
/* Output mapping                                                                                  */
/* ---------------------------------------------------------------------------------------------- */

const usd = (d: Prisma.Decimal | null | undefined) => (d == null ? null : { usd: d.toFixed(4), display: formatMoneyDisplay(parseMoney(d.toFixed(4))) });

/** "Maria da Costa" → "M**** d* C****" (public tracker). */
export function maskName(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => `${w[0]}${'*'.repeat(Math.min(Math.max(w.length - 1, 1), 5))}`)
    .join(' ');
}

/** "+67077123456" → "+670 77** **56". */
export function maskPhone(phone: string): string {
  return phone.length < 8 ? '****' : `${phone.slice(0, 4)} ${phone.slice(4, 6)}** **${phone.slice(-2)}`;
}

export type ShipmentView = 'FULL' | 'DEST_ONLY';

type ShipmentWithRefs = Shipment & {
  originMunicipality?: { code: string; name: string };
  destMunicipality?: { code: string; name: string };
  destAgent?: { id: string; kioskName: string; address: string; openingHours: string | null } | null;
};

/**
 * Field-level privacy: the destination agent needs the recipient's details but has no business with
 * the sender's ID number / address, so they get a masked sender. Origin agent, pickup courier, creator
 * and staff with `shipments:read_all` see everything. OTP material is never exposed.
 */
export function toShipmentDto(s: ShipmentWithRefs, view: ShipmentView = 'FULL') {
  const full = view === 'FULL';
  return {
    id: s.id,
    waybillNumber: s.waybillNumber,
    status: s.status,
    serviceScheme: s.serviceScheme,
    transportCanal: s.transportCanal,
    intakeChannel: s.intakeChannel,
    origin: s.originMunicipality && { code: s.originMunicipality.code, name: s.originMunicipality.name },
    destination: s.destMunicipality && { code: s.destMunicipality.code, name: s.destMunicipality.name },
    destAgent: s.destAgent && { id: s.destAgent.id, kioskName: s.destAgent.kioskName, address: s.destAgent.address, openingHours: s.destAgent.openingHours },
    sender: full
      ? { name: s.senderName, phone: s.senderPhone, idType: s.senderIdType, idNumber: s.senderIdNumber, lang: s.senderLang, address: s.senderAddress }
      : { name: maskName(s.senderName), phone: maskPhone(s.senderPhone), lang: s.senderLang },
    recipient: { name: s.recipientName, phone: s.recipientPhone, lang: s.recipientLang, address: s.recipientAddress },
    item: {
      description: s.itemDescription,
      category: s.itemCategory,
      isFragile: s.isFragile,
      isHeavyBulk: s.isHeavyBulk,
      isShortShelfLife: s.isShortShelfLife,
      declaredValue: usd(s.declaredValueUsd),
    },
    parcel: {
      actualWeightKg: Number(s.actualWeightKg),
      volumetricWeightKg: Number(s.volumetricWeightKg),
      chargeableWeightKg: s.chargeableWeightKg,
      lengthCm: Number(s.lengthCm),
      widthCm: Number(s.widthCm),
      heightCm: Number(s.heightCm),
      isDocumentTier: s.isDocumentTier,
    },
    insurance: { isInsured: s.isInsured, premium: usd(s.insuranceFeeUsd), insuredAmount: usd(s.insuredAmountUsd) },
    fees: {
      base: usd(s.baseShippingFeeUsd),
      pickupAddon: usd(s.pickupAddonFeeUsd),
      deliveryAddon: usd(s.deliveryAddonFeeUsd),
      storagePenalty: usd(s.storagePenaltyUsd),
      total: usd(s.totalFeeUsd),
    },
    sealCode: s.sealCode,
    otpIssued: s.pickupOtpHash != null,
    holdReason: s.holdReason,
    arrivedDestAt: s.arrivedDestAt,
    deliveredAt: s.deliveredAt,
    collectorName: s.collectorName,
    createdAt: s.createdAt,
  };
}

export const money = (u: bigint) => formatMoneyDb(u);
