import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { apiError, json } from '@/test/helpers';
import { renderApp } from '@/test/render';

/* ------------------------------------------------------------------------------------------ claims desk */

const CS = ['dashboard:view', 'claims:read', 'claims:review', 'claims:approve', 'evidence:read', 'incidents:read', 'incidents:manage', 'shipments:read_all'];
const claim = (over: Record<string, unknown> = {}) => ({
  id: 'c-1',
  claimNo: 'CLM-261121-0001',
  status: 'INVESTIGATING',
  type: 'DAMAGED',
  waybill: '670S-DIL-BCU-261121-000001',
  shipmentStatus: 'ARRIVED_AT_DEST_AGENT',
  isInsured: false,
  description: 'The box was crushed.',
  claimant: { name: 'Joana', phone: '+67077111111' },
  requested: '30.0000',
  maxEligible: '40.0000',
  approved: null,
  liableParty: null,
  needsFinanceApproval: false,
  filedBy: 'Joana',
  reviewedBy: null,
  financeApprovedBy: null,
  rejectionReason: null,
  resolutionNotes: null,
  lateFilingReason: null,
  paid: null,
  recovery: null,
  evidenceCount: 1,
  createdAt: '2026-11-20T01:00:00.000Z',
  ...over,
});
const evidence = {
  claimNo: 'CLM-261121-0001',
  shipmentPhotos: [
    { type: 'OPEN_BOX_CONTENT', takenAt: '2026-11-19T01:00:00.000Z', sha256: 'a'.repeat(64), url: 'https://s3.test/open.jpg', expiresIn: 300 },
    { type: 'SEALED_PARCEL', takenAt: '2026-11-19T01:01:00.000Z', sha256: 'b'.repeat(64), url: 'https://s3.test/sealed.jpg', expiresIn: 300 },
    { type: 'INBOUND_INCIDENT', takenAt: '2026-11-20T01:00:00.000Z', sha256: 'c'.repeat(64), url: 'https://s3.test/incident.jpg', expiresIn: 300 },
  ],
  claimEvidence: [{ sha256: 'd'.repeat(64), url: 'https://s3.test/claimant.jpg', expiresIn: 300 }],
  incidents: [{ id: 'i-1', condition: 'DAMAGED_SEAL', notes: 'Seal torn', status: 'OPEN', driverConfirmedAt: null, createdAt: '2026-11-20T01:00:00.000Z' }],
  timeline: [{ status: 'ARRIVED_AT_DEST_AGENT', createdAt: '2026-11-20T01:00:00.000Z', locationLabel: 'Baucau', notes: null }],
};
const claimsRoutes = (extra: Record<string, () => Response> = {}) => ({
  'GET /v1/claims': () => json([claim()]),
  'GET /v1/claims/c-1/evidence': () => json(evidence),
  'GET /v1/claims/liability/670S-DIL-BCU-261121-000001': () => json({ waybill: 'x', isInsured: false, basis: 'UNINSURED_10X_BASE_FEE_MAX_50', maxEligible: '40.0000', alreadyClaimed: '0.0000', remaining: '40.0000' }),
  ...extra,
});

