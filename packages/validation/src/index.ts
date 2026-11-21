import { z } from 'zod';
import { ID_TYPES, LOCALES, DEFAULT_LOCALE } from '@670send/types';

/** Waybill: 670S-[ORIG_3]-[DEST_3]-[YYMMDD]-[4_DIGIT_SEQ], e.g. 670S-DIL-BCU-261121-0042 */
export const WAYBILL_REGEX = /^670S-[A-Z]{3}-[A-Z]{3}-\d{6}-\d{4}$/;

/** Timor-Leste numbers in E.164: +670 followed by 7 (landline 3xxxxxx) or 8 digits (mobile 7xxxxxxx). */
const TL_PHONE_E164 = /^\+670(?:[3]\d{6}|[7]\d{7})$/;
/** WhatsApp-capable numbers are mobile only. */
const TL_MOBILE_E164 = /^\+6707\d{7}$/;

/** Normalise "7712 3456", "0067077123456", "+670 7712-3456", "77123456" → "+67077123456". */
export function normalizeTlPhone(input: string): string {
  const digits = input.replace(/[^\d+]/g, '');
  let d = digits.startsWith('+') ? digits.slice(1) : digits;
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('670')) return `+${d}`;
  return `+670${d}`;
}

export const tlPhoneSchema = z
  .string()
  .trim()
  .transform((v) => normalizeTlPhone(v))
  .refine((v) => TL_PHONE_E164.test(v), { message: 'errors.validation.phone' });

export const tlWhatsAppPhoneSchema = z
  .string()
  .trim()
  .transform((v) => normalizeTlPhone(v))
  .refine((v) => TL_MOBILE_E164.test(v), { message: 'errors.validation.whatsapp_phone' });

export const waybillSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(WAYBILL_REGEX, { message: 'errors.validation.waybill' });

export const otpSchema = z.string().regex(/^\d{6}$/, { message: 'errors.validation.otp' });

const WEAK_PINS = new Set([
  '000000', '111111', '222222', '333333', '444444', '555555', '666666', '777777', '888888', '999999',
  '123456', '654321', '121212', '112233', '123123',
]);

export const pinSchema = z
  .string()
  .regex(/^\d{6}$/, { message: 'errors.validation.pin' })
  .refine((v) => !WEAK_PINS.has(v), { message: 'errors.validation.pin_weak' });

export const languageSchema = z.enum(LOCALES).default(DEFAULT_LOCALE);

export const idTypeSchema = z.enum(ID_TYPES);

/** Mandatory KYC captured at drop-off / courier pickup. Anonymous senders are rejected. */
export const senderKycSchema = z.object({
  senderName: z.string().trim().min(3, { message: 'errors.validation.name' }).max(120),
  senderIdType: idTypeSchema,
  senderIdNumber: z.string().trim().min(4, { message: 'errors.validation.id_number' }).max(40),
  senderPhone: tlWhatsAppPhoneSchema,
  senderLang: languageSchema,
});

export const recipientSchema = z.object({
  recipientName: z.string().trim().min(2, { message: 'errors.validation.name' }).max(120),
  recipientPhone: tlWhatsAppPhoneSchema,
  recipientLang: languageSchema,
});

/** Prohibited-items gate: every line must be explicitly confirmed (SOP §3.1). */
export const PROHIBITED_CHECKLIST_KEYS = [
  'narcotics',
  'weapons_sharp',
  'fuel_flammable',
  'cash_gold_jewelry',
  'protected_wildlife',
  'untaxed_contraband',
  'raw_perishables',
] as const;

export const prohibitedChecklistSchema = z.object(
  Object.fromEntries(PROHIBITED_CHECKLIST_KEYS.map((k) => [k, z.literal(true)])) as Record<
    (typeof PROHIBITED_CHECKLIST_KEYS)[number],
    z.ZodLiteral<true>
  >,
);

export const parcelDimensionsSchema = z.object({
  actualWeightKg: z.number().positive().max(500),
  lengthCm: z.number().positive().max(500),
  widthCm: z.number().positive().max(500),
  heightCm: z.number().positive().max(500),
});

export type SenderKyc = z.infer<typeof senderKycSchema>;
export type Recipient = z.infer<typeof recipientSchema>;
export type ParcelDimensions = z.infer<typeof parcelDimensionsSchema>;
