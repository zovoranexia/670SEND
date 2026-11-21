import type { QuoteRequest } from './api';
import { parseDecimal } from './format';

/** Raw form values exactly as typed (strings), so "2,5" and half-typed numbers do not fight the user. */
export interface CalcForm {
  origin: string;
  dest: string;
  scheme: QuoteRequest['scheme'];
  weight: string;
  length: string;
  width: string;
  height: string;
  category: string;
  fragile: boolean;
  heavyBulk: boolean;
  insure: boolean;
  declared: string;
}

export const DEFAULT_FORM: CalcForm = {
  origin: 'DIL',
  dest: 'BCU',
  scheme: 'SCHEME_A',
  weight: '2',
  length: '30',
  width: '20',
  height: '10',
  category: 'GENERAL',
  fragile: false,
  heavyBulk: false,
  insure: false,
  declared: '',
};

export type FieldKey = 'weight' | 'length' | 'width' | 'height' | 'declared' | 'route';
/** Error = which i18n key under `web.form` / `web.calculator` to show, plus its parameters. */
export type FieldError = { key: 'required' | 'number' | 'positive' | 'max' | 'sameRoute' | 'needDili'; params?: Record<string, number> };

const MAX_DIM = 500; // API limit (parcelDimensionsSchema)
const MAX_DECLARED = 100000; // sanity bound; insurance itself is capped at USD 500 server-side

export type BuildResult = { ok: true; request: QuoteRequest } | { ok: false; errors: Partial<Record<FieldKey, FieldError>> };

function positive(raw: string, max: number): { value: number } | { error: FieldError } {
  if (raw.trim() === '') return { error: { key: 'required' } };
  const n = parseDecimal(raw);
  if (n === null) return { error: { key: 'number' } };
  if (n <= 0) return { error: { key: 'positive' } };
  if (n > max) return { error: { key: 'max', params: { max } } };
  return { value: n };
}

/** Validate the form like the API does, and build the quote request. Same limits, so the API never says no to a form we accepted. */
export function buildQuoteRequest(f: CalcForm): BuildResult {
  const errors: Partial<Record<FieldKey, FieldError>> = {};

  if (f.origin === f.dest) errors.route = { key: 'sameRoute' };
  else if (f.origin !== 'DIL' && f.dest !== 'DIL') errors.route = { key: 'needDili' };

  const parsed = {
    weight: positive(f.weight, MAX_DIM),
    length: positive(f.length, MAX_DIM),
    width: positive(f.width, MAX_DIM),
    height: positive(f.height, MAX_DIM),
  };
  for (const k of ['weight', 'length', 'width', 'height'] as const) {
    const p = parsed[k];
    if ('error' in p) errors[k] = p.error;
  }

  let declared: number | undefined;
  if (f.insure) {
    const p = positive(f.declared, MAX_DECLARED);
    if ('error' in p) errors.declared = p.error;
    else declared = p.value;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const num = (p: ReturnType<typeof positive>) => (p as { value: number }).value;
  return {
    ok: true,
    request: {
      originMunicipalityCode: f.origin,
      destMunicipalityCode: f.dest,
      scheme: f.scheme,
      parcel: { actualWeightKg: num(parsed.weight), lengthCm: num(parsed.length), widthCm: num(parsed.width), heightCm: num(parsed.height) },
      itemCategory: f.category,
      isFragile: f.fragile,
      isHeavyBulk: f.heavyBulk,
      insure: f.insure,
      ...(declared !== undefined ? { declaredValueUsd: declared.toFixed(2) } : {}),
    },
  };
}
