import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiError, json } from '@/test/helpers';
import { courierProfile, driverProfile, renderApp } from '@/test/render';

vi.mock('@/lib/image', async (orig) => ({
  ...(await orig<typeof import('@/lib/image')>()),
  compressPhoto: vi.fn(async (f: Blob) => ({ blob: new Blob([new Uint8Array(300_000)], { type: 'image/jpeg' }), width: 1600, height: 1200, quality: 0.8, originalBytes: f.size })),
}));
beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => vi.unstubAllGlobals());

const upload = () => json({ id: `up-${Math.random().toString(36).slice(2, 8)}` }, 201);
const WB = '670S-DIL-BCU-261121-0042';
const money = (n: string) => ({ usd: Number(n).toFixed(4), display: `$${Number(n).toFixed(2)}` });
const parcel = (status: string, over = {}) => ({ id: 's-1', waybillNumber: WB, status, serviceScheme: 'SCHEME_A', transportCanal: 'BUS_BAGGAGE', origin: { code: 'DIL', name: 'Díli' }, destination: { code: 'BCU', name: 'Baucau' }, destAgent: null, sender: { name: 'Maria da Costa', phone: '+67077123456', lang: 'PT' }, recipient: { name: 'José Guterres', phone: '+67077987654', lang: 'TET', address: null }, fees: { total: money('4') }, arrivedDestAt: null, createdAt: '2026-11-21T03:00:00.000Z', ...over });

async function takePhoto(u: ReturnType<typeof userEvent.setup>, container: HTMLElement) {
  const input = container.querySelector<HTMLInputElement>('input[type=file]')!;
  await u.upload(input, new File(['x'], 'p.jpg', { type: 'image/jpeg' }));
  await waitFor(() => expect(container.textContent).toMatch(/Photo saved/));
}
const photoBoxes = () => [...document.querySelectorAll<HTMLElement>('div.rounded-2xl.border')].filter((d) => d.querySelector('input[type=file]'));

