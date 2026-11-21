import { Logger } from '@nestjs/common';
import type { Env } from '../config/env';

export const WHATSAPP_ADAPTER = Symbol('WHATSAPP_ADAPTER');

export interface WhatsAppMessage {
  /** E.164 with leading +, e.g. +67077123456 */
  to: string;
  body: string;
}

export interface WhatsAppSendResult {
  providerMessageId?: string;
}

export class WhatsAppSendError extends Error {
  constructor(
    message: string,
    /** false = permanent failure (bad number, template rejected…) → do not retry */
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'WhatsAppSendError';
  }
}

/** Pluggable provider contract: Meta Cloud API, Fonnte, WAHA, or the dev console logger. */
export interface IWhatsAppAdapter {
  readonly name: string;
  send(message: WhatsAppMessage): Promise<WhatsAppSendResult>;
}

const digits = (e164: string) => e164.replace(/\D/g, '');

/** HTTP helper: network errors and 5xx / 429 are retryable, other 4xx are permanent. */
async function postJson(url: string, init: RequestInit, provider: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
  } catch (err) {
    throw new WhatsAppSendError(`${provider}: network error: ${(err as Error).message}`, true);
  }
  const text = await res.text();
  if (!res.ok) {
    const retryable = res.status >= 500 || res.status === 429;
    throw new WhatsAppSendError(`${provider}: HTTP ${res.status} ${text.slice(0, 200)}`, retryable);
  }
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

/** Development sandbox: logs the message (OTPs included — never use in production) and remembers it. */
export class ConsoleWhatsAppAdapter implements IWhatsAppAdapter {
  readonly name = 'console';
  readonly sent: Array<WhatsAppMessage & { at: Date }> = [];
  private readonly log = new Logger('WhatsApp[console]');

  async send(message: WhatsAppMessage): Promise<WhatsAppSendResult> {
    this.sent.push({ ...message, at: new Date() });
    this.log.log(`→ ${message.to}: ${message.body.replace(/\n/g, ' ⏎ ')}`);
    return { providerMessageId: `console-${this.sent.length}` };
  }
}

/**
 * Meta WhatsApp Cloud API. NOTE: free-text messages are only delivered inside the 24-hour customer
 * service window; business-initiated notifications need pre-approved templates (see ARCHITECTURE.md).
 * Until templates are approved, use Fonnte / WAHA, or register each template in 4 languages with Meta.
 */
export class MetaCloudWhatsAppAdapter implements IWhatsAppAdapter {
  readonly name = 'meta';
  constructor(private readonly env: Env) {}

  async send(message: WhatsAppMessage): Promise<WhatsAppSendResult> {
    const url = `https://graph.facebook.com/${this.env.META_WA_API_VERSION}/${this.env.META_WA_PHONE_NUMBER_ID}/messages`;
    const json = (await postJson(
      url,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.env.META_WA_ACCESS_TOKEN}` },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: digits(message.to),
          type: 'text',
          text: { preview_url: true, body: message.body },
        }),
      },
      'meta',
    )) as { messages?: Array<{ id?: string }> };
    return { providerMessageId: json.messages?.[0]?.id };
  }
}

export class FonnteWhatsAppAdapter implements IWhatsAppAdapter {
  readonly name = 'fonnte';
  constructor(private readonly env: Env) {}

  async send(message: WhatsAppMessage): Promise<WhatsAppSendResult> {
    const json = (await postJson(
      'https://api.fonnte.com/send',
      {
        method: 'POST',
        headers: { authorization: this.env.FONNTE_TOKEN!, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ target: digits(message.to), message: message.body }).toString(),
      },
      'fonnte',
    )) as { status?: boolean; id?: string[] | string; reason?: string };
    // Fonnte answers 200 with {status:false, reason} for rejected sends.
    if (json.status === false) throw new WhatsAppSendError(`fonnte: ${json.reason ?? 'rejected'}`, false);
    return { providerMessageId: Array.isArray(json.id) ? json.id[0] : json.id };
  }
}

export class WahaWhatsAppAdapter implements IWhatsAppAdapter {
  readonly name = 'waha';
  constructor(private readonly env: Env) {}

  async send(message: WhatsAppMessage): Promise<WhatsAppSendResult> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.env.WAHA_API_KEY) headers['x-api-key'] = this.env.WAHA_API_KEY;
    const json = (await postJson(
      `${this.env.WAHA_BASE_URL!.replace(/\/$/, '')}/api/sendText`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ session: this.env.WAHA_SESSION, chatId: `${digits(message.to)}@c.us`, text: message.body }),
      },
      'waha',
    )) as { id?: string | { _serialized?: string } };
    const id = typeof json.id === 'string' ? json.id : json.id?._serialized;
    return { providerMessageId: id };
  }
}

export function createWhatsAppAdapter(env: Env): IWhatsAppAdapter {
  switch (env.WHATSAPP_PROVIDER) {
    case 'meta':
      return new MetaCloudWhatsAppAdapter(env);
    case 'fonnte':
      return new FonnteWhatsAppAdapter(env);
    case 'waha':
      return new WahaWhatsAppAdapter(env);
    default:
      return new ConsoleWhatsAppAdapter();
  }
}
