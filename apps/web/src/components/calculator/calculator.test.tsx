import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiError, quoteFixture, seaQuote } from '@/test/fixtures';
import { json, renderIntl } from '@/test/render';
import { nav } from '@/test/setup';
import { Calculator } from './calculator';

const WAIT = { timeout: 4000 };
let fetchMock: ReturnType<typeof vi.fn>;

const body = (call = -1) => JSON.parse((fetchMock.mock.calls.at(call)![1] as RequestInit).body as string);
const select = (name: RegExp) => screen.getByRole('combobox', { name });

beforeEach(() => {
  fetchMock = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
    const b = JSON.parse(init.body as string);
    return json(b.destMunicipalityCode === 'OEC' ? seaQuote() : quoteFixture({ destination: b.destMunicipalityCode, origin: b.originMunicipalityCode }));
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('<Calculator />', () => {
  it('quotes the default route by itself shortly after loading, and shows price, canal, ETA and breakdown', async () => {
    renderIntl(<Calculator />);
    expect(await screen.findByTestId('quote-total', undefined, WAIT)).toHaveTextContent('$4.00');
    expect(screen.getByTestId('quote-canal')).toHaveTextContent('Official bus baggage');
    expect(screen.getByText('1 day')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(body()).toMatchObject({ originMunicipalityCode: 'DIL', destMunicipalityCode: 'BCU', scheme: 'SCHEME_A', parcel: { actualWeightKg: 2, lengthCm: 30, widthCm: 20, heightCm: 10 } });
    expect((fetchMock.mock.calls[0]![1] as RequestInit & { headers: Record<string, string> }).headers['X-Lang']).toBe('en');
  });

  it('shows the ETA in the visitor’s language', async () => {
    renderIntl(<Calculator />, 'pt');
    expect(await screen.findByText('1 dia', undefined, WAIT)).toBeTruthy();
    expect((fetchMock.mock.calls[0]![1] as { headers: Record<string, string> }).headers['X-Lang']).toBe('pt');
  });

  it('recalculates live when the destination changes: Oecusse flips the canal to the ferry and shows the sea notice', async () => {
    const user = userEvent.setup({ delay: null });
    renderIntl(<Calculator />);
    await screen.findByTestId('quote-total', undefined, WAIT);
    await user.selectOptions(select(/destination municipality/i), 'OEC');
    await waitFor(() => expect(screen.getByTestId('quote-total')).toHaveTextContent('$8.00'), WAIT);
    expect(screen.getByTestId('quote-canal')).toHaveTextContent('Sea cargo');
    expect(screen.getByText(/exclusively on the official sea cargo manifest/i)).toBeTruthy();
  });

  it('keeps every route on Díli: picking a province as origin moves the destination to Díli', async () => {
    const user = userEvent.setup({ delay: null });
    renderIntl(<Calculator />);
    await user.selectOptions(select(/origin municipality/i), 'LAU');
    expect((select(/destination municipality/i) as HTMLSelectElement).value).toBe('DIL');
    await waitFor(() => expect(body()).toMatchObject({ originMunicipalityCode: 'LAU', destMunicipalityCode: 'DIL' }), WAIT);
  });

  it('swap button exchanges origin and destination', async () => {
    const user = userEvent.setup({ delay: null });
    renderIntl(<Calculator />);
    await user.click(screen.getByRole('button', { name: /swap origin and destination/i }));
    expect((select(/origin municipality/i) as HTMLSelectElement).value).toBe('BCU');
    expect((select(/destination municipality/i) as HTMLSelectElement).value).toBe('DIL');
  });

  it('does not call the API for an invalid form; shows the inline error (comma decimals are fine)', async () => {
    const user = userEvent.setup({ delay: null });
    renderIntl(<Calculator />);
    await screen.findByTestId('quote-total', undefined, WAIT);
    fetchMock.mockClear();

    const weight = screen.getByRole('textbox', { name: /actual weight/i });
    await user.clear(weight);
    await user.type(weight, 'abc');
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a valid number.');
    expect(weight.getAttribute('aria-invalid')).toBe('true');
    await new Promise((r) => setTimeout(r, 700)); // longer than the debounce
    expect(fetchMock).not.toHaveBeenCalled();

    await user.clear(weight);
    await user.type(weight, '2,5');
    await waitFor(() => expect(body().parcel.actualWeightKg).toBe(2.5), WAIT);
  });

  it('insurance asks for the declared value and sends it', async () => {
    const user = userEvent.setup({ delay: null });
    renderIntl(<Calculator />);
    await user.click(screen.getByRole('checkbox', { name: /add insurance/i }));
    const declared = await screen.findByRole('textbox', { name: /declared value/i });
    await user.click(declared);
    await user.tab();
    expect(await screen.findByText('This field is required.')).toBeTruthy();
    await user.type(declared, '120');
    await waitFor(() => expect(body()).toMatchObject({ insure: true, declaredValueUsd: '120.00' }), WAIT);
  });

  it('shows the API’s own (already translated) message when it refuses, and keeps the last good quote greyed out', async () => {
    const user = userEvent.setup({ delay: null });
    renderIntl(<Calculator />);
    await screen.findByTestId('quote-total', undefined, WAIT);
    fetchMock.mockResolvedValueOnce(json(apiError(422, 'bus_limit_exceeded', 'This parcel is too big for bus baggage.'), 422));
    await user.click(screen.getByRole('checkbox', { name: /fragile/i }));
    const alert = await screen.findByRole('alert', undefined, WAIT);
    expect(alert).toHaveTextContent('This parcel is too big for bus baggage.');
    expect(screen.getByTestId('quote-total')).toBeTruthy(); // previous quote still visible, not a blank page
  });

  it('explains a dead connection plainly', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    renderIntl(<Calculator />);
    expect(await screen.findByRole('alert', undefined, WAIT)).toHaveTextContent(/cannot reach the server/i);
  });

  it('cancels the previous request when the visitor keeps changing things (no stale price can win)', async () => {
    const user = userEvent.setup({ delay: null });
    let release!: (r: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((r) => (release = r)));
    renderIntl(<Calculator />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1), WAIT); // first quote is now "in flight"
    await user.selectOptions(select(/destination municipality/i), 'OEC');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2), WAIT);
    expect((fetchMock.mock.calls[0]![1] as RequestInit).signal!.aborted).toBe(true);
    release(json(quoteFixture())); // the slow, stale $4.00 answer arrives late…
    await waitFor(() => expect(screen.getByTestId('quote-total')).toHaveTextContent('$8.00'), WAIT); // …and loses
  });

  it('preselects the scheme from the ?scheme= link on the landing page', async () => {
    nav.search = 'scheme=SCHEME_D';
    renderIntl(<Calculator />);
    expect((select(/service scheme/i) as HTMLSelectElement).value).toBe('SCHEME_D');
    await waitFor(() => expect(body().scheme).toBe('SCHEME_D'), WAIT);
  });

  it('ignores an unknown ?scheme= value', async () => {
    nav.search = 'scheme=EVIL';
    renderIntl(<Calculator />);
    expect((select(/service scheme/i) as HTMLSelectElement).value).toBe('SCHEME_A');
  });

  it('offers the booking link only for schemes that include a pick-up', async () => {
    const user = userEvent.setup({ delay: null });
    renderIntl(<Calculator />);
    await screen.findByTestId('quote-total', undefined, WAIT);
    expect(screen.queryByRole('link', { name: /book a pick-up/i })).toBeNull();
    await user.selectOptions(select(/service scheme/i), 'SCHEME_B');
    await waitFor(() => expect(screen.getByRole('link', { name: /book a pick-up/i })).toHaveProperty('href', expect.stringContaining('/book')), WAIT);
  });
});
