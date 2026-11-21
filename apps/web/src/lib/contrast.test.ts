import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** WCAG 2.x contrast ratio of two #rrggbb colours. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
const ratio = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

// Read the real tokens, so changing a colour in globals.css re-runs this check.
const css = readFileSync(join(import.meta.dirname, '../app/globals.css'), 'utf8');
const token = (name: string) => {
  const m = new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css);
  if (!m) throw new Error(`token ${name} not found in globals.css`);
  return m[1]!;
};
const WHITE = '#ffffff';
const SLATE_600 = '#475569';
const SLATE_700 = '#334155';
const SLATE_500 = '#64748b'; // placeholder text
const SLATE_800 = '#1e293b';
const RED_700 = '#b91c1c';
const RED_900 = '#7f1d1d';
const AMBER_50 = '#fffbeb';

describe('colour contrast of the real design tokens (WCAG AA: 4.5:1 for normal text)', () => {
  const AA = 4.5;
  const pairs: Array<[string, string, string]> = [
    ['body text on white', SLATE_800, WHITE],
    ['secondary text on white', SLATE_600, WHITE],
    ['placeholder on white', SLATE_500, WHITE],
    ['white on primary button', WHITE, token('brand-700')],
    ['white on primary button (hover)', WHITE, token('brand-800')],
    ['white on accent button', WHITE, token('accent-600')],
    ['white on accent button (hover)', WHITE, token('accent-700')],
    ['accent link on white', token('accent-600'), WHITE],
    ['accent text on accent tint', token('accent-600'), token('accent-50')],
    ['brand heading on white', token('brand-800'), WHITE],
    ['brand-700 text on brand tint', token('brand-700'), token('brand-50')],
    ['hero subtitle on brand-700', token('brand-100'), token('brand-700')],
    ['header nav (white) on brand-700', WHITE, token('brand-700')],
    ['footer text on brand-900', token('brand-100'), token('brand-900')],
    ['footer copyright on brand-900', token('brand-200'), token('brand-900')],
    ['CTA band text on brand-800', token('brand-100'), token('brand-800')],
    ['error text on white', RED_700, WHITE],
    ['error banner text', RED_900, '#fef2f2'],
    ['warning banner text', SLATE_800, AMBER_50],
    ['step label (pending) on white', SLATE_600, WHITE],
    ['chips: slate-800 on slate-100', SLATE_800, '#f1f5f9'],
    ['chips: brand-800 on brand-100', token('brand-800'), token('brand-100')],
    ['accent-700 heading on white', token('accent-700'), WHITE],
  ];
  it.each(pairs)('%s', (_name, fg, bg) => expect(ratio(fg, bg)).toBeGreaterThanOrEqual(AA));

  it('documents WHY the logo orange is never used for small text', () => {
    expect(ratio(token('accent-500'), WHITE)).toBeLessThan(AA); // #E6511A on white fails → decorative / large only
    expect(ratio(SLATE_700, WHITE)).toBeGreaterThan(AA);
  });
});
