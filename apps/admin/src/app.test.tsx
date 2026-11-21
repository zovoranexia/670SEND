import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { sessionStore } from '@/lib/session';
import { apiError, json, noContent, user } from '@/test/helpers';
import { renderApp } from '@/test/render';

export const executive = {
  asOf: '2026-11-21T03:00:00.000Z',
  gmv: { today: '120.5000', month: '3400.0000' },
  platformRevenue: { month: '850.0000', walletBalance: '900.0000' },
  reserves: { claimEscrow: '170.0000', insurancePool: '40.0000', hubOps: '10.0000', pendingSettlement: '55.0000' },
  shipments: { byStatus: { IN_TRANSIT: 7, ON_HOLD_ISSUE: 2 }, inTransit: 7, atHub: 3, atKiosk: 4, onHold: 2, unclaimedOver5Days: 1, returnToSenderPending: 0 },
  queues: { openClaims: 2, openIncidents: 1, pendingDeposits: { count: 3, amount: '250.0000' }, payoutsAwaitingApproval: 1 },
  byCorridor: [{ corridor: 'EAST', parcels: 12, gmv: '90.0000' }],
  last14Days: Array.from({ length: 14 }, (_, i) => ({ date: `2026-11-${String(8 + i).padStart(2, '0')}`, parcels: i, gmv: '1.0000' })),
};
const dashboard = { 'GET /v1/analytics/executive': () => json(executive) };

const FINANCE = ['dashboard:view', 'reports:export', 'shipments:read_all', 'agents:read', 'wallets:read_all', 'deposits:read', 'deposits:approve', 'ledger:read', 'payouts:read', 'payouts:create', 'payouts:approve', 'tariffs:read', 'tariffs:manage', 'claims:read', 'claims:pay', 'refunds:issue', 'reconciliation:run'];

describe('sign-in', () => {
  it('shows the sign-in form to a signed-out visitor, then the dashboard after a successful login', async () => {
    const u = userEvent.setup();
    const { api } = renderApp({
      as: null,
      routes: {
        ...dashboard,
        'POST /v1/auth/login': () => json({ accessToken: 'a', refreshToken: 'r-long-enough-token-value', expiresIn: 900, user: user({ lang: 'en' }) }), // the profile language wins after sign-in
      },
    });
    await u.type(screen.getByLabelText('Work email'), 'Ana@670Send.tl');
    await u.type(screen.getByLabelText('Password'), 'correct horse 42');
    await u.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { name: 'Executive Dashboard' })).toBeInTheDocument();
    expect(api.find('POST', '/v1/auth/login')[0]!.body).toEqual({ email: 'ana@670send.tl', password: 'correct horse 42' });
  });

  it('shows the server message on a wrong password and clears the password field', async () => {
    const u = userEvent.setup();
    renderApp({ as: null, routes: { 'POST /v1/auth/login': () => apiError(401, 'invalid_credentials', 'Email or password is wrong.') } });
    await u.type(screen.getByLabelText('Work email'), 'ana@670send.tl');
    await u.type(screen.getByLabelText('Password'), 'nope');
    await u.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Email or password is wrong.')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toHaveValue('');
  });

  it('validates before calling the server', async () => {
    const u = userEvent.setup();
    const { api } = renderApp({ as: null });
    await u.type(screen.getByLabelText('Work email'), 'not-an-email');
    await u.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument();
    expect(api.calls).toHaveLength(0);
  });
});

