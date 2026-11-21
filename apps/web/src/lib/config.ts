/** Public build-time configuration (NEXT_PUBLIC_* only — this app holds no secrets). */

const trimSlash = (v: string) => v.replace(/\/+$/, '');

export const WEB_URL = trimSlash(process.env.NEXT_PUBLIC_WEB_URL || 'http://localhost:3100');
export const API_URL = trimSlash(process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4010');

/** WhatsApp support number, digits only ("6707XXXXXXX"). Empty → the link is simply not rendered. */
export const SUPPORT_WHATSAPP = (process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP ?? '').replace(/\D/g, '');

export const MAP = {
  tileUrl: process.env.NEXT_PUBLIC_MAP_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: process.env.NEXT_PUBLIC_MAP_ATTRIBUTION || '© OpenStreetMap contributors',
  /** Timor-Leste incl. Oecusse and Jaco island; the pin cannot be dropped outside. */
  bounds: { south: -9.55, west: 124.0, north: -8.1, east: 127.4 },
  /** Díli. */
  center: { lat: -8.5569, lng: 125.5603 },
  zoom: 12,
} as const;
