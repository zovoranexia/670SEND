import { LOCALES, SERVICE_SCHEME_META, type Locale } from '@670send/types';
import { PROHIBITED_CHECKLIST_KEYS, tlWhatsAppPhoneSchema } from '@670send/validation';
import type { FieldProfile, IntakeBody, QuoteRequest, Scheme } from './types';

export const STEPS = 5;
export type Step = 1 | 2 | 3 | 4 | 5;
export type PhotoSlot = 'open' | 'sealed';

export interface Draft {
  step: Step;
  destCode: string;
  destAgentId: string;
  scheme: Scheme;
  pickupBookingId: string;
  sender: { name: string; idType: 'BI' | 'KARTAUN_ELEITORAL' | 'PASSPORT'; idNumber: string; phone: string; lang: Locale; address: string };
  recipient: { name: string; phone: string; lang: Locale; address: string };
  checklist: Record<(typeof PROHIBITED_CHECKLIST_KEYS)[number], boolean>;
  /** Server-side upload ids (the pictures themselves are never kept on the phone). */
  photos: Partial<Record<PhotoSlot, string>>;
  item: { description: string; category: string; fragile: boolean; heavy: boolean; declared: string };
  parcel: { weight: string; length: string; width: string; height: string };
  insure: boolean;
}

export const emptyChecklist = () => Object.fromEntries(PROHIBITED_CHECKLIST_KEYS.map((k) => [k, false])) as Draft['checklist'];

export function emptyDraft(defaults: { scheme: Scheme; lang: Locale }): Draft {
  return {
    step: 1,
    destCode: '',
    destAgentId: '',
    scheme: defaults.scheme,
    pickupBookingId: '',
    sender: { name: '', idType: 'BI', idNumber: '', phone: '', lang: defaults.lang, address: '' },
    recipient: { name: '', phone: '', lang: defaults.lang, address: '' },
    checklist: emptyChecklist(),
    photos: {},
    item: { description: '', category: 'GENERAL', fragile: false, heavy: false, declared: '' },
    parcel: { weight: '', length: '', width: '', height: '' },
    insure: false,
  };
}

/** A kiosk takes drop-offs (schemes without pick-up); a courier collects at the door (schemes with pick-up). */
export function schemesFor(kind: FieldProfile['kind']): Scheme[] {
  const wantsPickup = kind === 'COURIER';
  return (['SCHEME_A', 'SCHEME_B', 'SCHEME_C', 'SCHEME_D'] as const).filter((s) => SERVICE_SCHEME_META[s].pickup === wantsPickup);
}
export const hasDoorDelivery = (s: Scheme) => SERVICE_SCHEME_META[s].delivery;

/* -------------------------------------------------------------------------------------------- validation */

export type ErrKey = 'required' | 'number' | 'positive' | 'max' | 'minChars' | 'phone' | 'name' | 'checklist' | 'photos' | 'kiosk' | 'pin';
export type FieldError = { key: ErrKey; params?: Record<string, number> };
export type Errors = Record<string, FieldError>;

const MAX_DIM = 500;
const num = (raw: string): number | null => {
  const s = raw.trim().replace(',', '.');
  return /^\d+(\.\d+)?$/.test(s) ? Number(s) : null;
};
function positive(raw: string, max: number): FieldError | null {
  if (raw.trim() === '') return { key: 'required' };
  const n = num(raw);
  if (n === null) return { key: 'number' };
  if (n <= 0) return { key: 'positive' };
  if (n > max) return { key: 'max', params: { max } };
  return null;
}
const phoneOk = (p: string) => tlWhatsAppPhoneSchema.safeParse(p).success;

export interface StepContext {
  /** Number of active kiosks in the destination municipality (null = not loaded yet). */
  kioskCount: number | null;
}

/** Errors that block leaving a step. Keys are the field ids used by the form (`sender.name`, `parcel.weight`, …). */
export function validateStep(step: Step, d: Draft, ctx: StepContext): Errors {
  const e: Errors = {};
  if (step === 1) {
    if (!d.destCode) e['destCode'] = { key: 'required' };
    if (d.destCode && ctx.kioskCount === 0) e['destAgentId'] = { key: 'kiosk' };
    else if (d.destCode && (ctx.kioskCount ?? 0) > 1 && !d.destAgentId) e['destAgentId'] = { key: 'required' };
    if (d.sender.name.trim().length < 3) e['sender.name'] = { key: 'name' };
    if (d.sender.idNumber.trim().length < 4) e['sender.idNumber'] = { key: 'minChars', params: { min: 4 } };
    if (!phoneOk(d.sender.phone)) e['sender.phone'] = { key: 'phone' };
    if (d.recipient.name.trim().length < 2) e['recipient.name'] = { key: 'name' };
    if (!phoneOk(d.recipient.phone)) e['recipient.phone'] = { key: 'phone' };
    if (hasDoorDelivery(d.scheme) && d.recipient.address.trim().length < 5) e['recipient.address'] = { key: 'minChars', params: { min: 5 } };
  }
  if (step === 2) {
    if (!PROHIBITED_CHECKLIST_KEYS.every((k) => d.checklist[k] === true)) e['checklist'] = { key: 'checklist' };
    if (!d.photos.open || !d.photos.sealed) e['photos'] = { key: 'photos' };
  }
  if (step === 3) {
    if (d.item.description.trim().length < 2) e['item.description'] = { key: 'minChars', params: { min: 2 } };
    for (const k of ['weight', 'length', 'width', 'height'] as const) {
      const err = positive(d.parcel[k], MAX_DIM);
      if (err) e[`parcel.${k}`] = err;
    }
    if (d.insure) {
      const err = positive(d.item.declared, 100_000);
      if (err) e['item.declared'] = err;
    }
  }
  return e;
}