describe('claims desk', () => {
  it('shows the photos side by side: as handed in on the left, as found on the right', async () => {
    const u = userEvent.setup();
    renderApp({ path: '/claims', as: { roles: ['CS_CLAIMS_ADMIN'], permissions: CS }, routes: claimsRoutes() });
    await u.click(await screen.findByRole('button', { name: 'CLM-261121-0001' }));
    const before = await screen.findByRole('region', { name: 'When it was handed in' });
    const after = screen.getByRole('region', { name: 'What was found afterwards' });
    expect(within(before).getByAltText('Open box (contents)')).toHaveAttribute('src', 'https://s3.test/open.jpg');
    expect(within(before).getByAltText('Sealed parcel')).toBeInTheDocument();
    expect(within(before).queryByAltText('Incident at arrival')).not.toBeInTheDocument();
    expect(within(after).getByAltText('Incident at arrival')).toHaveAttribute('src', 'https://s3.test/incident.jpg');
    expect(within(after).getByAltText('Sent by the claimant')).toBeInTheDocument();
    expect(screen.getByText(/Seal torn/)).toBeInTheDocument();
  });

  it('approves within the amount the parcel is eligible for and sends the liable party', async () => {
    const u = userEvent.setup();
    const { api } = renderApp({
      path: '/claims',
      as: { roles: ['CS_CLAIMS_ADMIN'], permissions: CS },
      routes: claimsRoutes({ 'POST /v1/claims/c-1/decision': () => json(claim({ status: 'APPROVED', approved: '30.0000', liableParty: 'FLEET_PARTNER' })) }),
    });
    await u.click(await screen.findByRole('button', { name: 'CLM-261121-0001' }));
    await u.click(await screen.findByRole('button', { name: 'Approve' }));
    const dialog = await screen.findByRole('dialog', { name: 'Approve' });
    const approve = within(dialog).getByRole('button', { name: 'Approve' });
    expect(approve).toBeDisabled(); // no liable party yet
    const amount = within(dialog).getByLabelText('Approved amount (USD)');
    await u.clear(amount);
    await u.type(amount, '99');
    expect(within(dialog).getByText('Enter an amount above zero, up to $30.00.')).toBeInTheDocument(); // min(requested, eligible)
    await u.clear(amount);
    await u.type(amount, '30');
    await u.selectOptions(within(dialog).getByLabelText('Liable party'), 'FLEET_PARTNER');
    await u.click(approve);
    await waitFor(() => expect(api.find('POST', '/v1/claims/c-1/decision')[0]!.body).toEqual({ decision: 'APPROVE', approvedAmountUsd: '30.0000', liableParty: 'FLEET_PARTNER' }));
  });

  it('rejecting needs a reason', async () => {
    const u = userEvent.setup();
    renderApp({ path: '/claims', as: { roles: ['CS_CLAIMS_ADMIN'], permissions: CS }, routes: claimsRoutes() });
    await u.click(await screen.findByRole('button', { name: 'CLM-261121-0001' }));
    await u.click(await screen.findByRole('button', { name: 'Reject' }));
    const dialog = await screen.findByRole('dialog', { name: 'Reject' });
    expect(within(dialog).getByRole('button', { name: 'Reject' })).toBeDisabled();
  });

  it('finance co-approval and payment appear only for the roles that hold them', async () => {
    const u = userEvent.setup();
    renderApp({
      path: '/claims',
      as: { roles: ['FINANCE_ADMIN'], permissions: ['claims:read', 'claims:finance_approve', 'claims:pay'] },
      routes: { 'GET /v1/claims': () => json([claim({ needsFinanceApproval: true, approved: '60.0000', liableParty: 'COURIER', reviewedBy: 'Cris CS' })]), 'GET /v1/claims/liability/670S-DIL-BCU-261121-000001': () => json({ waybill: 'x', isInsured: true, basis: 'INSURED_DECLARED_VALUE_MAX_500', maxEligible: '60.0000', alreadyClaimed: '0.0000', remaining: '60.0000' }) },
    });
    await u.click(await screen.findByRole('button', { name: 'CLM-261121-0001' }));
    expect(await screen.findByRole('button', { name: 'Finance co-approve' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(screen.getByText('Your role cannot view photo evidence.')).toBeInTheDocument();
  });

  it('shows the server message when the same person tries to co-approve', async () => {
    const u = userEvent.setup();
    renderApp({
      path: '/claims',
      as: { roles: ['FINANCE_ADMIN'], permissions: ['claims:read', 'claims:finance_approve'] },
      routes: {
        'GET /v1/claims': () => json([claim({ needsFinanceApproval: true, approved: '60.0000', liableParty: 'COURIER' })]),
        'GET /v1/claims/liability/670S-DIL-BCU-261121-000001': () => json({ waybill: 'x', isInsured: false, basis: 'x', maxEligible: '60.0000', alreadyClaimed: '0.0000', remaining: '60.0000' }),
        'POST /v1/claims/c-1/finance-approve': () => apiError(403, 'self_approval_forbidden', 'The person who decided cannot co-approve.'),
      },
    });
    await u.click(await screen.findByRole('button', { name: 'CLM-261121-0001' }));
    await u.click(await screen.findByRole('button', { name: 'Finance co-approve' }));
    expect(await screen.findByText('The person who decided cannot co-approve.')).toBeInTheDocument();
  });

  it('warns that an incident cannot be resolved before the driver confirmed it', async () => {
    const u = userEvent.setup();
    renderApp({
      path: '/claims',
      as: { roles: ['CS_CLAIMS_ADMIN'], permissions: ['incidents:read', 'incidents:manage'] },
      routes: { 'GET /v1/incidents': () => json([{ id: 'i-1', waybill: '670S-DIL-BCU-261121-000001', shipmentStatus: 'ON_HOLD_ISSUE', condition: 'WET', status: 'OPEN', notes: 'Rain', driverConfirmedAt: null, resolutionNotes: null, createdAt: '2026-11-20T01:00:00.000Z' }]) },
    });
    await u.click(await screen.findByRole('button', { name: 'Resolve' }));
    expect(await screen.findByText(/has not confirmed this incident/)).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------------------------- WhatsApp templates */

const tpl = (event: string, lang: string, body: string, extra: Record<string, unknown> = {}) => ({
  eventCode: event,
  lang,
  bodyTemplate: body,
  isActive: true,
  isDefaultText: true,
  allowedVariables: ['waybill', 'kioskName', 'kioskLocation', 'otp', 'openingHours'],
  updatedAt: null,
  ...extra,
});
const allTemplates = () => ['tet', 'pt', 'en', 'id'].map((l) => tpl('ARRIVED_AT_DEST_AGENT', l, `${l.toUpperCase()}: parcel {{waybill}} at {{kioskName}}, code {{otp}}`));

describe('WhatsApp template editor', () => {
  const opts = { path: '/templates', as: { roles: ['SUPER_ADMIN'], permissions: ['*:*'] } };

  it('edits all four languages of one message side by side', async () => {
    renderApp({ ...opts, routes: { 'GET /v1/admin/templates': () => json(allTemplates()) } });
    for (const name of ['Tetun', 'Português', 'English', 'Indonesia']) expect(await screen.findByRole('region', { name })).toBeInTheDocument();
  });

  it('refuses unknown variables and an arrival message without the OTP, before calling the server', async () => {
    const u = userEvent.setup();
    const { api } = renderApp({ ...opts, routes: { 'GET /v1/admin/templates': () => json(allTemplates()) } });
    const english = await screen.findByRole('region', { name: 'English' });
    const box = within(english).getByLabelText('Message text');
    await u.clear(box);
    await u.type(box, 'Hello {{{{surprise}}');
    expect(within(english).getByText(/Unknown variable\(s\): surprise/)).toBeInTheDocument();
    expect(within(english).getByRole('button', { name: 'Save' })).toBeDisabled();
    await u.clear(box);
    await u.type(box, 'Your parcel {{{{waybill}} is here');
    expect(within(english).getByText(/must contain \{\{otp\}\}/)).toBeInTheDocument();
    expect(within(english).getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(api.find('PUT', '/v1/admin/templates')).toHaveLength(0);
  });

  it('inserts a clicked variable, saves and previews', async () => {
    const u = userEvent.setup();
    const { api } = renderApp({
      ...opts,
      routes: {
        'GET /v1/admin/templates': () => json(allTemplates()),
        'PUT /v1/admin/templates/ARRIVED_AT_DEST_AGENT/en': () => json(tpl('ARRIVED_AT_DEST_AGENT', 'en', 'x', { isDefaultText: false })),
        'POST /v1/admin/templates/ARRIVED_AT_DEST_AGENT/en/preview': () => json({ text: 'Your parcel 670S-1 is at Kios Colmera, code 123456', variablesUsed: ['waybill', 'otp'], length: 51, sample: {} }),
      },
    });
    const english = await screen.findByRole('region', { name: 'English' });
    const box = within(english).getByLabelText('Message text');
    await u.clear(box);
    await u.type(box, 'Parcel {{{{waybill}} code {{{{otp}} at ');
    await u.click(within(english).getByRole('button', { name: '{{openingHours}}' }));
    expect((box as HTMLTextAreaElement).value).toBe('Parcel {{waybill}} code {{otp}} at {{openingHours}}');
    await u.click(within(english).getByRole('button', { name: 'Preview with sample data' }));
    expect(await within(english).findByText(/Kios Colmera, code 123456/)).toBeInTheDocument();
    await u.click(within(english).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('PUT', '/v1/admin/templates/ARRIVED_AT_DEST_AGENT/en')[0]!.body).toEqual({ bodyTemplate: 'Parcel {{waybill}} code {{otp}} at {{openingHours}}' }));
  });
});

/* ------------------------------------------------------------------------------------------ hub console */

describe('hub console', () => {
  const OPS = ['dashboard:view', 'hubs:read', 'master_bags:read', 'master_bags:manage', 'manifests:read', 'manifests:create', 'manifests:dispatch', 'pickups:read', 'pickups:assign', 'shipments:read_all'];
  const ship = (waybill: string, dest: string, status = 'DROPPED_AT_ORIGIN') => ({ id: waybill, waybillNumber: waybill, status, transportCanal: 'BUS_BAGGAGE', origin: { code: 'DIL', name: 'Díli' }, destination: { code: dest, name: dest }, parcel: { chargeableWeightKg: 2 }, fees: { total: null } });

  it('receives scanned waybills at a hub and lists what failed with a translated reason', async () => {
    const u = userEvent.setup();
    const { api } = renderApp({
      path: '/hubs',
      as: { roles: ['OPS_HUB_ADMIN'], permissions: OPS },
      routes: {
        'GET /v1/shipments': () => json({ items: [ship('670S-DIL-BCU-261121-000001', 'BCU')], nextBefore: null }),
        'POST /v1/hub/receive': () => json({ received: ['670S-DIL-BCU-261121-000001'], failed: [{ waybill: '670S-DIL-AIL-261121-000009', code: 'wrong_hub' }] }),
      },
    });
    expect(await screen.findByText('670S-DIL-BCU-261121-000001', { selector: 'td' })).toBeInTheDocument(); // expected at Becora
    await u.click(screen.getByRole('button', { name: /Add all/ }));
    await u.type(screen.getByLabelText('Waybills'), '\n670s-dil-ail-261121-000009');
    await u.click(screen.getByRole('button', { name: 'Receive at hub' }));
    expect(await screen.findByText('1 parcel(s) received.')).toBeInTheDocument();
    expect(screen.getByText('670S-DIL-AIL-261121-000009', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByText(/could not be received/)).toBeInTheDocument();
    expect(api.find('POST', '/v1/hub/receive')[0]!.body).toEqual({ hubCode: 'HUB_BECORA', waybills: ['670S-DIL-BCU-261121-000001', '670S-DIL-AIL-261121-000009'] });
    // what is left in the box is exactly what failed
    expect(screen.getByLabelText('Waybills')).toHaveValue('670S-DIL-AIL-261121-000009');
  });

  it('only offers destinations a hub serves and forces the ferry canal on a sea route', async () => {
    const u = userEvent.setup();
    renderApp({
      path: '/hubs',
      as: { roles: ['OPS_HUB_ADMIN'], permissions: OPS },
      routes: {
        'GET /v1/shipments': () => json({ items: [], nextBefore: null }),
        'GET /v1/master-bags': () => json([]),
        'GET /v1/manifests': () => json([]),
        'GET /v1/admin/fleet-partners': () => json([]),
      },
    });
    await u.click(await screen.findByRole('tab', { name: 'Manifests' }));
    await u.click(await screen.findByRole('button', { name: 'New manifest' }));
    const dialog = await screen.findByRole('dialog', { name: 'New manifest' });
    await u.selectOptions(within(dialog).getByLabelText('Hub'), 'HUB_DILI_PORT');
    const dest = within(dialog).getByLabelText('Destination') as HTMLSelectElement;
    expect([...dest.options].map((o) => o.value).sort()).toEqual(['ATA', 'OEC']);
    const canal = within(dialog).getByLabelText('Transport') as HTMLSelectElement;
    expect([...canal.options].map((o) => o.value)).toEqual(['SEA_FERRY_CARGO']); // Oecusse / Ataúro never by land
    expect(within(dialog).getByText(/Land transport is forbidden/)).toBeInTheDocument();
    await u.selectOptions(within(dialog).getByLabelText('Hub'), 'HUB_BECORA');
    expect([...(within(dialog).getByLabelText('Transport') as HTMLSelectElement).options].map((o) => o.value)).not.toContain('SEA_FERRY_CARGO');
  });

  it('hides tabs the role cannot use', async () => {
    renderApp({ path: '/hubs', as: { roles: ['X'], permissions: ['master_bags:read'] }, routes: { 'GET /v1/master-bags': () => json([]) } });
    expect(await screen.findByRole('tab', { name: 'Master bags' })).toBeInTheDocument();
    for (const name of ['Receive at hub', 'Manifests', 'Pick-ups']) expect(screen.queryByRole('tab', { name })).not.toBeInTheDocument();
  });
});

/* -------------------------------------------------------------------------------------------- tariffs */

describe('tariff matrix', () => {
  const tariffs = {
    zones: [{ code: 'ZONE_1', names: { tet: 'Zona 1', pt: 'Zona 1', en: 'Zone 1', id: 'Zona 1' }, eta: { tet: '1 loron', pt: '1 dia', en: '1 day', id: '1 hari' }, docRate: '1.5000', smallBase2kg: '2.5000', extraPerKg: '0.5000', cargoBase10kg: '8.0000', cargoExtraPerKg: '0.6000', updatedAt: '2026-11-01T00:00:00.000Z' }],
    addons: [{ serviceType: 'MOTOR_PICKUP', labels: { tet: 'a', pt: 'a', en: 'a', id: 'a' }, fee: '2.5000', courierSplitPct: '80.00', platformSplitPct: '20.00', wholesaleMinParcels: 5, wholesaleFreePickup: true, isActive: true }],
    municipalities: [{ code: 'MAN', name: 'Manatuto', corridor: 'EAST', zone: 'ZONE_1', isSeaRoute: false, surcharge: '0.0000' }],
  };

  it('edits a zone in four languages and sends 4-decimal rates', async () => {
    const u = userEvent.setup();
    const { api } = renderApp({
      path: '/tariffs',
      as: { roles: ['FINANCE_ADMIN'], permissions: ['tariffs:read', 'tariffs:manage'] },
      routes: { 'GET /v1/admin/tariffs': () => json(tariffs), 'PUT /v1/admin/tariffs/zones/ZONE_1': () => json(tariffs.zones[0]) },
    });
    await u.click((await screen.findAllByRole('button', { name: 'Edit' }))[0]!);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/FUTURE shipments only/)).toBeInTheDocument();
    const small = within(dialog).getByLabelText('Small parcel (first 2 kg)');
    await u.clear(small);
    await u.type(small, '3,25');
    await u.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('PUT', '/v1/admin/tariffs/zones/ZONE_1')).toHaveLength(1));
    const body = api.find('PUT', '/v1/admin/tariffs/zones/ZONE_1')[0]!.body as Record<string, unknown>;
    expect(body.smallBase2kg).toBe('3.2500');
    expect(body.names).toEqual(tariffs.zones[0]!.names);
    expect(body.eta).toEqual(tariffs.zones[0]!.eta);
  });

  it('is read-only for a role that can only read tariffs', async () => {
    renderApp({ path: '/tariffs', as: { roles: ['OPS_HUB_ADMIN'], permissions: ['tariffs:read'] }, routes: { 'GET /v1/admin/tariffs': () => json(tariffs) } });
    await screen.findByRole('heading', { name: 'Zone rates' });
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
  });
});

/* ---------------------------------------------------------------------------------------- RBAC console */

describe('RBAC console', () => {
  const roles = [
    { id: 'r-1', key: 'SUPER_ADMIN', name: 'Super Admin', description: null, isSystem: true, locked: true, userCount: 1, permissions: ['*:*'] },
    { id: 'r-2', key: 'FINANCE_ADMIN', name: 'Finance Admin', description: null, isSystem: true, locked: false, userCount: 2, permissions: ['deposits:read'] },
  ];
  const groups = [{ module: 'deposits', permissions: [{ key: 'deposits:read', action: 'read', description: 'View deposit requests' }, { key: 'deposits:approve', action: 'approve', description: 'Approve deposits' }] }];

  it('locks the Super Admin role and lets others be edited', async () => {
    const u = userEvent.setup();
    const { api } = renderApp({
      path: '/access',
      routes: {
        'GET /v1/admin/users': () => json([]),
        'GET /v1/admin/roles': () => json(roles),
        'GET /v1/admin/permissions': () => json(groups),
        'PUT /v1/admin/roles/r-2/permissions': () => json(roles[1]),
      },
    });
    await u.click(await screen.findByRole('tab', { name: 'Roles & permissions' }));
    expect(await screen.findByText(/holds every permission and cannot be edited/)).toBeInTheDocument();
    for (const box of screen.getAllByRole('checkbox')) expect(box).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Delete role' })).not.toBeInTheDocument();

    await u.click(screen.getByRole('button', { name: /FINANCE_ADMIN/ }));
    const approve = await screen.findByRole('checkbox', { name: /deposits:approve/ });
    expect(approve).toBeEnabled();
    await u.click(approve);
    await u.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('PUT', '/v1/admin/roles/r-2/permissions')[0]!.body).toEqual({ permissions: ['deposits:approve', 'deposits:read'] }));
  });

  it('does not offer to edit your own roles, and creating a user needs a role and a strong temporary password', async () => {
    const u = userEvent.setup();
    const { api } = renderApp({
      path: '/access',
      as: { id: 'me-1' },
      routes: {
        'GET /v1/admin/roles': () => json(roles),
        'GET /v1/admin/users': () => json([{ id: 'me-1', fullName: 'Ana Super', email: 'ana@670send.tl', phone: '+67033000000', lang: 'en', isActive: true, mustChangePassword: false, locked: false, lastLoginAt: null, roles: ['SUPER_ADMIN'], profile: null, createdAt: '2026-11-01T00:00:00.000Z' }]),
        'POST /v1/admin/users': () => json({}),
      },
    });
    await screen.findByText('Ana Super');
    expect(screen.queryByRole('button', { name: 'Roles' })).not.toBeInTheDocument(); // self
    expect(screen.queryByRole('button', { name: 'Deactivate' })).not.toBeInTheDocument(); // self

    await u.click(screen.getByRole('button', { name: 'New staff user' }));
    const dialog = await screen.findByRole('dialog');
    await u.click(within(dialog).getByRole('button', { name: 'Create user' }));
    expect(within(dialog).getByText('Pick at least one role.')).toBeInTheDocument();
    expect(api.find('POST', '/v1/admin/users')).toHaveLength(0);
  });
});

/* ---------------------------------------------------------------------------------------------- audit */

describe('audit console', () => {
  it('lists entries and shows before/after values with the redaction note', async () => {
    const u = userEvent.setup();
    const { api } = renderApp({
      path: '/audit',
      routes: {
        'GET /v1/admin/audit-logs': () =>
          json([{ id: '9', at: '2026-11-21T01:00:00.000Z', actor: 'Ana Super', actorRoles: ['SUPER_ADMIN'], action: 'SHIPMENT_STATUS_OVERRIDDEN', entityType: 'shipment', entityId: 'abc', before: { status: 'IN_TRANSIT' }, after: { status: 'ON_HOLD_ISSUE' }, reason: 'Customer called', ip: '10.0.0.1', requestId: 'req-1' }]),
      },
    });
    expect(await screen.findByText('SHIPMENT_STATUS_OVERRIDDEN')).toBeInTheDocument();
    expect(screen.getByText('Customer called')).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Details' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/ON_HOLD_ISSUE/)).toBeInTheDocument();
    expect(within(dialog).getByText(/\[REDACTED\]/)).toBeInTheDocument();
    // the query is bounded by Díli calendar days, sent as UTC (the API refuses offsets): Díli midnight = 15:00Z the day before
    expect(api.find('GET', '/v1/admin/audit-logs')[0]!.path).toMatch(/from=\d{4}-\d{2}-\d{2}T15%3A00%3A00\.000Z/);
    expect(api.find('GET', '/v1/admin/audit-logs')[0]!.path).toMatch(/to=\d{4}-\d{2}-\d{2}T14%3A59%3A59\.999Z/);
  });
});

/* ----------------------------------------------------------------------------------- partners, shipments */

describe('partners', () => {
  const partner = (over: Record<string, unknown> = {}) => ({
    id: 'f-1',
    companyName: 'Transporte Lorosae Express',
    status: 'ACTIVE',
    statusReason: null,
    serveRegNo: null,
    mou: { number: 'MOU-1', signedAt: '2025-01-01', validUntil: '2026-01-01', autoRenew: false, expired: true },
    payoutCycle: 'WEEKLY',
    payoutChannel: 'BNCTL',
    bank: { bank: 'BNCTL', accountNoLast4: '5678' },
    owner: { fullName: 'Owner', phone: '+67077000000', email: null },
    vehicleCount: 3,
    driverCount: 4,
    ...over,
  });

  it('flags an expired MoU, masks the bank account and offers management only to those who hold it', async () => {
    renderApp({ path: '/partners', as: { roles: ['FINANCE_ADMIN'], permissions: ['fleet_partners:read', 'agents:read'] }, routes: { 'GET /v1/admin/fleet-partners': () => json([partner()]) } });
    expect(await screen.findByText('Transporte Lorosae Express')).toBeInTheDocument();
    expect(screen.getByText('MoU expired')).toBeInTheDocument();
    expect(screen.getByText('BNCTL ••••5678')).toBeInTheDocument();
    for (const name of ['New fleet partner', 'Renew MoU', 'Suspend']) expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
  });

  it('lets an ops admin renew a MoU', async () => {
    const u = userEvent.setup();
    const { api } = renderApp({
      path: '/partners',
      as: { roles: ['OPS_HUB_ADMIN'], permissions: ['fleet_partners:read', 'fleet_partners:manage'] },
      routes: { 'GET /v1/admin/fleet-partners': () => json([partner()]), 'POST /v1/admin/fleet-partners/f-1/mou': () => json(partner()) },
    });
    await u.click(await screen.findByRole('button', { name: 'Renew MoU' }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Renew MoU' });
    expect(confirm).toBeDisabled();
    await u.type(within(dialog).getByLabelText('MoU valid until'), '2027-12-31');
    await u.click(confirm);
    await waitFor(() => expect(api.find('POST', '/v1/admin/fleet-partners/f-1/mou')[0]!.body).toMatchObject({ mouValidUntil: '2027-12-31' }));
  });
});

describe('shipments', () => {
  const row = {
    id: 's-1',
    waybillNumber: '670S-DIL-BCU-261121-000001',
    status: 'IN_TRANSIT',
    serviceScheme: 'SCHEME_A',
    transportCanal: 'BUS_BAGGAGE',
    intakeChannel: 'AGENT_DROP_OFF',
    origin: { code: 'DIL', name: 'Díli' },
    destination: { code: 'BCU', name: 'Baucau' },
    destAgent: null,
    sender: { name: 'M**** d* C****', phone: '+67077***456', lang: 'TET' },
    recipient: { name: 'Joao', phone: '+67077222222', lang: 'TET', address: null },
    item: { description: 'Clothes', category: 'GENERAL', isFragile: false, isHeavyBulk: false, isShortShelfLife: false, declaredValue: null },
    parcel: { actualWeightKg: 1, volumetricWeightKg: 1, chargeableWeightKg: 2, lengthCm: 10, widthCm: 10, heightCm: 10, isDocumentTier: false },
    insurance: { isInsured: false, premium: null, insuredAmount: null },
    fees: { base: null, pickupAddon: null, deliveryAddon: null, storagePenalty: null, total: { usd: '3.5000', display: '$3.50' } },
    sealCode: null,
    otpIssued: false,
    holdReason: null,
    arrivedDestAt: null,
    deliveredAt: null,
    collectorName: null,
    createdAt: '2026-11-20T01:00:00.000Z',
  };
  const routes = (extra: Record<string, () => Response> = {}) => ({
    'GET /v1/shipments': () => json({ items: [row], nextBefore: null }),
    'GET /v1/shipments/670S-DIL-BCU-261121-000001': () => json(row),
    'GET /v1/shipments/670S-DIL-BCU-261121-000001/events': () => json([{ status: 'DROPPED_AT_ORIGIN', fromStatus: null, at: '2026-11-20T01:00:00.000Z', location: 'Kios', notes: null, actor: 'Maria' }]),
    ...extra,
  });

  it('a status override needs a reason, is sent with the audit header and never offers Delivered', async () => {
    const u = userEvent.setup();
    const { api } = renderApp({ path: '/shipments', routes: routes({ 'POST /v1/admin/shipments/670S-DIL-BCU-261121-000001/override-status': () => json({ waybill: 'x', status: 'ON_HOLD_ISSUE' }) }) });
    await u.click(await screen.findByRole('button', { name: '670S-DIL-BCU-261121-000001' }));
    await u.click(await screen.findByRole('button', { name: 'Force status override' }));
    const dialog = await screen.findByRole('dialog', { name: 'Force status override' });
    const options = [...(within(dialog).getByLabelText('New status') as HTMLSelectElement).options].map((o) => o.value);
    expect(options).not.toContain('DELIVERED');
    expect(options).not.toContain('IN_TRANSIT'); // not the current one either
    await u.selectOptions(within(dialog).getByLabelText('New status'), 'ON_HOLD_ISSUE');
    const confirm = within(dialog).getByRole('button', { name: 'Force status override' });
    expect(confirm).toBeDisabled();
    await u.type(within(dialog).getByLabelText(/Override reason/), 'Driver reported a flat tyre');
    await u.click(confirm);
    await waitFor(() => expect(api.find('POST', '/v1/admin/shipments/670S-DIL-BCU-261121-000001/override-status')).toHaveLength(1));
    const call = api.find('POST', '/v1/admin/shipments/670S-DIL-BCU-261121-000001/override-status')[0]!;
    expect(call.init.headers['X-Audit-Reason']).toBe('Driver reported a flat tyre');
    expect(call.body).toMatchObject({ status: 'ON_HOLD_ISSUE', reason: 'Driver reported a flat tyre' });
  });

  it('only a role with the override permission sees the override button', async () => {
    const u = userEvent.setup();
    renderApp({ path: '/shipments', as: { roles: ['CS_CLAIMS_ADMIN'], permissions: ['shipments:read_all'] }, routes: routes() });
    await u.click(await screen.findByRole('button', { name: '670S-DIL-BCU-261121-000001' }));
    await screen.findByText('Timeline');
    expect(screen.queryByRole('button', { name: 'Force status override' })).not.toBeInTheDocument();
  });
});
