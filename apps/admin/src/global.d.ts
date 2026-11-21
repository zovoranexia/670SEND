import type { Locale, Messages } from '@670send/i18n';

// Type-safe translation keys: a typo in t('admin.dashboard.titel') fails the build instead of showing a raw key to staff.
declare module 'use-intl' {
  interface AppConfig {
    Locale: Locale;
    Messages: Messages;
  }
}
