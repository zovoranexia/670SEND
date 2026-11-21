import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';
import { PrinterError } from '@/lib/printer';
import { apiError, json, mockApi, signIn, user } from '@/test/helpers';
import { renderWithIntl } from '@/test/render';
import { PhotoField } from './PhotoField';
import { PrintActions } from './PrintActions';
import { ScanSheet } from './Scanner';

const fakePrinter = vi.hoisted(() => ({ connected: false, name: null as string | null, choose: vi.fn(), ensureConnected: vi.fn(), print: vi.fn(), disconnect: vi.fn(), forget: vi.fn() }));
const bluetooth = vi.hoisted(() => ({ supported: true }));
vi.mock('@/lib/printer', async (orig) => ({ ...(await orig<typeof import('@/lib/printer')>()), printer: fakePrinter, isBluetoothSupported: () => bluetooth.supported }));
vi.mock('@/lib/image', async (orig) => ({
  ...(await orig<typeof import('@/lib/image')>()),
  compressPhoto: vi.fn(async (f: Blob) => ({ blob: new Blob([new Uint8Array(412 * 1024)], { type: 'image/jpeg' }), width: 1600, height: 1200, quality: 0.8, originalBytes: f.size })),
}));

beforeEach(() => {
  Object.assign(fakePrinter, { connected: false, name: null });
  fakePrinter.choose.mockReset().mockImplementation(async () => ((fakePrinter.connected = true), (fakePrinter.name = 'MPT-II'), 'MPT-II'));
  fakePrinter.ensureConnected.mockReset().mockResolvedValue(undefined);
  fakePrinter.print.mockReset().mockResolvedValue(undefined);
  bluetooth.supported = true;
  URL.createObjectURL = vi.fn(() => 'blob:x');
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => vi.unstubAllGlobals());

/* ================================================================================================ scanner */
describe('<ScanSheet />', () => {
  const stream = () => {
    const stop = vi.fn();
    return { stop, stream: { getTracks: () => [{ stop }] } as unknown as MediaStream };
  };
  const camera = (impl: () => Promise<MediaStream>) => {
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: vi.fn(impl) }, configurable: true });
    HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  };
  afterEach(() => Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true }));

  it('reads a manifest QR, ignores codes this screen cannot use, and releases the camera afterwards', async () => {
    const s = stream();
    camera(async () => s.stream);
    const reads = ['https://example.com/not-ours', 'MF-261121-4FQ8TD'];
    const readerFactory = async () => async () => reads.shift() ?? null;
    const onCode = vi.fn();
    const { unmount } = renderWithIntl(<ScanSheet accept={['MANIFEST']} onCode={onCode} onClose={() => undefined} readerFactory={readerFactory} />);
    expect(await screen.findByText('That code is not valid here.')).toBeTruthy(); // the first frame was a stranger's QR
    await waitFor(() => expect(onCode).toHaveBeenCalledWith({ kind: 'MANIFEST', code: 'MF-261121-4FQ8TD' }), { timeout: 3000 });
    expect(onCode).toHaveBeenCalledTimes(1); // one hit, then it stops
    unmount();
    expect(s.stop).toHaveBeenCalled();
  });

  it('asks for the rear camera', async () => {
    const s = stream();
    camera(async () => s.stream);
    renderWithIntl(<ScanSheet accept={['WAYBILL']} onCode={vi.fn()} onClose={() => undefined} readerFactory={async () => async () => null} />);
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({ video: { facingMode: { ideal: 'environment' } }, audio: false }));
  });

  it('camera permission denied: explains it, and typing the code still works', async () => {
    const u = userEvent.setup({ delay: null });
    camera(async () => Promise.reject(Object.assign(new Error('no'), { name: 'NotAllowedError' })));
    const onCode = vi.fn();
    renderWithIntl(<ScanSheet accept={['WAYBILL']} onCode={onCode} onClose={() => undefined} />);
    expect(await screen.findByText(/Camera permission was denied/)).toBeTruthy();
    await u.type(screen.getByLabelText('Or type the code'), '670s-dil-bcu-261121-0042');
    await u.click(screen.getByRole('button', { name: 'Open' }));
    expect(onCode).toHaveBeenCalledWith({ kind: 'WAYBILL', code: '670S-DIL-BCU-261121-0042' });
  });

  it('no camera at all (old browser, no HTTPS): says so and falls back to typing', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true });
    renderWithIntl(<ScanSheet accept={['WAYBILL']} onCode={vi.fn()} onClose={() => undefined} />);
    expect(await screen.findByText('The camera is not available. Type the code instead.')).toBeTruthy();
  });

  it('the close button closes it', async () => {
    const u = userEvent.setup({ delay: null });
    const onClose = vi.fn();
    Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true });
    renderWithIntl(<ScanSheet accept={['WAYBILL']} onCode={vi.fn()} onClose={onClose} />);
    await u.click(await screen.findByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });
});

