import type { Locale, Messages } from '@670send/i18n';

// Type-safe translation keys: a typo in t('web.calculator.totl') fails the build, not production.
declare module 'next-intl' {
  interface AppConfig {
    Locale: Locale;
    Messages: Messages;
  }
}
