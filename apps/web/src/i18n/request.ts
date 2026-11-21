import { hasLocale } from 'next-intl';
import { getRequestConfig } from 'next-intl/server';
import { getMessages, messages as allMessages } from '@670send/i18n';
import { routing } from './routing';

type Dict = Record<string, unknown>;

/** Tetun fills any hole in another language (parity tests make holes unlikely; this makes them harmless). */
function withFallback(base: Dict, over: Dict): Dict {
  const out: Dict = { ...base };
  for (const [k, v] of Object.entries(over)) {
    const b = out[k];
    out[k] = v && typeof v === 'object' && b && typeof b === 'object' ? withFallback(b as Dict, v as Dict) : v;
  }
  return out;
}

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;
  const messages = locale === routing.defaultLocale ? getMessages(locale) : withFallback(allMessages[routing.defaultLocale] as Dict, getMessages(locale) as Dict);
  return { locale, messages: messages as ReturnType<typeof getMessages>, timeZone: 'Asia/Dili' };
});