/* ========================================================================================== print actions */
describe('<PrintActions />', () => {
  const job = { lang: 'pt', kind: 'receipt', text: 'RECIBO\nGUIA 670S-DIL-BCU-261121-0042', escposBase64: btoa(String.fromCharCode(0x1b, 0x40, 65, 10)) };
  const show = (load = async () => job as never) => renderWithIntl(<PrintActions load={load} deps={['x']} />);

  it('prints on the Bluetooth printer: the first time the browser asks which printer, then it streams the ESC/POS bytes', async () => {
    const u = userEvent.setup({ delay: null });
    show();
    await u.click(await screen.findByRole('button', { name: 'Print receipt' }));
    expect(await screen.findByText('Printed.')).toBeTruthy();
    expect(fakePrinter.choose).toHaveBeenCalledOnce();
    expect([...(fakePrinter.print.mock.calls[0]![0] as Uint8Array)]).toEqual([0x1b, 0x40, 65, 10]);
  });

  it('reuses an already connected printer without asking again', async () => {
    const u = userEvent.setup({ delay: null });
    Object.assign(fakePrinter, { connected: true, name: 'MPT-II' });
    show();
    await u.click(await screen.findByRole('button', { name: 'Print receipt' }));
    await screen.findByText('Printed.');
    expect(fakePrinter.choose).not.toHaveBeenCalled();
  });

  it('a printer that went to sleep is reconnected quietly (no chooser)', async () => {
    const u = userEvent.setup({ delay: null });
    Object.assign(fakePrinter, { connected: false, name: 'MPT-II' });
    show();
    await u.click(await screen.findByRole('button', { name: 'Print receipt' }));
    await screen.findByText('Printed.');
    expect(fakePrinter.ensureConnected).toHaveBeenCalled();
    expect(fakePrinter.choose).not.toHaveBeenCalled();
  });

  it('closing the chooser is not an error; a write failure says what went wrong', async () => {
    const u = userEvent.setup({ delay: null });
    fakePrinter.choose.mockRejectedValueOnce(new PrinterError('cancelled'));
    show();
    await u.click(await screen.findByRole('button', { name: 'Print receipt' }));
    expect(await screen.findByText('No printer chosen.')).toBeTruthy();

    Object.assign(fakePrinter, { connected: true });
    fakePrinter.print.mockRejectedValueOnce(new PrinterError('write_failed', 'GATT write failed'));
    await u.click(screen.getByRole('button', { name: 'Print receipt' }));
    expect(await screen.findByText('Could not print: GATT write failed')).toBeTruthy();
  });

  it('without Web Bluetooth (iPhone, Firefox) there is no print button — only the options that work', async () => {
    bluetooth.supported = false;
    show();
    expect(await screen.findByText(/cannot print over Bluetooth/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Print receipt' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Print with the RawBT app' })).toHaveAttribute('href', `rawbt:base64,${job.escposBase64}`);
    expect(screen.getByRole('button', { name: /Share by WhatsApp/ })).toBeTruthy();
  });

  it('shares the receipt text through the phone’s share sheet, or falls back to WhatsApp web', async () => {
    const u = userEvent.setup({ delay: null });
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    show();
    await u.click(await screen.findByRole('button', { name: /Share by WhatsApp/ }));
    expect(share).toHaveBeenCalledWith({ text: job.text });

    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
    const open = vi.fn();
    vi.stubGlobal('open', open);
    await u.click(screen.getByRole('button', { name: /Share by WhatsApp/ }));
    expect(open).toHaveBeenCalledWith(`https://wa.me/?text=${encodeURIComponent(job.text)}`, '_blank', 'noopener');
  });

  it('copies the text; if the clipboard is blocked the text is shown so it can be selected by hand', async () => {
    const u = userEvent.setup({ delay: null });
    show();
    const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValueOnce();
    await u.click(await screen.findByRole('button', { name: 'Copy receipt text' }));
    expect(write).toHaveBeenCalledWith(job.text);
    expect(await screen.findByText('Copied.')).toBeTruthy();
    write.mockRejectedValueOnce(new Error('denied'));
    await u.click(screen.getByRole('button', { name: 'Copy receipt text' }));
    expect(await screen.findByLabelText('Preview')).toHaveTextContent('GUIA 670S-DIL-BCU-261121-0042');
  });

  it('shows the 32-column preview on demand, and offers retry when the receipt could not be loaded', async () => {
    const u = userEvent.setup({ delay: null });
    let n = 0;
    show(async () => (++n === 1 ? Promise.reject(new ApiError(0, 'network', 'network')) : (job as never)));
    expect(await screen.findByText('This needs a connection.')).toBeTruthy();
    await u.click(screen.getByRole('button', { name: 'Retry' }));
    await u.click(await screen.findByRole('button', { name: 'Preview' }));
    expect(screen.getByLabelText('Preview').tagName).toBe('PRE');
  });
});