/* ===================================================================================== inbound scan */
describe('inbound scan (destination kiosk)', () => {
  const BAG = 'MB-261121-7K3M9Q';
  const open = async (u: ReturnType<typeof userEvent.setup>, code = BAG) => {
    await u.type(await screen.findByLabelText('Or type the code'), code);
    await u.click(screen.getByRole('button', { name: 'Open' }));
  };

  it('refuses a code that is not a bag or waybill, accepts a typed bag, and records an intact scan', async () => {
    const u = userEvent.setup({ delay: null });
    const { api } = renderApp({ path: '/inbound', routes: { 'POST /v1/inbound/scan': () => json({ processed: [{ waybill: 'a', status: 'ARRIVED_AT_DEST_AGENT' }, { waybill: 'b', status: 'ARRIVED_AT_DEST_AGENT' }], incidents: [], driverConfirmationRequired: false, manifest: { status: 'COMPLETED', manifestCode: 'MF-261121-4FQ8TD' } }) } });
    await open(u, 'MF-261121-4FQ8TD'); // a manifest is not a bag
    expect(await screen.findByText('That code is not valid here.')).toBeTruthy();
    await u.clear(screen.getByLabelText('Or type the code'));
    await open(u);
    expect(await screen.findByText(BAG)).toBeTruthy();
    await u.click(screen.getByRole('button', { name: 'Record scan' }));
    expect(await screen.findByText('Parcels received: 2')).toBeTruthy();
    expect(screen.getByText('Trip status: Completed')).toBeTruthy();
    expect(api.find('POST', '/v1/inbound/scan')[0]!.body).toEqual({ code: BAG, condition: 'INTACT' });
    await u.click(screen.getByRole('button', { name: 'Scan the next one' }));
    expect(await screen.findByLabelText('Or type the code')).toHaveValue('');
  });

  it('a damaged bag cannot be recorded without a photo of the problem; with one, the driver is told to confirm', async () => {
    const u = userEvent.setup({ delay: null });
    const { api } = renderApp({
      path: '/inbound',
      routes: {
        'POST /v1/uploads/photos': upload,
        'POST /v1/inbound/scan': () => json({ processed: [{ waybill: 'a', status: 'ON_HOLD_ISSUE' }], incidents: [{ id: 'i-1', waybill: 'a', condition: 'WET' }], driverConfirmationRequired: true, manifest: { status: 'ARRIVED', manifestCode: 'MF-261121-4FQ8TD' } }),
      },
    });
    await open(u);
    await u.click(await screen.findByRole('radio', { name: 'Wet or damaged' }));
    await u.click(screen.getByRole('button', { name: 'Record scan' }));
    expect(await screen.findAllByText('Take at least one photo of the problem.')).not.toHaveLength(0);
    expect(api.find('POST', '/v1/inbound/scan')).toHaveLength(0);

    await u.type(screen.getByLabelText(/Notes/), 'Bag soaked');
    await takePhoto(u, photoBoxes()[0]!);
    await u.click(screen.getByRole('button', { name: 'Record scan' }));
    expect(await screen.findByText(/The driver must confirm it in the driver app/)).toBeTruthy();
    expect(api.find('POST', '/v1/inbound/scan')[0]!.body).toMatchObject({ code: BAG, condition: 'WET', notes: 'Bag soaked', incidentPhotoUploadIds: [expect.stringMatching(/^up-/)] });
  });

  it('missing parcels in an otherwise intact bag need their waybills in the right format — and a photo', async () => {
    const u = userEvent.setup({ delay: null });
    const { api } = renderApp({ path: '/inbound', routes: { 'POST /v1/uploads/photos': upload, 'POST /v1/inbound/scan': () => json({ processed: [], incidents: [], driverConfirmationRequired: true, manifest: { status: 'ARRIVED', manifestCode: 'x' } }) } });
    await open(u);
    await u.type(await screen.findByLabelText(/Missing waybills/), 'not-a-waybill');
    await u.click(screen.getByRole('button', { name: 'Record scan' }));
    expect(await screen.findByText('Invalid waybill format.')).toBeTruthy();
    await u.clear(screen.getByLabelText(/Missing waybills/));
    await u.type(screen.getByLabelText(/Missing waybills/), `${WB}\n670s-dil-bcu-261121-0043`);
    await takePhoto(u, photoBoxes()[0]!);
    await u.click(screen.getByRole('button', { name: 'Record scan' }));
    await waitFor(() => expect(api.find('POST', '/v1/inbound/scan')).toHaveLength(1));
    expect((api.find('POST', '/v1/inbound/scan')[0]!.body as { missingWaybills: string[] }).missingWaybills).toEqual([WB, '670S-DIL-BCU-261121-0043']);
  });

  it('shows the server’s message when the bag is not for this kiosk', async () => {
    const u = userEvent.setup({ delay: null });
    renderApp({ path: '/inbound', routes: { 'POST /v1/inbound/scan': () => apiError(404, 'not_found', 'Nothing found.') } });
    await open(u);
    await u.click(await screen.findByRole('button', { name: 'Record scan' }));
    expect(await screen.findByText('Nothing found.')).toBeTruthy();
  });
});