describe('forced password change', () => {
  it('blocks the whole console until the temporary password is replaced, then asks to sign in again', async () => {
    const u = userEvent.setup();
    const { api } = renderApp({ as: { mustChangePassword: true }, routes: { 'POST /v1/auth/password/change': () => noContent() } });
    expect(screen.getByRole('heading', { name: 'Choose a new password' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();

    await u.type(screen.getByLabelText('Temporary password'), 'temp-pass-0001');
    await u.type(screen.getByLabelText('New password'), 'short');
    await u.type(screen.getByLabelText('Repeat the new password'), 'short');
    await u.click(screen.getByRole('button', { name: 'Change password' }));
    expect(screen.getByText('Use at least 12 characters.')).toBeInTheDocument();
    expect(api.calls).toHaveLength(0);

    await u.clear(screen.getByLabelText('New password'));
    await u.clear(screen.getByLabelText('Repeat the new password'));
    await u.type(screen.getByLabelText('New password'), 'a-strong-pass-77');
    await u.type(screen.getByLabelText('Repeat the new password'), 'a-strong-pass-77');
    await u.click(screen.getByRole('button', { name: 'Change password' }));

    expect(await screen.findByText('Password changed. Please sign in with the new password.')).toBeInTheDocument();
    expect(api.find('POST', '/v1/auth/password/change')[0]!.body).toEqual({ currentPassword: 'temp-pass-0001', newPassword: 'a-strong-pass-77' });
    expect(api.find('POST', '/v1/auth/logout')).toHaveLength(0); // every session was already revoked by the change
    expect(sessionStore.get().user).toBeNull();
  });

  it('does not let a repeated mismatch through', async () => {
    const u = userEvent.setup();
    const { api } = renderApp({ as: { mustChangePassword: true } });
    await u.type(screen.getByLabelText('Temporary password'), 'temp-pass-0001');
    await u.type(screen.getByLabelText('New password'), 'a-strong-pass-77');
    await u.type(screen.getByLabelText('Repeat the new password'), 'a-strong-pass-78');
    await u.click(screen.getByRole('button', { name: 'Change password' }));
    expect(screen.getByText('The two passwords are not the same.')).toBeInTheDocument();
    expect(api.calls).toHaveLength(0);
  });
});

describe('permission-gated navigation', () => {
  it('a field account is told this console is for staff', () => {
    renderApp({ as: { roles: ['AGENT'], permissions: ['shipments:create', 'wallets:read_own'] } });
    expect(screen.getByText(/for 670Send staff/)).toBeInTheDocument();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('a finance admin sees finance and tariffs but never RBAC, audit or templates', async () => {
    renderApp({ as: { roles: ['FINANCE_ADMIN'], permissions: FINANCE }, routes: dashboard });
    const nav = await screen.findByRole('navigation', { name: 'Main navigation' });
    for (const name of ['Executive Dashboard', 'Finance & Ledger', 'Tariffs', 'CS & Claims']) expect(within(nav).getByRole('link', { name })).toBeInTheDocument();
    for (const name of ['Roles & Permissions', 'Audit Logs', 'WhatsApp Templates', 'Hub Operations']) expect(within(nav).queryByRole('link', { name })).not.toBeInTheDocument();
  });

  it('typing a forbidden address bounces to the first allowed screen', async () => {
    renderApp({ path: '/audit', as: { roles: ['FINANCE_ADMIN'], permissions: FINANCE }, routes: dashboard });
    expect(await screen.findByRole('heading', { name: 'Executive Dashboard' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Audit Logs' })).not.toBeInTheDocument();
  });

  it('a Super Admin sees every area', async () => {
    renderApp({ routes: dashboard });
    const nav = await screen.findByRole('navigation', { name: 'Main navigation' });
    expect(within(nav).getAllByRole('link')).toHaveLength(10);
  });
});

describe('four languages', () => {
  it('switching language changes the whole screen and is saved to the profile', async () => {
    const u = userEvent.setup();
    const { api } = renderApp({
      routes: {
        ...dashboard,
        'PATCH /v1/auth/me/language': () => json(user({ lang: 'tet' })),
      },
    });
    await screen.findByRole('heading', { name: 'Executive Dashboard' });
    await u.click(screen.getAllByRole('button', { name: 'TET' })[0]!);
    expect(await screen.findByRole('heading', { name: 'Painel Prinsipál' })).toBeInTheDocument();
    await waitFor(() => expect(api.find('PATCH', '/v1/auth/me/language')[0]!.body).toEqual({ lang: 'tet' }));
    expect(document.documentElement.lang).toBe('tet');
    // API error messages follow the language too
    expect(api.calls.at(-1)!.init.headers['X-Lang']).toBe('tet');
  });

  it.each([
    ['tet', 'Painel Prinsipál'],
    ['pt', 'Painel Executivo'],
    ['id', 'Dasbor Eksekutif'],
  ] as const)('renders the dashboard title in %s', async (lang, title) => {
    renderApp({ lang, as: { lang }, routes: dashboard });
    expect(await screen.findByRole('heading', { name: title })).toBeInTheDocument();
  });
});

describe('dashboard', () => {
  it('shows the key figures and the queues that need attention', async () => {
    renderApp({ routes: dashboard });
    expect(await screen.findByText('$120.50')).toBeInTheDocument(); // GMV today
    expect(screen.getByText('$3,400.00')).toBeInTheDocument();
    expect(screen.getByText('Deposits to approve')).toBeInTheDocument();
    expect(screen.getByText('$250.00')).toBeInTheDocument();
    expect(screen.getByText('East corridor')).toBeInTheDocument();
  });

  it('offers CSV exports only for reports the user may download', async () => {
    renderApp({ as: { roles: ['CS_CLAIMS_ADMIN'], permissions: ['dashboard:view', 'claims:read', 'reports:export'] }, routes: dashboard });
    await screen.findByText('$120.50');
    expect(screen.getByRole('button', { name: /Claims/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Ledger/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Deposits$/ })).not.toBeInTheDocument();
  });

  it('shows an error with retry when the server cannot be reached', async () => {
    renderApp({ routes: { 'GET /v1/analytics/executive': () => apiError(500, 'internal_error', 'Something went wrong.') } });
    expect(await screen.findByText('Something went wrong.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
