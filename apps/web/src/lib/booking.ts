import { tlWhatsAppPhoneSchema } from '@670send/validation';
import type { Locale } from '@670send/types';
import type { BookingRequest } from './api';
import { MAP } from './config';
import { parseDecimal } from './format';

export interface BookingForm {
  name: string;
  phone: string;
  lang: Locale;
  scheme: 'SCHEME_B' | 'SCHEME_D';
  dest: string; // '' = not sure yet
  count: string;
  weight: string;
  address: string;
  notes: string;
  pin: { lat: number; lng: number } | null;
}

export const emptyBooking = (lang: Locale): BookingForm => ({ name: '', phone: '', lang, scheme: 'SCHEME_B', dest: '', count: '1', weight: '', address: '', notes: '', pin: null });

export type BookingField = 'name' | 'phone' | 'count' | 'weight' | 'address' | 'notes' | 'pin';
export type BookingError = { key: 'name' | 'phone' | 'required' | 'number' | 'positive' | 'max' | 'minChars' | 'outsideTL'; params?: Record<string, number> };

export function isInsideTL(lat: number, lng: number): boolean {
  const b = MAP.bounds;
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= b.south && lat <= b.north && lng >= b.west && lng <= b.east;
}

export type BookingBuild = { ok: true; request: BookingRequest } | { ok: false; errors: Partial<Record<BookingField, BookingError>> };

/** Same rules as the API's booking schema (shared phone validator, same limits). */
export function buildBookingRequest(f: BookingForm): BookingBuild {
  const errors: Partial<Record<BookingField, BookingError>> = {};

  const name = f.name.trim();
  if (name.length < 3) errors.name = { key: 'name' };

  const phone = tlWhatsAppPhoneSchema.safeParse(f.phone);
  if (!phone.success) errors.phone = { key: 'phone' };

  const count = Number(f.count.trim());
  if (f.count.trim() === '') errors.count = { key: 'required' };
  else if (!Number.isInteger(count)) errors.count = { key: 'number' };
  else if (count < 1) errors.count = { key: 'positive' };
  else if (count > 50) errors.count = { key: 'max', params: { max: 50 } };

  let weight: number | undefined;
  if (f.weight.trim() !== '') {
    const w = parseDecimal(f.weight);
    if (w === null) errors.weight = { key: 'number' };
    else if (w <= 0) errors.weight = { key: 'positive' };
    else if (w > 500) errors.weight = { key: 'max', params: { max: 500 } };
    else weight = w;
  }

  const address = f.address.trim();
  if (address.length < 5) errors.address = { key: 'minChars', params: { min: 5 } };
  else if (address.length > 300) errors.address = { key: 'max', params: { max: 300 } };

  if (f.notes.trim().length > 300) errors.notes = { key: 'max', params: { max: 300 } };

  if (f.pin && !isInsideTL(f.pin.lat, f.pin.lng)) errors.pin = { key: 'outsideTL' };

  if (Object.keys(errors).length > 0 || !phone.success) return { ok: false, errors };

  return {
    ok: true,
    request: {
      senderName: name,
      senderPhone: phone.data,
      preferredLang: f.lang,
      scheme: f.scheme,
      ...(f.dest ? { destMunicipalityCode: f.dest } : {}),
      parcelCount: count,
      ...(weight !== undefined ? { estimatedWeightKg: weight } : {}),
      pickupAddress: address,
      ...(f.pin ? { lat: Number(f.pin.lat.toFixed(6)), lng: Number(f.pin.lng.toFixed(6)) } : {}),
      ...(f.notes.trim() ? { notes: f.notes.trim() } : {}),
    },
  };
}
