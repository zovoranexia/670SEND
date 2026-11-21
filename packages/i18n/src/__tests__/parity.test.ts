import { describe, expect, it } from 'vitest';
import { NOTIFICATION_EVENT_CODES, NOTIFICATION_VARIABLES, LOCALES } from '@670send/types';
import {
  NAMESPACES,
  WHATSAPP_TEMPLATES,
  extractTemplateVariables,
  flattenKeys,
  messages,
  renderTemplate,
  t,
} from '../index';

const base = flattenKeys(messages.tet).sort();

describe('dictionary parity', () => {
  it('exposes every required namespace in Tetun', () => {
    expect(Object.keys(messages.tet).sort()).toEqual([...NAMESPACES].sort());
  });

  for (const locale of LOCALES) {
    it(`${locale} has exactly the same keys as tet`, () => {
      expect(flattenKeys(messages[locale]).sort()).toEqual(base);
    });

    it(`${locale} has no empty strings`, () => {
      const empty = flattenKeys(messages[locale]).filter((k) => t(locale, k).trim() === '');
      expect(empty).toEqual([]);
    });
  }
});

describe('whatsapp templates', () => {
  for (const code of NOTIFICATION_EVENT_CODES) {
    for (const locale of LOCALES) {
      it(`${code}/${locale} exists and only uses allowed variables`, () => {
        const body = WHATSAPP_TEMPLATES[code][locale];
        expect(body.trim().length).toBeGreaterThan(10);
        const allowed = new Set(NOTIFICATION_VARIABLES[code]);
        for (const v of extractTemplateVariables(body)) {
          expect(allowed.has(v), `${code}/${locale} uses {{${v}}}`).toBe(true);
        }
      });
    }

    it(`${code} uses the same variable set in all 4 languages`, () => {
      const sets = LOCALES.map((l) =>
        extractTemplateVariables(WHATSAPP_TEMPLATES[code][l]).sort().join(','),
      );
      expect(new Set(sets).size).toBe(1);
    });
  }

  it('ARRIVED_AT_DEST_AGENT always carries the OTP', () => {
    for (const l of LOCALES) expect(WHATSAPP_TEMPLATES.ARRIVED_AT_DEST_AGENT[l]).toContain('{{otp}}');
  });

  it('renders placeholders and leaves unknown ones visible', () => {
    expect(renderTemplate('Resi *{{waybill}}* {{x}}', { waybill: '670S-DIL-BCU-261121-0042' })).toBe(
      'Resi *670S-DIL-BCU-261121-0042* {{x}}',
    );
  });
});

describe('t()', () => {
  it('falls back to the key when missing', () => {
    expect(t('pt', 'nope.nothing')).toBe('nope.nothing');
  });
  it('translates', () => {
    expect(t('id', 'errors.invalid_otp')).toBe('Kode OTP salah.');
  });
});