export const firstInvalidStep = (d: Draft, ctx: StepContext): Step | null => (([1, 2, 3] as const).find((s) => Object.keys(validateStep(s, d, ctx)).length > 0) ?? null) as Step | null;

export const pinValid = (pin: string) => /^\d{6}$/.test(pin);

/* ---------------------------------------------------------------------------------------- request builders */

export function buildQuoteRequest(d: Draft, originCode: string): QuoteRequest | null {
  const w = num(d.parcel.weight), l = num(d.parcel.length), wd = num(d.parcel.width), h = num(d.parcel.height);
  if (!d.destCode || w === null || l === null || wd === null || h === null) return null;
  let declared: string | undefined;
  if (d.insure) {
    const v = num(d.item.declared);
    if (v === null || v <= 0) return null;
    declared = v.toFixed(2);
  }
  return {
    originMunicipalityCode: originCode,
    destMunicipalityCode: d.destCode,
    scheme: d.scheme,
    parcel: { actualWeightKg: w, lengthCm: l, widthCm: wd, heightCm: h },
    itemCategory: d.item.category,
    isFragile: d.item.fragile,
    isHeavyBulk: d.item.heavy,
    insure: d.insure,
    ...(declared ? { declaredValueUsd: declared } : {}),
  };
}

/**
 * The exact body of POST /v1/shipments. `checklistLang` is the language the agent read the prohibited-items list
 * in (the app's current language) — it is stored with the waybill as part of the sender's declaration.
 */
export function buildIntakeBody(d: Draft, pin: string, checklistLang: Locale): IntakeBody {
  const q = buildQuoteRequest(d, 'XXX');
  if (!q) throw new Error('draft is incomplete');
  const trim = (s: string) => s.trim();
  return {
    scheme: d.scheme,
    destMunicipalityCode: d.destCode,
    ...(d.destAgentId ? { destAgentId: d.destAgentId } : {}),
    ...(d.pickupBookingId ? { pickupBookingId: d.pickupBookingId } : {}),
    sender: { name: trim(d.sender.name), idType: d.sender.idType, idNumber: trim(d.sender.idNumber), phone: d.sender.phone, lang: d.sender.lang, ...(trim(d.sender.address) ? { address: trim(d.sender.address) } : {}) },
    recipient: { name: trim(d.recipient.name), phone: d.recipient.phone, lang: d.recipient.lang, ...(trim(d.recipient.address) ? { address: trim(d.recipient.address) } : {}) },
    item: { description: trim(d.item.description), category: d.item.category, isFragile: d.item.fragile, isHeavyBulk: d.item.heavy, ...(q.declaredValueUsd ? { declaredValueUsd: q.declaredValueUsd } : {}) },
    parcel: q.parcel,
    insure: d.insure,
    prohibitedChecklist: Object.fromEntries(PROHIBITED_CHECKLIST_KEYS.map((k) => [k, true])) as Record<string, true>,
    checklistLang: LOCALES.includes(checklistLang) ? checklistLang : 'tet',
    photoUploadIds: [d.photos.open!, d.photos.sealed!],
    pin,
  };
}

/* ------------------------------------------------------------------------------------------------- draft */

const DRAFT_KEY = '670send.draft.';
const DRAFT_VERSION = 1;

/** Unfinished parcels survive an accidental reload or a phone call; they are cleared on sign-out and when the app is closed. */
export function loadDraft(userId: string): Draft | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY + userId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { v: number; draft: Draft };
    return parsed.v === DRAFT_VERSION ? parsed.draft : null;
  } catch {
    return null;
  }
}
export function saveDraft(userId: string, d: Draft): void {
  try {
    sessionStorage.setItem(DRAFT_KEY + userId, JSON.stringify({ v: DRAFT_VERSION, draft: d }));
  } catch {
    /* storage full / private mode: the draft is simply not kept */
  }
}
export function clearDraft(userId: string): void {
  try {
    sessionStorage.removeItem(DRAFT_KEY + userId);
  } catch {
    /* ignore */
  }
}
export const isPristine = (d: Draft) => !d.destCode && !d.sender.name && !d.recipient.name && !d.photos.open && !d.parcel.weight;
