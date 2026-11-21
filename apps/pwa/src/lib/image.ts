/**
 * Camera photos are 3–8 MB; the server accepts 2 MiB and the agent pays for mobile data. Every photo is decoded
 * (respecting the camera's rotation flag), shrunk and re-encoded as JPEG until it is small enough. Re-encoding
 * through a canvas also strips EXIF metadata (GPS position of the kiosk, device model) from the stored evidence.
 */
export interface CompressOptions {
  /** Longest edge in pixels. 1600 px keeps text on a label and box contents legible. */
  maxEdge: number;
  /** Target size. */
  maxBytes: number;
  /** Never upload more than this, even as a last resort (the API limit is 2 MiB by default). */
  hardMaxBytes: number;
  startQuality: number;
  minQuality: number;
}

export const PHOTO_DEFAULTS: CompressOptions = { maxEdge: 1600, maxBytes: 900_000, hardMaxBytes: 2_000_000, startQuality: 0.8, minQuality: 0.45 };
const MIN_EDGE = 640;
const QUALITY_STEP = 0.1;
const EDGE_SHRINK = 0.8;

export interface Decoded {
  width: number;
  height: number;
  close?: () => void;
}
export interface Codec {
  decode(blob: Blob): Promise<Decoded>;
  encode(img: Decoded, width: number, height: number, quality: number): Promise<Blob>;
}

export interface CompressedPhoto {
  blob: Blob;
  width: number;
  height: number;
  quality: number;
  originalBytes: number;
}

export class PhotoError extends Error {
  constructor(public readonly reason: 'not_an_image' | 'too_large' | 'decode_failed') {
    super(reason);
    this.name = 'PhotoError';
  }
}

/** Scale to fit within `maxEdge` on the longer side; never enlarges. */
export function fitWithin(width: number, height: number, maxEdge: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };
  const k = maxEdge / longest;
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

export async function compressPhoto(file: Blob, options: Partial<CompressOptions> = {}, codec: Codec = browserCodec): Promise<CompressedPhoto> {
  const o = { ...PHOTO_DEFAULTS, ...options };
  if (file.type && !file.type.startsWith('image/')) throw new PhotoError('not_an_image');

  let img: Decoded;
  try {
    img = await codec.decode(file);
  } catch {
    throw new PhotoError('decode_failed');
  }
  try {
    let best: CompressedPhoto | null = null;
    let edge = Math.min(o.maxEdge, Math.max(img.width, img.height));
    for (;;) {
      const { width, height } = fitWithin(img.width, img.height, edge);
      for (let quality = o.startQuality; quality >= o.minQuality - 1e-9; quality -= QUALITY_STEP) {
        const blob = await codec.encode(img, width, height, quality);
        const candidate = { blob, width, height, quality: Math.round(quality * 100) / 100, originalBytes: file.size };
        if (!best || blob.size < best.blob.size) best = candidate;
        if (blob.size <= o.maxBytes) return candidate;
      }
      if (edge <= MIN_EDGE) break;
      edge = Math.max(MIN_EDGE, Math.round(edge * EDGE_SHRINK));
    }
    if (!best || best.blob.size > o.hardMaxBytes) throw new PhotoError('too_large');
    return best;
  } finally {
    img.close?.();
  }
}

/* ------------------------------------------------------------------------------------------ browser codec */

export const browserCodec: Codec = {
  async decode(blob) {
    if (typeof createImageBitmap === 'function') {
      // 'from-image' applies the camera's EXIF rotation, so portrait shots are not saved sideways.
      return createImageBitmap(blob, { imageOrientation: 'from-image' });
    }
    const url = URL.createObjectURL(blob);
    try {
      const el = new Image();
      el.src = url;
      await el.decode();
      return Object.assign(el, { width: el.naturalWidth, height: el.naturalHeight }) as Decoded;
    } finally {
      URL.revokeObjectURL(url);
    }
  },
  encode(img, width, height, quality) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return Promise.reject(new Error('canvas unavailable'));
    ctx.fillStyle = '#fff'; // JPEG has no transparency
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img as unknown as CanvasImageSource, 0, 0, width, height);
    return new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), 'image/jpeg', quality));
  },
};

/** "412 KB" for the on-screen confirmation. */
export const kb = (bytes: number) => Math.max(1, Math.round(bytes / 1024));
