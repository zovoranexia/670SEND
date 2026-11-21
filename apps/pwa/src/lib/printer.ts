/**
 * 58 mm thermal printers over Web Bluetooth (Chrome / Edge on Android; needs HTTPS and a tap on the button).
 * Cheap receipt printers expose one writable GATT characteristic under one of a handful of vendor service UUIDs;
 * we ask for all of them, find the writable characteristic, and stream the ESC/POS bytes in small chunks.
 * Where Web Bluetooth does not exist (iOS, Firefox) the screens offer the RawBT app, WhatsApp share or copy.
 */
export const PRINTER_SERVICES: BluetoothServiceUUID[] = [
  '000018f0-0000-1000-8000-00805f9b34fb', // most generic 58 mm printers
  '0000ffe0-0000-1000-8000-00805f9b34fb', // HM-10 style serial bridge
  '0000fff0-0000-1000-8000-00805f9b34fb',
  '0000ff00-0000-1000-8000-00805f9b34fb',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455', // ISSC transparent UART (Zjiang, many Xprinter)
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2', // Goojprt / PeriPage family
];

export const BLE_CHUNK = 100;
export const BLE_SAFE_CHUNK = 20; // the guaranteed ATT payload without MTU negotiation
const DELAY_MS = 25;

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function chunk(bytes: Uint8Array, size: number): Uint8Array[] {
  if (size < 1) throw new RangeError('chunk size must be ≥ 1');
  const out: Uint8Array[] = [];
  for (let i = 0; i < bytes.length; i += size) out.push(bytes.subarray(i, i + size));
  return out;
}

/** RawBT (Android app) accepts a base64 payload through its own URI scheme — a fallback that needs no Bluetooth API. */
export const rawBtUrl = (b64: string) => `rawbt:base64,${b64}`;

export const isBluetoothSupported = () => typeof navigator !== 'undefined' && 'bluetooth' in navigator;

export class PrinterError extends Error {
  constructor(public readonly reason: 'unsupported' | 'cancelled' | 'no_characteristic' | 'write_failed' | 'connect_failed', detail?: string) {
    super(detail ?? reason);
    this.name = 'PrinterError';
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class BluetoothPrinter {
  private device: BluetoothDevice | null = null;
  private characteristic: BluetoothRemoteGATTCharacteristic | null = null;
  private chunkSize = BLE_CHUNK;

  constructor(private readonly nav: Pick<Navigator, 'bluetooth'> = navigator) {}

  get name(): string | null {
    return this.device?.name ?? null;
  }
  get connected(): boolean {
    return Boolean(this.device?.gatt?.connected && this.characteristic);
  }

  /** Must run from a tap: the browser shows its device chooser. */
  async choose(): Promise<string> {
    if (!this.nav.bluetooth) throw new PrinterError('unsupported');
    try {
      this.device = await this.nav.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: PRINTER_SERVICES });
    } catch (e) {
      if ((e as { name?: string }).name === 'NotFoundError') throw new PrinterError('cancelled');
      throw new PrinterError('connect_failed', (e as Error).message);
    }
    this.device.addEventListener('gattserverdisconnected', () => {
      this.characteristic = null;
    });
    this.characteristic = null;
    await this.ensureConnected();
    return this.device.name ?? 'Printer';
  }

  async ensureConnected(): Promise<void> {
    if (!this.device) throw new PrinterError('cancelled');
    if (this.connected) return;
    try {
      const server = await (this.device.gatt!.connected ? this.device.gatt! : this.device.gatt!.connect());
      for (const service of await server.getPrimaryServices()) {
        for (const c of await service.getCharacteristics()) {
          if (c.properties.write || c.properties.writeWithoutResponse) {
            this.characteristic = c;
            return;
          }
        }
      }
    } catch (e) {
      throw new PrinterError('connect_failed', (e as Error).message);
    }
    throw new PrinterError('no_characteristic');
  }

  async print(bytes: Uint8Array): Promise<void> {
    await this.ensureConnected();
    try {
      await this.stream(bytes, this.chunkSize);
    } catch (first) {
      if (this.chunkSize === BLE_SAFE_CHUNK) throw new PrinterError('write_failed', (first as Error).message);
      // Some printers reject larger writes without MTU negotiation: retry the whole job with the safe size.
      this.chunkSize = BLE_SAFE_CHUNK;
      await this.ensureConnected();
      try {
        await this.stream(bytes, this.chunkSize);
      } catch (e) {
        throw new PrinterError('write_failed', (e as Error).message);
      }
    }
  }

  private async stream(bytes: Uint8Array, size: number): Promise<void> {
    const c = this.characteristic;
    if (!c) throw new PrinterError('no_characteristic');
    for (const part of chunk(bytes, size)) {
      const data = part as unknown as BufferSource;
      if (c.properties.writeWithoutResponse) await c.writeValueWithoutResponse(data);
      else await c.writeValueWithResponse(data);
      await sleep(DELAY_MS); // small printers have tiny buffers; flooding them drops bytes
    }
  }

  disconnect() {
    if (this.device?.gatt?.connected) this.device.gatt.disconnect();
    this.characteristic = null;
  }

  forget() {
    this.disconnect();
    this.device = null;
  }
}

/** One printer per app session. */
export const printer = new BluetoothPrinter();