/* ======================================================================================= OTP hand-over */
describe('proof of delivery', () => {
  const routes = (status = 'ARRIVED_AT_DEST_AGENT', fee = '0.0000') => ({
    [`GET /v1/shipments/${WB}`]: () => json(parcel(status)),
    [`GET /v1/shipments/${WB}/storage-fee`]: () => json({ waybill: WB, storageDay: 7, penalty: { usd: fee } }),
    'POST /v1/uploads/photos': upload,
    'POST /v1/pod/verify': () => json({ waybill: WB, status: 'DELIVERED', deliveredAt: '2026-11-21T05:00:00.000Z', storagePenalty: { usd: fee } }),
  });
  const fill = async (u: ReturnType<typeof userEvent.setup>, otp = '123456') => {
    await u.type(await screen.findByLabelText('Enter the 6-digit OTP'), otp);
    await u.clear(screen.getByLabelText('Collector name'));
    await u.type(screen.getByLabelText('Collector name'), 'José Guterres');
    await u.type(screen.getByLabelText('Collector ID number'), 'BI998877');
    await takePhoto(u, photoBoxes()[0]!);
  };

  it('finds the parcel by typed waybill, then needs OTP + collector ID + a photo, and completes the delivery', async () => {
    const u = userEvent.setup({ delay: null });
    const { api } = renderApp({ path: '/handover', routes: routes() });
    await u.type(await screen.findByLabelText('Or type the code'), WB.toLowerCase());
    await u.click(screen.getByRole('button', { name: 'Open' }));
    expect(await screen.findByText('José Guterres', { selector: 'span' })).toBeTruthy();
    expect(await screen.findByText('No storage fee.')).toBeTruthy();

    await u.click(screen.getByRole('button', { name: 'Complete delivery' }));
    expect(screen.getAllByRole('alert').length).toBeGreaterThanOrEqual(3); // otp, id, photo
    expect(api.find('POST', '/v1/pod/verify')).toHaveLength(0);

    await fill(u);
    await u.click(screen.getByRole('button', { name: 'Complete delivery' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Delivered');
    expect(api.find('POST', '/v1/pod/verify')[0]!.body).toMatchObject({ waybill: WB, otp: '123456', collector: { name: 'José Guterres', idType: 'BI', idNumber: 'BI998877', isRepresentative: false }, storagePenaltyCollected: false });
  });

  it('a parcel past its free days: the agent must confirm collecting the storage fee, and it is sent as collected', async () => {
    const u = userEvent.setup({ delay: null });
    const { api } = renderApp({ path: `/handover?no=${WB}`, routes: routes('ARRIVED_AT_DEST_AGENT', '1.5000') });
    expect(await screen.findByText('Storage fee to collect: $1.50')).toBeTruthy();
    await fill(u);
    await u.click(screen.getByRole('button', { name: 'Complete delivery' }));
    expect(await screen.findByText('This field is required.')).toBeTruthy(); // fee not ticked
    expect(api.find('POST', '/v1/pod/verify')).toHaveLength(0);
    await u.click(screen.getByRole('checkbox', { name: /I collected the storage fee/ }));
    await u.click(screen.getByRole('button', { name: 'Complete delivery' }));
    await screen.findByRole('status');
    expect(api.find('POST', '/v1/pod/verify')[0]!.body).toMatchObject({ storagePenaltyCollected: true });
  });

  it('a wrong OTP shows the server’s message and clears the field so it can be re-entered', async () => {
    const u = userEvent.setup({ delay: null });
    renderApp({ path: `/handover?no=${WB}`, routes: { ...routes(), 'POST /v1/pod/verify': () => apiError(422, 'invalid_otp', 'Wrong OTP. 4 tries left.') } });
    await fill(u, '000000');
    await u.click(screen.getByRole('button', { name: 'Complete delivery' }));
    expect(await screen.findByText('Wrong OTP. 4 tries left.')).toBeTruthy();
    expect(screen.getByLabelText('Enter the 6-digit OTP')).toHaveValue('');
  });

  it('a recipient who lost the WhatsApp gets a fresh OTP', async () => {
    const u = userEvent.setup({ delay: null });
    const { api } = renderApp({ path: `/handover?no=${WB}`, routes: { ...routes(), [`POST /v1/shipments/${WB}/resend-otp`]: () => json({ sent: true }) } });
    await u.click(await screen.findByRole('button', { name: 'Send a new OTP' }));
    expect(await screen.findByText('A new OTP was sent to the recipient.')).toBeTruthy();
    expect(api.find('POST', `/v1/shipments/${WB}/resend-otp`)).toHaveLength(1);
  });

  it('a parcel that is not waiting at this kiosk cannot be handed over', async () => {
    renderApp({ path: `/handover?no=${WB}`, routes: routes('IN_TRANSIT') });
    expect(await screen.findByText('This parcel is not waiting at your kiosk.')).toBeTruthy();
    expect(screen.queryByLabelText('Enter the 6-digit OTP')).toBeNull();
  });

  it('couriers deliver at the door (OUT_FOR_DELIVERY) and never see a storage fee', async () => {
    const u = userEvent.setup({ delay: null });
    const { api } = renderApp({ roles: ['COURIER'], profile: courierProfile, path: `/deliver/${WB}`, routes: { ...routes('OUT_FOR_DELIVERY'), 'GET /v1/courier/jobs': () => json({ pickups: [], readyForDelivery: [], outForDelivery: [] }) } });
    await fill(u);
    await u.click(screen.getByRole('button', { name: 'Complete delivery' }));
    await screen.findByRole('status');
    expect(api.find('GET', `/v1/shipments/${WB}/storage-fee`)).toHaveLength(0);
    await u.click(screen.getByRole('button', { name: 'Hand over another parcel' }));
    expect(await screen.findByText('No pick-ups assigned to you.')).toBeTruthy(); // back to the job list
  });
});

/* ============================================================================================ wallet */
describe('wallet', () => {
  const routes = { 'GET /v1/deposits/requests': () => json([{ id: 'd-1', status: 'PENDING', amount: '50.0000', channel: 'BNCTL', referenceNo: 'SLIP-001', hasProof: true }]), 'POST /v1/uploads/photos': upload, 'POST /v1/deposits/requests': () => json({ id: 'd-2' }, 201) };

  it('shows balances and recent top-up requests with their status', async () => {
    renderApp({ path: '/wallet', routes });
    expect(await screen.findByText('$100.00')).toBeTruthy();
    expect(screen.getByText('$12.50')).toBeTruthy();
    expect(await screen.findByText('Waiting')).toBeTruthy();
    expect(screen.getByText('$50.00')).toBeTruthy();
  });

  it('a bank transfer needs the slip photo; cash does not; the request carries an idempotency key', async () => {
    const u = userEvent.setup({ delay: null });
    const { api } = renderApp({ path: '/wallet', routes });
    await u.type(await screen.findByLabelText('Amount (USD)'), '75,5');
    await u.type(screen.getByLabelText('Slip / reference number'), 'CASH-77');
    await u.click(screen.getByRole('button', { name: 'Send request' })); // cash is the default channel
    expect(await screen.findByText('Request sent. Finance will review it.')).toBeTruthy();
    const first = api.find('POST', '/v1/deposits/requests')[0]!;
    expect(first.body).toEqual({ amountUsd: '75.50', channel: 'CASH', referenceNo: 'CASH-77' });
    expect(first.init.headers['Idempotency-Key']).toBeTruthy();

    await u.type(screen.getByLabelText('Amount (USD)'), '20');
    await u.selectOptions(screen.getByLabelText('Payment channel'), 'BNCTL');
    await u.type(screen.getByLabelText('Slip / reference number'), 'TR-9');
    await u.click(screen.getByRole('button', { name: 'Send request' }));
    expect(await screen.findByText('A photo of the slip is required for this channel.')).toBeTruthy();
    expect(api.find('POST', '/v1/deposits/requests')).toHaveLength(1);
  });

  it('warns on the home screen when the float is low', async () => {
    renderApp({ routes: { 'GET /v1/wallets/me': () => json([{ id: 'w-1', type: 'DEPOSIT', balance: '4.0000', locked: '0.0000', available: '4.0000' }]) } });
    expect(await screen.findByText(/Your deposit is low/)).toBeTruthy();
  });
});

/* =========================================================================================== courier */
describe('courier jobs', () => {
  const jobs = {
    pickups: [{ id: 'b-1', batchCode: 'PB-261121-AB12CD', senderName: 'Ana Sender', senderPhone: '+67077111222', pickupAddress: 'Rua do Sol 3', lat: -8.55, lng: 125.57, parcelCount: 3, scheme: 'SCHEME_B' }],
    readyForDelivery: [{ waybill: '670S-DIL-BCU-261121-0050', recipientName: 'Rita', recipientPhone: '+67077333444', recipientAddress: 'Rua Verde 9', attempts: 0 }],
    outForDelivery: [{ waybill: WB, recipientName: 'José', recipientPhone: '+67077987654', recipientAddress: 'Rua Azul 1', attempts: 1 }],
  };
  const base = { 'GET /v1/courier/jobs': () => json(jobs) };
  const render = (extra = {}, path = '/') => renderApp({ roles: ['COURIER'], profile: courierProfile, path, routes: { ...base, ...extra } });

  it('lists pick-ups with call / WhatsApp / map links and a "collect" action that opens the wizard on that booking', async () => {
    render();
    const card = (await screen.findByText('Ana Sender')).closest('article')!;
    expect(within(card).getByRole('link', { name: /Call/ })).toHaveAttribute('href', 'tel:+67077111222');
    expect(within(card).getByRole('link', { name: /WhatsApp/ })).toHaveAttribute('href', 'https://wa.me/67077111222');
    expect(within(card).getByRole('link', { name: /Open map/ })).toHaveAttribute('href', expect.stringContaining('mlat=-8.55&mlon=125.57'));
    expect(within(card).getByRole('link', { name: 'Collect parcel' })).toHaveAttribute('href', '/receive?booking=b-1');
    expect(within(card).getByText('Parcels to collect: 3')).toBeTruthy();
  });

  it('starts a delivery and refreshes the list', async () => {
    const u = userEvent.setup({ delay: null });
    const { api } = render({ 'POST /v1/shipments/670S-DIL-BCU-261121-0050/out-for-delivery': () => json({ waybill: 'x', status: 'OUT_FOR_DELIVERY' }) });
    await u.click(await screen.findByRole('button', { name: 'Start delivery' }));
    await waitFor(() => expect(api.find('GET', '/v1/courier/jobs').length).toBeGreaterThanOrEqual(2));
    expect(api.find('POST', '/v1/shipments/670S-DIL-BCU-261121-0050/out-for-delivery')).toHaveLength(1);
  });

  it('records a failed attempt with notes, and tells the courier when the second failure sends the parcel back to the kiosk', async () => {
    const u = userEvent.setup({ delay: null });
    const { api } = render({ [`POST /v1/shipments/${WB}/delivery-failed`]: () => json({ waybill: WB, status: 'ARRIVED_AT_DEST_AGENT', attempts: 2, returnedToAgent: true }) });
    const card = (await screen.findByText('José')).closest('article')!;
    expect(within(card).getByText('Attempt 2')).toBeTruthy(); // one failure so far
    await u.click(within(card).getByRole('button', { name: 'Could not deliver' }));
    await u.type(within(card).getByLabelText('What happened?'), 'Nobody home');
    await u.click(within(card).getAllByRole('button', { name: 'Could not deliver' }).at(-1)!);
    expect(await screen.findByText('Two attempts failed: the parcel goes back to the kiosk.')).toBeTruthy();
    expect(api.find('POST', `/v1/shipments/${WB}/delivery-failed`)[0]!.body).toEqual({ notes: 'Nobody home' });
  });

  it('the availability switch tells the server, and reverts if it could not', async () => {
    const u = userEvent.setup({ delay: null });
    let ok = true;
    const { api } = render({ 'PATCH /v1/courier/me/availability': () => (ok ? json({}) : Promise.reject(new TypeError('offline'))) });
    const sw = await screen.findByRole('switch');
    expect(sw).toHaveAttribute('aria-checked', 'true');
    await u.click(sw);
    expect(sw).toHaveAttribute('aria-checked', 'false');
    expect(api.find('PATCH', '/v1/courier/me/availability')[0]!.body).toEqual({ available: false });
    ok = false;
    await u.click(sw);
    await waitFor(() => expect(sw).toHaveAttribute('aria-checked', 'false')); // could not switch back on: stays honest
    expect(await screen.findByText('This needs a connection.')).toBeTruthy();
  });

  it('hub hand-over: select the collected parcels and hand them to the courier’s hub', async () => {
    const u = userEvent.setup({ delay: null });
    const { api } = render(
      {
        'GET /v1/shipments': () => json({ items: [parcel('DROPPED_AT_ORIGIN'), parcel('DROPPED_AT_ORIGIN', { id: 's-2', waybillNumber: '670S-DIL-BCU-261121-0043' })], nextBefore: null }),
        'POST /v1/hub/receive': () => json({ received: [WB], failed: [{ waybill: '670S-DIL-BCU-261121-0043', reason: 'wrong_hub' }] }),
      },
      '/hub',
    );
    await screen.findByText(WB);
    expect((screen.getByLabelText('Hub') as HTMLSelectElement).value).toBe('HUB_BECORA');
    await u.click(screen.getByRole('checkbox', { name: /All/ }));
    await u.click(screen.getByRole('button', { name: /Hand over to the hub \(2\)/ }));
    expect(await screen.findByText('Parcels handed over: 1')).toBeTruthy();
    expect(screen.getByText(/Not accepted: 670S-DIL-BCU-261121-0043/)).toBeTruthy();
    expect(api.find('POST', '/v1/hub/receive')[0]!.body).toEqual({ hubCode: 'HUB_BECORA', waybills: [WB, '670S-DIL-BCU-261121-0043'] });
  });
});

/* ============================================================================================ driver */
describe('driver trips', () => {
  const CODE = 'MF-261121-4FQ8TD';
  const summary = { manifestCode: CODE, status: 'READY', canal: 'BUS_BAGGAGE', destination: { code: 'BCU', name: 'Baucau' }, vehicle: 'TL-1234', parcelCount: 3, masterBagCount: 1, scheduledDepartureAt: null };
  const detail = (over = {}) => ({ manifestCode: CODE, status: 'READY', canal: 'BUS_BAGGAGE', hub: { code: 'HUB_BECORA', name: 'Terminal Becora' }, destination: { code: 'BCU', name: 'Baucau' }, vehicle: { plateNumber: 'TL-1234', vehicleType: 'BUS_PASSENGER' }, portManifestNo: null, parcelCount: 3, masterBagCount: 1, hasBaggagePhoto: false, incidents: [], items: [{ type: 'MASTER_BAG', code: 'MB-261121-7K3M9Q', parcelCount: 3, inboundCondition: null }], ...over });
  const render = (extra = {}, path = '/') => renderApp({ roles: ['DRIVER'], profile: driverProfile, path, routes: { 'GET /v1/manifests': () => json([summary]), [`GET /v1/manifests/${CODE}`]: () => json(detail()), 'POST /v1/uploads/photos': upload, ...extra } });

  it('lists the driver’s trips and opens one by tapping or by typing the manifest QR code', async () => {
    const u = userEvent.setup({ delay: null });
    render({ 'GET /v1/manifests': () => json([summary]) });
    expect(await screen.findByText('Baucau')).toBeTruthy();
    expect(screen.getByText('Parcels: 3 · Bags: 1')).toBeTruthy();
    await u.type(screen.getByLabelText('Scan manifest QR'), CODE.toLowerCase());
    await u.click(screen.getByRole('button', { name: 'Open' }));
    expect(await screen.findByRole('heading', { name: 'Baucau' })).toBeTruthy();
    expect(screen.getByText('MB-261121-7K3M9Q')).toBeTruthy();
  });

  it('a bus trip cannot start without the photo of the closed baggage compartment', async () => {
    const u = userEvent.setup({ delay: null });
    const { api } = render({ 'POST /v1/manifests/MF-261121-4FQ8TD/handover': () => json({}) }, `/trips/${CODE}`);
    await u.click(await screen.findByRole('button', { name: 'Confirm and start trip' }));
    expect(await screen.findAllByText('A photo of the baggage compartment is required for bus trips.')).not.toHaveLength(0);
    expect(api.find('POST', `/v1/manifests/${CODE}/handover`)).toHaveLength(0);
    await takePhoto(u, photoBoxes()[0]!);
    await u.click(screen.getByRole('button', { name: 'Confirm and start trip' }));
    expect(await screen.findByText('Trip started. The parcels are now in transit.')).toBeTruthy();
    expect(api.find('POST', `/v1/manifests/${CODE}/handover`)[0]!.body).toEqual({ baggagePhotoUploadId: expect.stringMatching(/^up-/) });
  });

  it('a ferry or cargo trip starts without that photo', async () => {
    const u = userEvent.setup({ delay: null });
    const { api } = render({ [`GET /v1/manifests/${CODE}`]: () => json(detail({ canal: 'SEA_FERRY_CARGO', portManifestNo: 'PORT-77' })), 'POST /v1/manifests/MF-261121-4FQ8TD/handover': () => json({}) }, `/trips/${CODE}`);
    expect(await screen.findByText('PORT-77')).toBeTruthy();
    await u.click(screen.getByRole('button', { name: 'Confirm and start trip' }));
    await waitFor(() => expect(api.find('POST', `/v1/manifests/${CODE}/handover`)).toHaveLength(1));
    expect(api.find('POST', `/v1/manifests/${CODE}/handover`)[0]!.body).toEqual({});
  });

  it('on the road: record arrival; at the destination: confirm each incident digitally', async () => {
    const u = userEvent.setup({ delay: null });
    let status = 'IN_TRANSIT';
    let confirmed = false;
    const { api } = render(
      {
        [`GET /v1/manifests/${CODE}`]: () => json(detail({ status, incidents: [{ id: 'i-1', waybill: WB, condition: 'WET', status: 'OPEN', notes: 'Bag soaked', driverConfirmed: confirmed }] })),
        'POST /v1/manifests/MF-261121-4FQ8TD/arrive': () => ((status = 'ARRIVED'), json(detail({ status }))),
        'POST /v1/incidents/i-1/driver-confirm': () => ((confirmed = true), json({})),
      },
      `/trips/${CODE}`,
    );
    await u.click(await screen.findByRole('button', { name: 'Arrived' }));
    expect(await screen.findByText('Arrival recorded.')).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Arrived' })).toBeNull()); // the trip reloads as ARRIVED

    expect(screen.getByText('Bag soaked')).toBeTruthy();
    await u.click(screen.getByRole('button', { name: 'Confirm incident' }));
    await waitFor(() => expect(api.find('POST', '/v1/incidents/i-1/driver-confirm')).toHaveLength(1));
    expect((await screen.findAllByText('Confirmed')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Confirm incident' })).toBeNull();
  });

  it('a manifest that is not theirs is reported plainly', async () => {
    renderApp({ roles: ['DRIVER'], profile: driverProfile, path: `/trips/${CODE}`, routes: { [`GET /v1/manifests/${CODE}`]: () => apiError(404, 'not_found', 'x') } });
    expect(await screen.findByText('This manifest is not assigned to you.')).toBeTruthy();
  });
});

/* ============================================================================================ parcels */
describe('parcels', () => {
  it('lists my parcels with status, filters waiting ones, searches, and opens the receipt', async () => {
    const u = userEvent.setup({ delay: null });
    const { api } = renderApp({
      path: '/parcels',
      routes: {
        'GET /v1/shipments': () => json({ items: [parcel('ARRIVED_AT_DEST_AGENT')], nextBefore: null }),
        [`GET /v1/shipments/${WB}`]: () => json(parcel('ARRIVED_AT_DEST_AGENT')),
        'GET /v1/shipments/s-1/receipt': () => json({ lang: 'pt', kind: 'receipt', text: 'RECIBO', escposBase64: 'G0A=' }),
      },
    });
    expect(await screen.findByText(WB)).toBeTruthy();
    expect(api.find('GET', '/v1/shipments').at(-1)!.path).toContain('status=PICKUP_ASSIGNED');
    await u.click(screen.getByRole('button', { name: 'Waiting for collection' }));
    await waitFor(() => expect(api.find('GET', '/v1/shipments').at(-1)!.path).toContain('status=ARRIVED_AT_DEST_AGENT'));
    await u.type(screen.getByLabelText('Search by waybill or phone'), '7712');
    await waitFor(() => expect(api.find('GET', '/v1/shipments').at(-1)!.path).toContain('q=7712'));

    await u.click(screen.getByRole('link', { name: new RegExp(WB) }));
    // (the tab bar has a "Hand Over Parcel" link too: look only inside the page)
    expect(await within(screen.getByRole('main')).findByRole('link', { name: 'Hand Over Parcel' })).toHaveAttribute('href', `/handover?no=${WB}`);
    // reprint in the SENDER's language (Portuguese), regardless of the app language
    await waitFor(() => expect(api.find('GET', '/v1/shipments/s-1/receipt').at(-1)!.path).toContain('lang=pt'));
  });
});
