import type { Locale, Messages } from '@670send/i18n';

// Type-safe translation keys: a typo in t('wizard.titel') fails the build instead of showing a raw key to an agent.
declare module 'use-intl' {
  interface AppConfig {
    Locale: Locale;
    Messages: Messages;
  }
}
