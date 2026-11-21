import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, vi } from 'vitest';

// Next / next-intl navigation need the Next runtime; tests drive them through these small stand-ins.
export const nav = { search: '', replace: vi.fn(), pathname: '/' };

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(nav.search),
}));

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string | { pathname: string; query?: Record<string, string> }; children?: ReactNode } & Record<string, unknown>) => {
    const url = typeof href === 'string' ? href : `${href.pathname}${href.query ? `?${new URLSearchParams(href.query)}` : ''}`;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { locale: _locale, ...anchor } = rest;
    return createElement('a', { href: url, ...anchor }, children);
  },
  useRouter: () => ({ replace: nav.replace, push: vi.fn() }),
  usePathname: () => nav.pathname,
}));

// Leaflet needs a real browser layout engine; the form tests only care about the pin value that flows through.
vi.mock('@/components/booking/pin-map-loader', () => ({
  PinMap: ({ value, onChange }: { value: { lat: number; lng: number } | null; onChange: (p: { lat: number; lng: number }) => void }) =>
    createElement('button', { type: 'button', 'data-testid': 'fake-map', onClick: () => onChange({ lat: -8.5569, lng: 125.5603 }) }, value ? `${value.lat},${value.lng}` : 'map'),
}));

afterEach(() => {
  cleanup();
  nav.search = '';
  nav.pathname = '/';
  nav.replace.mockReset();
});