/* =========================================================================================== photo field */
describe('<PhotoField />', () => {
  function Controlled({ onChange }: { onChange: (v: unknown) => void }) {
    const [id, setId] = useState<string | undefined>();
    return <PhotoField label="Photo of contents" photoType="OPEN_BOX_CONTENT" value={id} onChange={(v) => (onChange(v), setId(v?.id))} />;
  }
  const field = (onChange = vi.fn()) => ({ onChange, ...renderWithIntl(<Controlled onChange={onChange} />) });
  const pick = (u: ReturnType<typeof userEvent.setup>) => u.upload(document.querySelector<HTMLInputElement>('input[type=file]')!, new File(['x'], 'big.jpg', { type: 'image/jpeg' }));

  it('opens the rear camera, shrinks the picture, uploads it with its type, and reports the size', async () => {
    const u = userEvent.setup({ delay: null });
    signIn(user({ lang: 'en' }));
    const m = mockApi({ 'POST /v1/uploads/photos': () => json({ id: 'up-9' }, 201) });
    vi.stubGlobal('fetch', m.fn);
    const { onChange } = field();
    const input = document.querySelector<HTMLInputElement>('input[type=file]')!;
    expect(input).toHaveAttribute('capture', 'environment');
    expect(input).toHaveAttribute('accept', 'image/*');
    await pick(u);
    expect(await screen.findByText('Photo saved (412 KB)')).toBeTruthy();
    expect(onChange).toHaveBeenCalledWith({ id: 'up-9', kb: 412, previewUrl: 'blob:x' });
    const body = m.last().body as FormData;
    expect(body.get('photoType')).toBe('OPEN_BOX_CONTENT');
    expect((body.get('file') as File).type).toBe('image/jpeg');
    expect((body.get('file') as File).size).toBe(412 * 1024); // the compressed photo, not the original
  });

  it('a failed upload explains why and keeps the previous state; no connection says so', async () => {
    const u = userEvent.setup({ delay: null });
    signIn(user({ lang: 'en' }));
    vi.stubGlobal('fetch', mockApi({ 'POST /v1/uploads/photos': () => apiError(413, 'file_too_large', 'Photo too large (max 2048 KB).') }).fn);
    const { onChange } = field();
    await pick(u);
    expect(await screen.findByText('Photo too large (max 2048 KB).')).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    await pick(u);
    expect(await screen.findByText('This needs a connection.')).toBeTruthy();
  });

  it('can be retaken or removed', async () => {
    const u = userEvent.setup({ delay: null });
    signIn(user({ lang: 'en' }));
    vi.stubGlobal('fetch', mockApi({ 'POST /v1/uploads/photos': () => json({ id: 'up-9' }, 201) }).fn);
    const { onChange } = field();
    await pick(u);
    await screen.findByText(/Photo saved/);
    expect(screen.getByRole('button', { name: 'Retake' })).toBeTruthy();
    await u.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });
});
