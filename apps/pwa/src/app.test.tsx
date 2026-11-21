import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiError, json, signIn, user } from '@/test/helpers';
import { agentProfile, courierProfile, driverProfile, renderApp } from '@/test/render';
import { sessionStore } from '@/lib/session';

afterEach(() => vi.unstubAllGlobals());
const tabs = () => within(screen.getByRole('navigation')).getAllByRole('link').map((a) => a.textContent?.trim());

describe('sign in', () => {
  const login = (over: Partial<ReturnType<typeof user>> = {}) => ({ accessToken: 'a', refreshToken: 'r', expiresIn: 900, user: user({ lang: 'en', ...over }) });

  it('asks for a valid phone and a 6-digit PIN before calling the server', async () => {
    const u = userEvent.setup({ delay: null });
    const { api } = renderApp({ roles: null });
    await u.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getAllByRole('alert').map((a) => a.textContent)).toEqual(expect.arrayContaining([expect.stringContaining('Invalid mobile number'), expect.stringContaining('6 digits')]));
    expect(api.calls).toHaveLength(0);
  });

  it('signs in with the normalised number, lands on the agent home and shows the float', async () => {
    const u = userEvent.setup({ delay: null });
    const { api } = renderApp({ roles: null, routes: { 'POST /v1/auth/login/pin': () => json(login()) } });
    await u.type(screen.getByLabelText('Mobile number'), '7712 3456');
    await u.type(screen.getByLabelText('PIN'), '482913');
    await u.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Hello, Maria')).toBeTruthy();
    expect(api.find('POST', '/v1/auth/login/pin')[0]!.body).toEqual({ phone: '+67077123456', pin: '482913' });
    expect(await screen.findByTestId('deposit')).toHaveTextContent('$100.00');
    expect(screen.getAllByText('Kios Colmera', { exact: false }).length).toBeGreaterThan(0); // header + home
  });

  it('shows the server’s own (translated) message for a wrong PIN or a locked account, and clears the PIN', async () => {
    const u = userEvent.setup({ delay: null });
    renderApp({ roles: null, routes: { 'POST /v1/auth/login/pin': () => apiError(423, 'account_locked', 'Too many attempts. Try again in 15 minutes.') } });
    await u.type(screen.getByLabelText('Mobile number'), '77123456');
    await u.type(screen.getByLabelText('PIN'), '000000');
    await u.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Too many attempts. Try again in 15 minutes.')).toBeTruthy();
    expect(screen.getByLabelText('PIN')).toHaveValue('');
    expect(sessionStore.get().user).toBeNull();
  });

  it('works in every language from the very first screen (before anyone is signed in)', async () => {
    const u = userEvent.setup({ delay: null });
    renderApp({ roles: null });
    await u.click(screen.getByRole('button', { name: 'PT' }));
    expect(await screen.findByRole('heading', { name: 'Entrar' })).toBeTruthy();
    await u.click(screen.getByRole('button', { name: 'TET' }));
    expect(await screen.findByRole('heading', { name: 'Tama' })).toBeTruthy();
    expect(document.documentElement.lang).toBe('tet');
    await u.click(screen.getByRole('button', { name: 'ID' }));
    expect(await screen.findByRole('heading', { name: 'Masuk' })).toBeTruthy();
  });

  it('explains why a session ended, once', async () => {
    renderApp({ roles: null });
    act(() => sessionStore.signOut('expired'));
    expect(await screen.findByText('Your session ended. Please sign in again.')).toBeTruthy();
  });
});

