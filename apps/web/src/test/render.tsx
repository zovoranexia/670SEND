import { render } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { getMessages } from '@670send/i18n';
import type { Locale } from '@670send/types';

/** Render a client component with the real translations, exactly as the layout provides them. */
export function renderIntl(ui: ReactElement, locale: Locale = 'en') {
  const all = getMessages(locale);
  const messages = { common: all.common, web: all.web, status: all.status, errors: { validation: all.errors.validation } };
  return render(
    <NextIntlClientProvider locale={locale} messages={messages} timeZone="Asia/Dili">
      {ui}
    </NextIntlClientProvider>,
  );
}

/** A canned JSON response for the stubbed `fetch`. */
export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
