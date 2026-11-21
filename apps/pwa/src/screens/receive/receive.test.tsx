import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiError, json, type Handler } from '@/test/helpers';
import { courierProfile, renderApp } from '@/test/render';
import { loadDraft } from '@/lib/intake';
import type { Quote } from '@/lib/types';

// A real canvas does not exist in jsdom: pretend the camera photo was compressed to ~400 KB.
vi.mock('@/lib/image', async (orig) => ({
  ...(await orig<typeof import('@/lib/image')>()),
  compressPhoto: vi.fn(async (f: Blob) => ({ blob: new Blob([new Uint8Array(400_000)], { type: 'image/jpeg' }), width: 1600, height: 1200, quality: 0.8, originalBytes: f.size })),
}));

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => vi.unstubAllGlobals());

const money = (n: string) => ({ usd: Number(n).toFixed(4), display: `$${Number(n).toFixed(2)}` });
const quote = (over: Partial<Quote> = {}): Quote => ({ canal: 'BUS_BAGGAGE', isSeaRoute: false, eta: { tet: '1 loron', pt: '1 dia', en: '1 day', id: '1 hari' }, chargeableWeightKg: 3, baseShippingFee: money('4'), pickupAddon: null, deliveryAddon: null, insurance: null, total: money('4'), ...over });
const shipment = { id: 's-1', waybillNumber: '670S-DIL-BCU-261121-0042', status: 'DROPPED_AT_ORIGIN', serviceScheme: 'SCHEME_A', transportCanal: 'BUS_BAGGAGE', origin: { code: 'DIL', name: 'Díli' }, destination: { code: 'BCU', name: 'Baucau' }, destAgent: null, sender: { name: 'Maria da Costa', phone: '+67077123456', lang: 'TET' }, recipient: { name: 'José Guterres', phone: '+67077987654', lang: 'TET', address: null }, fees: { total: money('4') }, arrivedDestAt: null, createdAt: new Date().toISOString() };
const created = () => json({ shipment, quote: quote() }, 201);
const printJob = { lang: 'tet', kind: 'receipt', text: 'RECEIPT\n670S-DIL-BCU-261121-0042', escposBase64: 'G0A=' };

const routes = (over: Record<string, Handler> = {}): Record<string, Handler> => ({
  'GET /v1/kiosks': () => json([{ id: 'k-1', agentCode: 'AG-BCU-001', kioskName: 'Kios Baucau Vila', address: 'Baucau', openingHours: null }]),
  'POST /v1/public/quote': () => json(quote()),
  'POST /v1/uploads/photos': () => json({ id: `up-${Math.random().toString(36).slice(2, 8)}` }, 201),
  'POST /v1/shipments': created,
  'GET /v1/shipments/s-1/receipt': () => json(printJob),
  ...over,
});

const next = (u: ReturnType<typeof userEvent.setup>) => u.click(screen.getByRole('button', { name: 'Next' }));

async function step1(u: ReturnType<typeof userEvent.setup>) {
  await u.selectOptions(await screen.findByLabelText('Destination municipality'), 'BCU');
  await screen.findByText('Kios Baucau Vila');
  const sender = within(screen.getByRole('region', { name: 'Sender' }));
  await u.type(sender.getByLabelText('Full name'), 'Maria da Costa');
  await u.type(sender.getByLabelText('Document number'), 'BI123456');
  await u.type(sender.getByLabelText('WhatsApp number'), '7712 3456');
  const recipient = within(screen.getByRole('region', { name: 'Recipient' }));
  await u.type(recipient.getByLabelText('Full name'), 'José Guterres');
  await u.type(recipient.getByLabelText('WhatsApp number'), '7798 7654');
  await next(u);
}
async function step2(u: ReturnType<typeof userEvent.setup>) {
  await screen.findByText('Both photos are required before the waybill can be created.');
  for (const box of screen.getAllByRole('checkbox')) await u.click(box);
  for (const input of document.querySelectorAll<HTMLInputElement>('input[type=file]')) {
    await u.upload(input, new File(['x'], 'p.jpg', { type: 'image/jpeg' }));
    await waitFor(() => expect(input.closest('div.rounded-2xl')!.textContent).toMatch(/Photo saved/));
  }
  await next(u);
}
async function step3(u: ReturnType<typeof userEvent.setup>) {
  await u.type(await screen.findByLabelText('What is inside?'), 'Roupa');
  await u.type(screen.getByLabelText('Actual weight (kg)'), '2,5');
  await u.type(screen.getByLabelText('Length (cm)'), '30');
  await u.type(screen.getByLabelText('Width (cm)'), '20');
  await u.type(screen.getByLabelText('Height (cm)'), '10');
  await next(u);
}
async function toPinStep(u: ReturnType<typeof userEvent.setup>) {
  await step1(u);
  await step2(u);
  await step3(u);
  await waitFor(() => expect(screen.getByTestId('total')).toHaveTextContent('$4.00'));
  await next(u);
  await screen.findByText('Confirm with your PIN');
}
const typePin = (u: ReturnType<typeof userEvent.setup>, pin = '482913') => u.type(screen.getByLabelText('6-digit PIN'), pin);
const submit = (u: ReturnType<typeof userEvent.setup>) => u.click(screen.getByRole('button', { name: 'Register parcel' }));

