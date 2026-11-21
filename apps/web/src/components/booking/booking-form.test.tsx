import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiError } from '@/test/fixtures';
import { json, renderIntl } from '@/test/render';
import { BookingFormView } from './booking-form';

let fetchMock: ReturnType<typeof vi.fn>;
const sentBody = () => JSON.parse((fetchMock.mock.calls.at(-1)![1] as RequestInit).body as string);
const ok = { batchCode: 'PB-261121-AB12CD', status: 'REQUESTED', parcelCount: 1, phone: '+670****3456' };

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue(json(ok, 201));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

async function fillValid(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByRole('textbox', { name: 'Your name' }), 'Maria da Costa');
  await user.type(screen.getByRole('textbox', { name: /WhatsApp number/ }), '7712 3456');
  await user.type(screen.getByRole('textbox', { name: /Pick-up address or landmark/ }), 'Rua Central 12, Colmera');
}

describe('<BookingFormView />', () => {
  it('explains what is missing, focuses the first problem and sends nothing', async () => {
    const user = userEvent.setup({ delay: null });
    renderIntl(<BookingFormView />);
    await user.click(screen.getByRole('button', { name: 'Submit request' }));
    const alerts = screen.getAllByRole('alert').map((a) => a.textContent);
    expect(alerts).toEqual(expect.arrayContaining(['Incomplete name.', expect.stringContaining('WhatsApp-capable'), 'Enter at least 5 characters.']));
    expect(screen.getByRole('textbox', { name: 'Your name' })).toHaveFocus();
    expect(screen.getByRole('textbox', { name: 'Your name' }).getAttribute('aria-invalid')).toBe('true');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows a field’s error once the visitor leaves it, not while they are still typing', async () => {
    const user = userEvent.setup({ delay: null });
    renderIntl(<BookingFormView />);
    const phone = screen.getByRole('textbox', { name: /WhatsApp number/ });
    await user.type(phone, '77');
    expect(screen.queryByRole('alert')).toBeNull();
    await user.tab();
    expect(await screen.findByRole('alert')).toHaveTextContent('WhatsApp-capable');
  });

  it('submits a clean request (normalised phone, pin, language, scheme) and shows the reference to keep', async () => {
    const user = userEvent.setup({ delay: null });
    renderIntl(<BookingFormView />, 'pt');
    await user.type(screen.getByRole('textbox', { name: 'O seu nome' }), 'Maria da Costa');
    await user.type(screen.getByRole('textbox', { name: /Número de WhatsApp/ }), '+670 7712-3456');
    await user.type(screen.getByRole('textbox', { name: /Morada ou ponto de referência/ }), 'Rua Central 12, Colmera');
    await user.click(screen.getByTestId('fake-map')); // drops the pin
    await user.selectOptions(screen.getByRole('combobox', { name: 'Serviço' }), 'SCHEME_D');
    await user.selectOptions(screen.getByRole('combobox', { name: /Município de destino/ }), 'BCU');
    await user.click(screen.getByRole('button', { name: 'Enviar pedido' }));

    expect(await screen.findByTestId('booking-ref')).toHaveTextContent('PB-261121-AB12CD');
    expect(screen.getByRole('heading', { name: 'Pedido recebido' })).toBeTruthy();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toMatch(/\/v1\/public\/pickup-bookings$/);
    expect(init.method).toBe('POST');
    expect(init.headers['X-Lang']).toBe('pt');
    expect(sentBody()).toEqual({ senderName: 'Maria da Costa', senderPhone: '+67077123456', preferredLang: 'pt', scheme: 'SCHEME_D', destMunicipalityCode: 'BCU', parcelCount: 1, pickupAddress: 'Rua Central 12, Colmera', lat: -8.5569, lng: 125.5603 });
  });

  it('the WhatsApp-update language defaults to the page language and can be changed', async () => {
    const user = userEvent.setup({ delay: null });
    renderIntl(<BookingFormView />, 'id');
    await fillValid(user).catch(() => undefined);
    const lang = screen.getByRole('combobox', { name: /Bahasa pesan WhatsApp/ }) as HTMLSelectElement;
    expect(lang.value).toBe('id');
    await user.selectOptions(lang, 'tet');
    expect(lang.value).toBe('tet');
  });

  it('puts the server’s field errors next to the field and keeps what was typed', async () => {
    fetchMock.mockResolvedValue(json(apiError(422, 'validation_failed', 'Invalid data.', [{ path: 'senderPhone', message: 'Número recusado pelo servidor.' }]), 422));
    const user = userEvent.setup({ delay: null });
    renderIntl(<BookingFormView />);
    await fillValid(user);
    await user.click(screen.getByRole('button', { name: 'Submit request' }));
    expect(await screen.findByText('Número recusado pelo servidor.')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: /WhatsApp number/ })).toHaveValue('7712 3456');
    expect(screen.getAllByRole('alert').some((a) => a.textContent === 'Invalid data.')).toBe(true);
  });

  it('tells the visitor when the rate limit is hit or the connection is down — and lets them retry', async () => {
    const user = userEvent.setup({ delay: null });
    renderIntl(<BookingFormView />);
    await fillValid(user);
    fetchMock.mockResolvedValueOnce(json(apiError(429, 'too_many_requests', 'Too many requests. Please wait a few minutes.'), 429));
    await user.click(screen.getByRole('button', { name: 'Submit request' }));
    expect(await screen.findByText('Too many requests. Please wait a few minutes.')).toBeTruthy();
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await user.click(screen.getByRole('button', { name: 'Submit request' }));
    expect(await screen.findByText(/cannot reach the server/i)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Submit request' })); // third try works
    expect(await screen.findByTestId('booking-ref')).toBeTruthy();
  });

  it('cannot be double-submitted while the request is in flight', async () => {
    let release!: (r: Response) => void;
    fetchMock.mockImplementation(() => new Promise<Response>((r) => (release = r)));
    const user = userEvent.setup({ delay: null });
    renderIntl(<BookingFormView />);
    await fillValid(user);
    await user.click(screen.getByRole('button', { name: 'Submit request' }));
    const busy = await screen.findByRole('button', { name: 'Sending…' });
    expect(busy).toBeDisabled();
    await user.click(busy);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    release(json(ok, 201));
    expect(await screen.findByTestId('booking-ref')).toBeTruthy();
  });

  it('silently drops submissions where the hidden trap field was filled (bots)', async () => {
    const user = userEvent.setup({ delay: null });
    renderIntl(<BookingFormView />);
    await fillValid(user);
    const trap = document.querySelector('input[name=company]') as HTMLInputElement;
    expect(trap.closest('[aria-hidden=true]')).not.toBeNull();
    expect(trap.tabIndex).toBe(-1);
    await user.type(trap, 'Spam Inc');
    await user.click(screen.getByRole('button', { name: 'Submit request' }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await screen.findByRole('heading', { name: 'Request received' })).toBeTruthy(); // the bot learns nothing
  });

  it('"make another request" starts over with an empty form', async () => {
    const user = userEvent.setup({ delay: null });
    renderIntl(<BookingFormView />);
    await fillValid(user);
    await user.click(screen.getByRole('button', { name: 'Submit request' }));
    await user.click(await screen.findByRole('button', { name: 'Make another request' }));
    expect(screen.getByRole('textbox', { name: 'Your name' })).toHaveValue('');
    expect(screen.getByTestId('fake-map')).toHaveTextContent('map'); // pin cleared too
  });

  it('removing the pin clears it from the request', async () => {
    const user = userEvent.setup({ delay: null });
    renderIntl(<BookingFormView />);
    await fillValid(user);
    await user.click(screen.getByTestId('fake-map'));
    expect(screen.getByText(/Pin set at -8\.55690, 125\.56030/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Remove pin' }));
    expect(screen.getByText(/No pin yet/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Submit request' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(sentBody()).not.toHaveProperty('lat');
  });

  it('"use my location" asks the browser, fills the pin, and explains a refusal', async () => {
    const user = userEvent.setup({ delay: null });
    const getCurrentPosition = vi.fn((success: PositionCallback) => success({ coords: { latitude: -8.5569, longitude: 125.5603 } } as GeolocationPosition));
    vi.stubGlobal('navigator', { ...navigator, geolocation: { getCurrentPosition } });
    renderIntl(<BookingFormView />);
    await user.click(screen.getByRole('button', { name: 'Use my location' }));
    expect(await screen.findByText(/Pin set at -8\.55690/)).toBeTruthy();

    getCurrentPosition.mockImplementationOnce((_ok: PositionCallback, fail?: PositionErrorCallback | null) => fail?.({ code: 1 } as GeolocationPositionError));
    await user.click(screen.getByRole('button', { name: 'Use my location' }));
    expect(await screen.findByText(/could not get your location/i)).toBeTruthy();
    vi.unstubAllGlobals();
    vi.stubGlobal('fetch', fetchMock);
  });
});
