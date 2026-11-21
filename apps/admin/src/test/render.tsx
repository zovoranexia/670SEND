import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';
import { LOCALE_STORAGE_KEY, type Locale } from '@670send/types';
import { App } from '@/App';
import { LocaleProvider } from '@/i18n';
import type { PublicUser } from '@/lib/types';
import { mockApi, signIn, user, type Handler } from './helpers';

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
  /** The signed-in user; null = signed out. Defaults to a Super Admin. */
  as?: Partial<PublicUser> | null;
  lang?: Locale;
  routes?: Record<string, Handler>;
}

/** Render the whole console (providers + routes) at a path, with a stubbed API, in English unless told otherwise. */
export function renderApp({ path = '/', as = {}, lang = 'en', routes = {} }: Options = {}) {
  localStorage.setItem(LOCALE_STORAGE_KEY, lang);
  const api = mockApi(routes);
  vi.stubGlobal('fetch', api.fn);
  if (as) signIn(user({ lang, ...as }));
  const view = render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
  return { ...view, api };
}
