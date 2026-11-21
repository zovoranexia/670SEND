import { Global, Injectable, Module } from '@nestjs/common';
import { I18nLoader, I18nModule, I18nService, type I18nTranslation } from 'nestjs-i18n';
import { FALLBACK_LOCALE, LOCALES, pickLocaleFromAcceptLanguage, type Locale } from '@670send/types';
import { messages } from '@670send/i18n';
import { RequestContext } from '../common/request-context';
import type { ErrorParams } from '../common/errors';

/**
 * Feeds nestjs-i18n from the shared `@670send/i18n` package, so the API, the web apps and the
 * WhatsApp templates all read ONE set of dictionaries (tet · pt · en · id).
 * nestjs-i18n expects `<lang>/<namespace>.json` folders; ours is one JSON per locale with
 * namespaces as top-level keys, hence a custom loader.
 */
export class SharedDictionaryLoader extends I18nLoader {
  async languages(): Promise<string[]> {
    return [...LOCALES];
  }
  async load(): Promise<I18nTranslation> {
    return messages as unknown as I18nTranslation;
  }
}

@Injectable()
export class LocalizationService {
  constructor(private readonly i18n: I18nService) {}

  /** Locale of the current request: X-Lang header → authenticated user's preference → Accept-Language → Tetun. */
  currentLocale(acceptLanguage?: string | null): Locale {
    const store = RequestContext.current();
    return store?.locale ?? store?.actor?.lang ?? pickLocaleFromAcceptLanguage(acceptLanguage);
  }

  translate(key: string, locale: Locale = FALLBACK_LOCALE, params?: ErrorParams): string {
    return this.i18n.translate(key, { lang: locale, args: params });
  }

  error(code: string, locale: Locale, params?: ErrorParams): string {
    return this.translate(`errors.${code}`, locale, params);
  }
}

@Global()
@Module({
  imports: [
    I18nModule.forRoot({
      fallbackLanguage: FALLBACK_LOCALE,
      loader: SharedDictionaryLoader,
      // Language is resolved by LocalizationService (needs the authenticated actor, which a
      // plain header resolver cannot see), so no automatic resolvers are registered.
      resolvers: [],
      logging: false,
    }),
  ],
  providers: [LocalizationService],
  exports: [LocalizationService],
})
export class AppI18nModule {}
