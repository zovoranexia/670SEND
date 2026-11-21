import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';
import { LOCALE_STORAGE_KEY, type Locale } from '@670send/types';
import { App } from '@/App';
import { LocaleProvider } from '@/i18n';
import type { FieldProfile } from '@/lib/types';
import { json, mockApi, signIn, user, type Handler } from './helpers';

export const agentProfile: FieldProfile = { kind: 'AGENT', agentId: 'a-1', agentCode: 'AG-DIL-001', kioskName: 'Kios Colmera', address: 'Rua Colmera 1', openingHours: '08:00-18:00', municipality: { code: 'DIL', name: 'Díli' } };
export const courierProfile: FieldProfile = { kind: 'COURIER', courierId: 'c-1', isAvailable: true, vehicleType: 'MOTORBIKE', municipality: { code: 'DIL', name: 'Díli' }, hub: { code: 'HUB_BECORA', name: 'Terminal Becora' } };
export const driverProfile: FieldProfile = { kind: 'DRIVER', driverId: 'd-1', fleetPartner: { id: 'f-1', companyName: 'Transporte Lorosae Express' } };

export const wallets = [
  { id: 'w-1', type: 'DEPOSIT', balance: '100.0000', locked: '0.0000', available: '100.0000' },
  { id: 'w-2', type: 'COMMISSION', balance: '12.5000', locked: '0.0000', available: '12.5000' },
];

/** The two calls almost every screen makes. */
export const baseRoutes = (profile: FieldProfile): Record<string, Handler> => ({
  'GET /v1/field/profile': () => json(profile),
  'GET /v1/wallets/me': () => json(wallets),
});

/** Render a single component inside the locale provider (English) and a router. */
export function renderWithIntl(ui: ReactElement, lang: Locale = 'en') {
  localStorage.setItem(LOCALE_STORAGE_KEY, lang);
  return render(
    <MemoryRouter>
      <LocaleProvider>{ui}</LocaleProvider>
    </MemoryRouter>,
  );
}

interface Options {
  path?: string;
  /** Roles of the signed-in user; undefined = signed out. */
  roles?: string[] | null;
  lang?: Locale;
  profile?: FieldProfile;
  routes?: Record<string, Handler>;
}

/** Render the whole app (providers + routes) at a path, with a stubbed API, in English unless told otherwise. */
export function renderApp({ path = '/', roles = ['AGENT'], lang = 'en', profile = agentProfile, routes = {} }: Options = {}) {
  localStorage.setItem(LOCALE_STORAGE_KEY, lang);
  const api = mockApi({ ...baseRoutes(profile), ...routes });
  vi.stubGlobal('fetch', api.fn);
  if (roles) signIn(user({ lang, roles, scope: roles.includes('AGENT') ? { agentId: 'a-1' } : roles.includes('COURIER') ? { courierId: 'c-1' } : roles.includes('DRIVER') ? { driverId: 'd-1' } : {} }));
  const view = render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
  return { ...view, api };
}
