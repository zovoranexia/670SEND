import iconv from 'iconv-lite';

/** 58 mm thermal printers: 384 dots → 32 characters per line in Font A. */
export const LINE_WIDTH = 32;

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

/** Characters CP858 cannot print are mapped to the closest printable ASCII. */
export function sanitizeForPrinter(text: string): string {
  return text
    .replace(/[–—−]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, '...')
    .replace(/•/g, '*')
    .replace(/≤/g, '<=')
    .replace(/≥/g, '>=')
    .replace(/×/g, 'x')
    .replace(/[​-‍﻿]/g, '');
}

/** Greedy word wrap; words longer than the line are hard-broken. */
export function wrapText(text: string, width = LINE_WIDTH): string[] {
  const out: string[] = [];
  for (const paragraph of sanitizeForPrinter(text).split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      let w = word;
      while (w.length > width) {
        if (line) {
          out.push(line);
          line = '';
        }
        out.push(w.slice(0, width));
        w = w.slice(width);
      }
      if (!line) line = w;
      else if (line.length + 1 + w.length <= width) line += ` ${w}`;
      else {
        out.push(line);
        line = w;
      }
    }
    out.push(line);
  }
  return out;
}

/**
 * Minimal ESC/POS command builder (Epson-compatible, as used by 58 mm Bluetooth printers via Web
 * Bluetooth or the RawBT Android app). Text is encoded in CP858 (Western European + €), which
 * covers Tetun, Portuguese, English and Indonesian letters (í ã ç é ó ú …).
 * A plain-text mirror is kept for WhatsApp sharing and for screens without a printer.
 */
export class EscPosBuilder {
  private readonly chunks: Buffer[] = [];
  private readonly lines: string[] = [];

  private raw(...bytes: number[]): this {
    this.chunks.push(Buffer.from(bytes));
    return this;
  }

  /** Initialise printer, select code page CP858 (ESC t 19). */
  init(): this {
    return this.raw(ESC, 0x40).raw(ESC, 0x74, 19);
  }

  align(a: 'left' | 'center' | 'right'): this {
    return this.raw(ESC, 0x61, { left: 0, center: 1, right: 2 }[a]);
  }

  bold(on: boolean): this {
    return this.raw(ESC, 0x45, on ? 1 : 0);
  }

  /** Character magnification 1–4 (width, height). */
  size(width: 1 | 2 | 3 | 4, height: 1 | 2 | 3 | 4): this {
    return this.raw(GS, 0x21, ((width - 1) << 4) | (height - 1));
  }

  /** One printed line (already ≤ the width for the current size). */
  line(text: string): this {
    const clean = sanitizeForPrinter(text);
    this.chunks.push(iconv.encode(clean, 'cp858'), Buffer.from([LF]));
    this.lines.push(clean);
    return this;
  }

  /** Wrapped paragraph. */
  paragraph(text: string, width = LINE_WIDTH): this {
    for (const l of wrapText(text, width)) this.line(l);
    return this;
  }

  rule(char = '-'): this {
    return this.line(char.repeat(LINE_WIDTH));
  }

  /** `Label ........ value` with the value right-aligned; the label is truncated if needed. */
  columns(left: string, right: string, width = LINE_WIDTH): this {
    const l = sanitizeForPrinter(left);
    const r = sanitizeForPrinter(right);
    const room = Math.max(1, width - r.length - 1);
    return this.line(`${l.length > room ? l.slice(0, room) : l.padEnd(room)} ${r}`);
  }

  feed(n = 1): this {
    this.raw(ESC, 0x64, n);
    for (let i = 0; i < n; i++) this.lines.push('');
    return this;
  }

  /** Native QR code (GS ( k): model 2, error correction M. */
  qr(data: string, moduleSize = 6): this {
    const payload = Buffer.from(data, 'utf8');
    const len = payload.length + 3;
    this.raw(GS, 0x28, 0x6b, 4, 0, 0x31, 0x41, 0x32, 0); // model 2
    this.raw(GS, 0x28, 0x6b, 3, 0, 0x31, 0x43, Math.min(Math.max(moduleSize, 1), 16)); // module size
    this.raw(GS, 0x28, 0x6b, 3, 0, 0x31, 0x45, 0x31); // error correction M
    this.chunks.push(Buffer.from([GS, 0x28, 0x6b, len & 0xff, (len >> 8) & 0xff, 0x31, 0x50, 0x30]), payload); // store
    this.raw(GS, 0x28, 0x6b, 3, 0, 0x31, 0x51, 0x30); // print
    this.lines.push(`[QR: ${data}]`);
    return this;
  }

  /** Feed and partial cut. */
  cut(): this {
    return this.raw(GS, 0x56, 0x42, 0x00);
  }

  build(): Buffer {
    return Buffer.concat(this.chunks);
  }

  plainText(): string {
    return this.lines.join('\n');
  }
}