describe('drop-off wizard (kiosk agent)', () => {
  it('walks all 5 steps, shows the live price and canal, registers the parcel with an idempotency key, and offers the receipt', async () => {
    const u = userEvent.setup({ delay: null });
    const { api } = renderApp({ path: '/receive', routes: routes() });
    expect(await screen.findByText('Step 1 of 5')).toBeTruthy();
    // an agent only sees drop-off schemes
    expect(within(screen.getByLabelText('Service')).getAllByRole('option').map((o) => o.textContent)).toEqual(['Agent to Agent', 'Agent to Door']);

    await step1(u);
    expect(await screen.findByText('Step 2 of 5')).toBeTruthy();
    await step2(u);
    await step3(u);

    // step 4: price + canal from the real quote endpoint, using the agent's own municipality as origin
    expect(await screen.findByTestId('canal')).toHaveTextContent('Official bus baggage');
    await waitFor(() => expect(screen.getByTestId('total')).toHaveTextContent('$4.00'));
    expect(api.find('POST', '/v1/public/quote').at(-1)!.body).toMatchObject({ originMunicipalityCode: 'DIL', destMunicipalityCode: 'BCU', scheme: 'SCHEME_A', parcel: { actualWeightKg: 2.5, lengthCm: 30, widthCm: 20, heightCm: 10 } });
    await next(u);

    await typePin(u);
    await submit(u);
    expect(await screen.findByTestId('waybill')).toHaveTextContent('670S-DIL-BCU-261121-0042');
    const post = api.find('POST', '/v1/shipments')[0]!;
    expect(post.init.headers['Idempotency-Key']).toBeTruthy();
    expect(post.body).toMatchObject({ scheme: 'SCHEME_A', destMunicipalityCode: 'BCU', pin: '482913', checklistLang: 'en', insure: false, sender: { name: 'Maria da Costa', phone: '7712 3456' }, recipient: { name: 'José Guterres' }, parcel: { actualWeightKg: 2.5 } });
    expect((post.body as { photoUploadIds: string[] }).photoUploadIds).toHaveLength(2);
    expect(Object.values((post.body as { prohibitedChecklist: Record<string, boolean> }).prohibitedChecklist)).toEqual(Array(7).fill(true));
    // receipt is requested in the SENDER's language, not the agent's UI language
    expect(api.find('GET', '/v1/shipments/s-1/receipt')[0]!.path).toContain('lang=tet');
    expect(await screen.findByRole('button', { name: /Share by WhatsApp/ })).toBeTruthy();
    expect(loadDraft('u-1')).toBeNull(); // the finished parcel is not kept as a draft
  });

  it('will not leave a step with problems: it explains each one and moves focus to the first', async () => {
    const u = userEvent.setup({ delay: null });
    renderApp({ path: '/receive', routes: routes() });
    await screen.findByText('Step 1 of 5');
    await next(u);
    expect(screen.getAllByRole('alert').length).toBeGreaterThanOrEqual(5);
    expect(screen.getByText('Step 1 of 5')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toHaveAttribute('aria-invalid', 'true')); // focus moves to the first problem

    await step1(u);
    await next(u); // step 2 with nothing ticked and no photos
    expect(await screen.findByText('Tick every line to continue.')).toBeTruthy();
    expect(screen.getAllByText('Both photos are required before the waybill can be created.').length).toBeGreaterThan(1);
    expect(screen.getByText('Step 2 of 5')).toBeTruthy();
  });

  it('a destination without an active kiosk blocks the parcel (nothing to deliver it to)', async () => {
    const u = userEvent.setup({ delay: null });
    renderApp({ path: '/receive', routes: routes({ 'GET /v1/kiosks': () => json([]) }) });
    await u.selectOptions(await screen.findByLabelText('Destination municipality'), 'BCU');
    expect(await screen.findAllByText('There is no active kiosk in that municipality yet.')).not.toHaveLength(0);
  });

  it('with several kiosks the agent must choose the destination kiosk', async () => {
    const u = userEvent.setup({ delay: null });
    renderApp({
      path: '/receive',
      routes: routes({ 'GET /v1/kiosks': () => json([{ id: 'k-1', agentCode: 'A', kioskName: 'Kios Vila', address: 'Vila', openingHours: null }, { id: 'k-2', agentCode: 'B', kioskName: 'Kios Bazartete', address: 'Bazar', openingHours: null }]) }),
    });
    await u.selectOptions(await screen.findByLabelText('Destination municipality'), 'BCU');
    expect(await screen.findByLabelText('Destination kiosk')).toBeTruthy();
    await next(u);
    expect(within(screen.getByLabelText('Destination kiosk').closest('div')!).getByRole('alert')).toBeTruthy();
  });

  it('shows the price problem from the API (e.g. too big for the bus) and does not let the agent continue', async () => {
    const u = userEvent.setup({ delay: null });
    renderApp({ path: '/receive', routes: routes({ 'POST /v1/public/quote': () => apiError(422, 'bus_limit_exceeded', 'Parcel too big for bus baggage. Use cargo.') }) });
    await step1(u);
    await step2(u);
    await step3(u);
    expect(await screen.findByText('Parcel too big for bus baggage. Use cargo.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  it('insurance asks for the declared value and prices the premium', async () => {
    const u = userEvent.setup({ delay: null });
    const { api } = renderApp({ path: '/receive', routes: routes({ 'POST /v1/public/quote': (i) => json((i.body as { insure: boolean }).insure ? quote({ insurance: { premium: money('1.5'), insuredAmount: money('150') }, total: money('5.5') }) : quote()) }) });
    await step1(u);
    await step2(u);
    await step3(u);
    await waitFor(() => expect(screen.getByTestId('total')).toHaveTextContent('$4.00'));
    await u.click(screen.getByRole('checkbox', { name: /Add insurance/ }));
    await u.type(await screen.findByLabelText('Declared value (USD)'), '150');
    await waitFor(() => expect(screen.getByTestId('total')).toHaveTextContent('$5.50'), { timeout: 3000 });
    expect(screen.getByText('Insurance premium')).toBeTruthy();
    expect(api.find('POST', '/v1/public/quote').at(-1)!.body).toMatchObject({ insure: true, declaredValueUsd: '150.00' });
  });

  it('keeps an unfinished parcel across a reload and lets the agent start over', async () => {
    const u = userEvent.setup({ delay: null });
    const first = renderApp({ path: '/receive', routes: routes() });
    await step1(u);
    await screen.findByText('Step 2 of 5');
    first.unmount();

    renderApp({ path: '/receive', routes: routes() });
    expect(await screen.findByText('We restored your unfinished parcel.')).toBeTruthy();
    expect(screen.getByText('Step 2 of 5')).toBeTruthy();
    await u.click(screen.getByRole('button', { name: 'Start over' }));
    expect(await screen.findByText('Step 1 of 5')).toBeTruthy();
    expect(loadDraft('u-1')).toBeNull();
  });
});

describe('registering is safe on a bad connection', () => {
  it('after a timeout the same tap-again re-sends the SAME idempotency key (the customer is never charged twice)', async () => {
    const u = userEvent.setup({ delay: null });
    let n = 0;
    const { api } = renderApp({ path: '/receive', routes: routes({ 'POST /v1/shipments': () => (++n === 1 ? Promise.reject(new TypeError('Failed to fetch')) : created()) }) });
    await toPinStep(u);
    await typePin(u);
    await submit(u);
    expect(await screen.findByText(/safe to try again/)).toBeTruthy();
    await submit(u);
    expect(await screen.findByTestId('waybill')).toBeTruthy();
    const keys = api.find('POST', '/v1/shipments').map((c) => c.init.headers['Idempotency-Key']);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it('a refusal by the server (e.g. not enough deposit) shows its message; the next try is a brand-new request', async () => {
    const u = userEvent.setup({ delay: null });
    let n = 0;
    const { api } = renderApp({ path: '/receive', routes: routes({ 'POST /v1/shipments': () => (++n === 1 ? apiError(422, 'insufficient_deposit', 'Deposit too low. Top up first.') : created()) }) });
    await toPinStep(u);
    await typePin(u);
    await submit(u);
    expect(await screen.findByText('Deposit too low. Top up first.')).toBeTruthy();
    expect(screen.queryByText(/safe to try again/)).toBeNull();
    await submit(u);
    await screen.findByTestId('waybill');
    const keys = api.find('POST', '/v1/shipments').map((c) => c.init.headers['Idempotency-Key']);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it('going back to edit after a lost connection first checks whether the parcel was actually registered — and if so, shows it instead of letting the agent register it again', async () => {
    const u = userEvent.setup({ delay: null });
    const { api } = renderApp({
      path: '/receive',
      routes: routes({ 'POST /v1/shipments': () => Promise.reject(new TypeError('Failed to fetch')), 'GET /v1/shipments': () => json({ items: [shipment], nextBefore: null }) }),
    });
    await toPinStep(u);
    await typePin(u);
    await submit(u);
    await screen.findByText(/safe to try again/);
    await u.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByTestId('waybill')).toHaveTextContent('670S-DIL-BCU-261121-0042');
    expect(api.find('POST', '/v1/shipments')).toHaveLength(1); // no second registration
  });

  it('…and if the earlier attempt never arrived, editing is allowed and the old key is dropped', async () => {
    const u = userEvent.setup({ delay: null });
    renderApp({ path: '/receive', routes: routes({ 'POST /v1/shipments': () => Promise.reject(new TypeError('Failed to fetch')), 'GET /v1/shipments': () => json({ items: [], nextBefore: null }) }) });
    await toPinStep(u);
    await typePin(u);
    await submit(u);
    await screen.findByText(/safe to try again/);
    await u.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByText('Step 3 of 5')).toBeTruthy();
    expect(sessionStorage.getItem('670send.idem.intake')).toBeNull();
  });

  it('never keeps the PIN anywhere on the phone', async () => {
    const u = userEvent.setup({ delay: null });
    renderApp({ path: '/receive', routes: routes({ 'POST /v1/shipments': () => Promise.reject(new TypeError('Failed to fetch')) }) });
    await toPinStep(u);
    await typePin(u, '482913');
    await submit(u);
    await screen.findByText(/safe to try again/);
    const stored = JSON.stringify({ ...sessionStorage }) + JSON.stringify({ ...localStorage });
    expect(stored).not.toContain('482913');
  });
});

describe('courier: collecting at the door', () => {
  it('only offers pick-up schemes and pre-fills the sender from the assigned booking', async () => {
    const jobs = { pickups: [{ id: 'b-1', batchCode: 'PB-261121-AB12CD', senderName: 'Ana Sender', senderPhone: '+67077111222', pickupAddress: 'Rua do Sol 3', lat: null, lng: null, parcelCount: 3, scheme: 'SCHEME_D' }], readyForDelivery: [], outForDelivery: [] };
    renderApp({ roles: ['COURIER'], profile: courierProfile, path: '/receive?booking=b-1', routes: routes({ 'GET /v1/courier/jobs': () => json(jobs) }) });
    expect(await screen.findByDisplayValue('Ana Sender')).toBeTruthy();
    expect(screen.getByDisplayValue('+67077111222')).toBeTruthy();
    const service = screen.getByLabelText('Service') as HTMLSelectElement;
    expect(within(service).getAllByRole('option').map((o) => o.textContent)).toEqual(['Pick-Up to Agent', 'Door to Door (Premium)']);
    expect(service.value).toBe('SCHEME_D');
    expect(screen.getByDisplayValue('Rua do Sol 3')).toBeTruthy(); // address on the sender block
  });

  it('a courier outside Díli can only send TO Díli', async () => {
    const baucauCourier = { ...courierProfile, municipality: { code: 'BCU', name: 'Baucau' } } as typeof courierProfile;
    renderApp({ roles: ['COURIER'], profile: baucauCourier, path: '/receive', routes: routes() });
    const dest = (await screen.findByLabelText('Destination municipality')) as HTMLSelectElement;
    await waitFor(() => expect(dest.value).toBe('DIL'));
    expect(within(dest).getAllByRole('option').map((o) => o.textContent).filter((t) => t !== '—')).toEqual(['Díli']);
  });
});
