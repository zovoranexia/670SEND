export type ScanKind = 'WAYBILL' | 'BAG' | 'MANIFEST' | 'BOOKING';
export interface Scanned {
  kind: ScanKind;
  code: string;
}

// Codes use Crockford base32 (no I, L, O, U) so they survive being read aloud or hand-copied.
const PATTERNS: Array<[ScanKind, RegExp]> = [
  ['WAYBILL', /670S-[A-Z]{3}-[A-Z]{3}-\d{6}-\d{4}/],
  ['BAG', /MB-\d{6}-[0-9A-HJKMNP-TV-Z]{6}/],
  ['MANIFEST', /MF-\d{6}-[0-9A-HJKMNP-TV-Z]{6}/],
  ['BOOKING', /PB-\d{6}-[0-9A-HJKMNP-TV-Z]{6}/],
];

/**
 * Find a 670Send code inside whatever a QR / barcode / typed text contains: a bare code, a tracking link
 * (".../track?no=670S-…"), or a code surrounded by spaces. Lowercase and typographic dashes are tolerated.
 */
export function parseScanned(raw: string): Scanned | null {
  const text = raw
    .replace(/[‐-―−]/g, '-')
    .toUpperCase();
  for (const [kind, re] of PATTERNS) {
    const m = re.exec(text);
    if (m) return { kind, code: m[0] };
  }
  return null;
}

/** Restrict a scan to what the current screen can use. */
export function parseScannedAs(raw: string, kinds: readonly ScanKind[]): Scanned | null {
  const s = parseScanned(raw);
  return s && kinds.includes(s.kind) ? s : null;
}

/* ----------------------------------------------------------------------------------------- camera decode */

interface Detector {
  detect(source: CanvasImageSource): Promise<Array<{ rawValue: string }>>;
}
declare global {
  interface Window {
    BarcodeDetector?: new (opts?: { formats?: string[] }) => Detector;
  }
}

/** A function that looks at the current video frame and returns the text of a code, if any. */
export type FrameReader = (video: HTMLVideoElement) => Promise<string | null>;

/** Native BarcodeDetector where it exists (fast, handles Code128 too); jsQR (QR only) everywhere else. */
export async function createFrameReader(): Promise<FrameReader> {
  if (typeof window !== 'undefined' && window.BarcodeDetector) {
    try {
      const detector = new window.BarcodeDetector({ formats: ['qr_code', 'code_128'] });
      return async (video) => (await detector.detect(video))[0]?.rawValue ?? null;
    } catch {
      /* unsupported format list: fall through to jsQR */
    }
  }
  const { default: jsQR } = await import('jsqr');
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  return async (video) => {
    if (!ctx || !video.videoWidth) return null;
    // Downscale: decoding a 1080p frame several times a second is wasted effort on a budget phone.
    const scale = Math.min(1, 640 / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return jsQR(data.data, data.width, data.height, { inversionAttempts: 'dontInvert' })?.data ?? null;
  };
}
