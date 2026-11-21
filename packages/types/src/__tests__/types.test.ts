import { describe, expect, it } from 'vitest';
import {
  ALL_PERMISSION_KEYS,
  HUBS,
  MUNICIPALITIES,
  ROLE_KEYS,
  ROLE_PERMISSIONS,
  hasPermission,
  isSeaMunicipality,
  normalizeLocale,
  pickLocaleFromAcceptLanguage,
} from '../index';

describe('geography', () => {
  it('has 14 municipalities with unique 3-letter codes', () => {
    expect(MUNICIPALITIES).toHaveLength(14);
    expect(new Set(MUNICIPALITIES.map((m) => m.code)).size).toBe(14);
    for (const m of MUNICIPALITIES) expect(m.code).toMatch(/^[A-Z]{3}$/);
  });
  it('flags only Oecusse and Ataúro as sea routes', () => {
    expect(MUNICIPALITIES.filter((m) => m.isSeaRoute).map((m) => m.code).sort()).toEqual(['ATA', 'OEC']);
    expect(isSeaMunicipality('oec')).toBe(true);
    expect(isSeaMunicipality('BCU')).toBe(false);
  });
  it('has the 4 Dili hubs', () => expect(HUBS).toHaveLength(4));
});

describe('rbac', () => {
  it('has 8 roles and only references known permissions', () => {
    expect(ROLE_KEYS).toHaveLength(8);
    const known = new Set<string>(ALL_PERMISSION_KEYS);
    for (const role of ROLE_KEYS) {
      for (const g of ROLE_PERMISSIONS[role]) {
        if (g !== '*:*') expect(known.has(g), `${role}: ${g}`).toBe(true);
      }
    }
  });
  it('enforces the segregation-of-duties rules from the spec', () => {
    expect(hasPermission(ROLE_PERMISSIONS.OPS_HUB_ADMIN, 'deposits:approve')).toBe(false);
    expect(hasPermission(ROLE_PERMISSIONS.OPS_HUB_ADMIN, 'payouts:approve')).toBe(false);
    expect(hasPermission(ROLE_PERMISSIONS.FINANCE_ADMIN, 'shipments:override_status')).toBe(false);
    expect(hasPermission(ROLE_PERMISSIONS.DRIVER, 'wallets:read_own')).toBe(false);
    expect(hasPermission(ROLE_PERMISSIONS.SUPER_ADMIN, 'anything:at_all')).toBe(true);
  });
});

describe('locale', () => {
  it('falls back to Tetun', () => {
    expect(normalizeLocale('de')).toBe('tet');
    expect(normalizeLocale(undefined)).toBe('tet');
    expect(normalizeLocale('pt-TL')).toBe('pt');
    expect(pickLocaleFromAcceptLanguage('fr-FR,fr;q=0.9')).toBe('tet');
    expect(pickLocaleFromAcceptLanguage('en-US,en;q=0.8,id;q=0.5')).toBe('en');
    expect(pickLocaleFromAcceptLanguage('in;q=0.9')).toBe('id');
  });
});
