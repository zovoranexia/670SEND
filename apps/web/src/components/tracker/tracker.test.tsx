import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiError, trackFixture } from '@/test/fixtures';
import { json, renderIntl } from '@/test/render';
import { nav } from '@/test/setup';
import { Tracker } from './tracker';

const WB = '670S-DIL-BCU-261121-0001';
let fetchMock: ReturnType<typeof vi.fn>;
const urlOf = (i = -1) => fetchMock.mock.calls.at(i)![0] as string;

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue(json(trackFixture()));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('<Tracker />', () => {
  it('does nothing until there is a waybill', () => {
    renderIntl(<Tracker />);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Search' })).toBeEnabled();
  });

  it('opens a WhatsApp link (?no=…), cleans up the number and shows the parcel', async () => {
    nav.search = 'no=670s-dil-bcu-261121-0001';
    renderIntl(<Tracker />);
    expect(await screen.findByRole('heading', { name: WB })).toBeTruthy();
    expect(urlOf()).toMatch(new RegExp(`/v1/public/track/${WB}$`));
    expect(screen.getByRole('textbox')).toHaveValue(WB);
    expect(screen.getByTestId('track-status')).toHaveTextContent('In transit');
    expect(screen.getByText('M**** d* C****')).toBeTruthy(); // names arrive masked from the API, shown as received
    expect(screen.getByText('Díli → Baucau')).toBeTruthy();
    expect(screen.getByText('Official bus baggage')).toBeTruthy();
    // last update 03:00 UTC = 12:00 in Díli
    expect(screen.getAllByText(/21\/11\/2026,? 12:00/).length).toBeGreaterThan(0);
  });

  it('draws the timeline: reached steps with time, the current one marked, upcoming ones waiting', async () => {
    nav.search = `no=${WB}`;
    renderIntl(<Tracker />);
    await screen.findByRole('heading', { name: WB });
    const list = screen.getByRole('list');
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(6);
    expect(items.filter((li) => li.getAttribute('aria-current') === 'step')).toHaveLength(1);
    expect(within(items[2]!).getByText(/In transit/)).toBeTruthy();
    expect(items[2]!.getAttribute('aria-current')).toBe('step');
    expect(within(items[0]!).getByText(/Reached/)).toBeTruthy(); // screen-reader text
    expect(within(items[3]!).getByText(/Waiting/)).toBeTruthy();
    expect(within(items[2]!).getByText(/travelling on the official fleet/i)).toBeTruthy(); // only the current step explains itself
    expect(within(items[3]!).queryByText(/arrived/i, { selector: 'p:not(.font-bold)' })).toBeNull();
  });

  it('speaks the visitor’s language (Tetun status names)', async () => {
    nav.search = `no=${WB}`;
    renderIntl(<Tracker />, 'tet');
    await screen.findByRole('heading', { name: WB });
    expect(screen.getByTestId('track-status')).toHaveTextContent('Iha dalan');
  });

  it('flags a bad format without bothering the API', async () => {
    const user = userEvent.setup({ delay: null });
    renderIntl(<Tracker />);
    await user.type(screen.getByRole('textbox'), 'hello world');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('does not look like a waybill');
    expect(screen.getByRole('textbox').getAttribute('aria-invalid')).toBe('true');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a valid number goes into the URL (so the link can be shared) and the URL drives the lookup', async () => {
    const user = userEvent.setup({ delay: null });
    renderIntl(<Tracker />);
    await user.type(screen.getByRole('textbox'), ` ${WB.toLowerCase()} `);
    await user.click(screen.getByRole('button', { name: 'Search' }));
    expect(nav.replace).toHaveBeenCalledWith({ pathname: '/track', query: { no: WB } });
  });

  it('an unknown waybill gets the friendly "not found", not an error dump', async () => {
    fetchMock.mockResolvedValue(json(apiError(404, 'not_found', 'Not found'), 404));
    nav.search = 'no=670S-DIL-BCU-261121-9999';
    renderIntl(<Tracker />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Waybill not found');
  });

  it('a dead connection is explained, not shown as "not found"', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    nav.search = `no=${WB}`;
    renderIntl(<Tracker />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/cannot reach the server/i);
  });

  it('shows the hold / return banner for exception states', async () => {
    fetchMock.mockResolvedValue(json(trackFixture({ status: 'ON_HOLD_ISSUE', exception: 'ON_HOLD_ISSUE', steps: trackFixture().steps.map((s) => ({ ...s, current: false })) })));
    nav.search = `no=${WB}`;
    renderIntl(<Tracker />);
    const banner = await screen.findByRole('status');
    expect(banner).toHaveTextContent('Attention');
    expect(banner).toHaveTextContent('On hold');
    expect(banner).toHaveTextContent(/CS team will contact you/i);
  });

  it('shows the destination kiosk, the OTP reminder and a safe map link once the parcel has arrived', async () => {
    fetchMock.mockResolvedValue(
      json(
        trackFixture({
          status: 'ARRIVED_AT_DEST_AGENT',
          steps: trackFixture().steps.map((s) => (['ARRIVED_AT_DEST_AGENT'].includes(s.status) ? { ...s, reachedAt: '2026-11-21T05:00:00Z', current: true } : { ...s, current: false })),
          kiosk: { name: 'Kios 670Link Baucau Vila', address: 'Rua Principal, Baucau', openingHours: '08:00-18:00', lat: -8.4714, lng: 126.4576 },
        }),
      ),
    );
    nav.search = `no=${WB}`;
    renderIntl(<Tracker />);
    const kiosk = (await screen.findByRole('heading', { name: 'Destination kiosk' })).closest('section')!;
    expect(within(kiosk).getByText('Kios 670Link Baucau Vila')).toBeTruthy();
    expect(within(kiosk).getByText('08:00-18:00')).toBeTruthy();
    expect(within(kiosk).getByText(/Bring your ID and the 6-digit OTP/)).toBeTruthy();
    const map = within(kiosk).getByRole('link', { name: /Open in map/ });
    expect(map).toHaveAttribute('href', expect.stringContaining('openstreetmap.org/?mlat=-8.4714&mlon=126.4576'));
    expect(map).toHaveAttribute('target', '_blank');
    expect(map.getAttribute('rel')).toContain('noopener');
  });

  it('no kiosk card before the parcel has arrived, and no OTP reminder once delivered', async () => {
    nav.search = `no=${WB}`;
    const { unmount } = renderIntl(<Tracker />);
    await screen.findByRole('heading', { name: WB });
    expect(screen.queryByRole('heading', { name: 'Destination kiosk' })).toBeNull();
    unmount();

    fetchMock.mockResolvedValue(json(trackFixture({ status: 'DELIVERED', kiosk: { name: 'K', address: 'A', openingHours: null, lat: null, lng: null } })));
    renderIntl(<Tracker />);
    await screen.findByRole('heading', { name: 'Destination kiosk' });
    expect(screen.queryByText(/6-digit OTP/)).toBeNull();
    expect(screen.queryByRole('link', { name: /Open in map/ })).toBeNull(); // no coordinates → no map link
  });

  it('"copy link" puts the current address on the clipboard', async () => {
    const user = userEvent.setup({ delay: null });
    nav.search = `no=${WB}`;
    renderIntl(<Tracker />);
    await screen.findByRole('heading', { name: WB });
    const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    await user.click(screen.getByRole('button', { name: 'Copy link' }));
    await waitFor(() => expect(write).toHaveBeenCalledWith(window.location.href));
    expect(await screen.findByRole('button', { name: 'Link copied' })).toBeTruthy();
  });
});