describe('role-adaptive app', () => {
  it('AGENT: home, receive, inbound, hand over, profile', async () => {
    renderApp({ roles: ['AGENT'] });
    await screen.findByText('Hello, Maria');
    expect(tabs()).toEqual(['Home', 'Receive Parcel', 'Inbound', 'Hand Over Parcel', 'Profile']);
  });

  it('COURIER: jobs, receive, hub hand-over, profile — and the header names the municipality', async () => {
    renderApp({ roles: ['COURIER'], profile: courierProfile, routes: { 'GET /v1/courier/jobs': () => json({ pickups: [], readyForDelivery: [], outForDelivery: [] }) } });
    await screen.findByText('No pick-ups assigned to you.');
    expect(tabs()).toEqual(['Jobs', 'Receive Parcel', 'Hub Handover', 'Profile']);
    expect(screen.getByText(/Courier · Díli/)).toBeTruthy();
  });

  it('DRIVER: trips and profile only — no money, no parcels', async () => {
    renderApp({ roles: ['DRIVER'], profile: driverProfile, routes: { 'GET /v1/manifests': () => json([]) } });
    await screen.findByText('No trips assigned to you.');
    expect(tabs()).toEqual(['My trips', 'Profile']);
    expect(screen.getByText('Transporte Lorosae Express')).toBeTruthy();
  });

  it('a fleet owner or back-office user is told this app is not for them, with a way out', async () => {
    renderApp({ roles: ['FLEET_OWNER'] });
    expect(await screen.findByRole('alert')).toHaveTextContent('This app is for agents, couriers and fleet drivers');
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('a courier cannot open agent screens by typing the address', async () => {
    renderApp({ roles: ['COURIER'], profile: courierProfile, path: '/inbound', routes: { 'GET /v1/courier/jobs': () => json({ pickups: [], readyForDelivery: [], outForDelivery: [] }) } });
    expect(await screen.findByText('No pick-ups assigned to you.')).toBeTruthy(); // redirected to the courier home
  });
});

describe('language is synced to the profile', () => {
  it('the profile language wins on sign-in', async () => {
    renderApp({ roles: ['AGENT'], lang: 'pt' });
    expect(await screen.findByText('Olá, Maria')).toBeTruthy();
    expect(document.documentElement.lang).toBe('pt');
  });

  it('switching language saves it to the profile and sends it with every later request', async () => {
    const u = userEvent.setup({ delay: null });
    const { api } = renderApp({
      path: '/profile',
      routes: { 'PATCH /v1/auth/me/language': (i) => json(user({ lang: (i.body as { lang: 'pt' }).lang })) },
    });
    await u.click(await screen.findByRole('radio', { name: 'Português' }));
    await waitFor(() => expect(api.find('PATCH', '/v1/auth/me/language')).toHaveLength(1));
    expect(api.find('PATCH', '/v1/auth/me/language')[0]!.body).toEqual({ lang: 'pt' });
    expect(await screen.findByRole('heading', { name: 'Perfil' })).toBeTruthy();
    expect(sessionStore.get().user?.lang).toBe('pt');
    expect(document.documentElement.lang).toBe('pt');
    // the API's error messages now come back in Portuguese
    signIn(sessionStore.get().user!, { accessToken: 'a', refreshToken: 'r' });
    expect(api.calls.at(-1)!.init.headers['X-Lang']).toBe('pt');
  });

  it('offline: the language still changes on this phone, with a notice that the profile could not be updated', async () => {
    const u = userEvent.setup({ delay: null });
    renderApp({ path: '/profile', routes: { 'PATCH /v1/auth/me/language': () => Promise.reject(new TypeError('offline')) } });
    await u.click(await screen.findByRole('radio', { name: 'Indonesia' }));
    expect(await screen.findByText(/Bahasa diganti di sini/)).toBeTruthy();
    expect(document.documentElement.lang).toBe('id');
  });
});

describe('connection awareness', () => {
  it('shows an offline banner and clears it with a short "back online" message', async () => {
    renderApp({ roles: ['AGENT'] });
    await screen.findByText('Hello, Maria');
    act(() => void window.dispatchEvent(new Event('offline')));
    expect(await screen.findByText(/You are offline/)).toBeTruthy();
    act(() => void window.dispatchEvent(new Event('online')));
    expect(await screen.findByText('Back online.')).toBeTruthy();
  });

  it('a revoked session returns to the sign-in screen', async () => {
    renderApp({
      roles: ['AGENT'],
      routes: { 'GET /v1/wallets/me': () => apiError(401, 'unauthorized', 'x'), 'POST /v1/auth/refresh': () => apiError(401, 'refresh_invalid', 'x') },
    });
    expect(await screen.findByText('Your session ended. Please sign in again.')).toBeTruthy();
    expect(agentProfile.kind).toBe('AGENT');
  });
});
