import { randomBytes } from 'node:crypto';
import { yymmddDili } from '@670send/pricing';

// Crockford base32 without I L O U: no look-alike characters on handwritten / printed labels.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function randomCode(length: number): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i]! % 32];
  return out;
}

/** Master bag QR payload, e.g. MB-261121-7K3M9Q */
export const newBagCode = (now = new Date()) => `MB-${yymmddDili(now)}-${randomCode(6)}`;
/** Fleet manifest QR payload, e.g. MF-261121-4FQ8TD */
export const newManifestCode = (now = new Date()) => `MF-${yymmddDili(now)}-${randomCode(6)}`;
/** Pick-up booking batch, e.g. PB-261121-9XQ2HC */
export const newBookingCode = (now = new Date()) => `PB-${yymmddDili(now)}-${randomCode(6)}`;
/** Tamper-evident seal serial when the kiosk does not scan a pre-printed one, e.g. SEG-8H2K9PQ4 */
export const newSealCode = () => `SEG-${randomCode(8)}`;
