import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useTranslations } from 'use-intl';
import { LOCALES, LOCALE_LABELS } from '@670send/types';
import { IconChevron, IconList, IconWallet } from '@/components/icons';
import { ErrorNote, Field, Notice, Page } from '@/components/ui';
import { useErrorText } from '@/hooks';
import { useLocaleState } from '@/i18n';
import { api } from '@/lib/api';
import { signOut } from '@/lib/auth';
import { isBluetoothSupported, printer, PrinterError } from '@/lib/printer';
import { setPrintLang, usePrintLang, type PrintLang } from '@/lib/prefs';
import { sessionStore, useSession } from '@/lib/session';
import { useInstallPrompt } from '@/pwa';
import pkg from '../../package.json';

/** ESC @ (initialise) + a few lines of text: lets an agent check the printer before the first real parcel. */
export function testPage(): Uint8Array {
  const enc = new TextEncoder();
  return new Uint8Array([0x1b, 0x40, ...enc.encode('670Send\n--------------------------------\nOK  58 mm\n\n\n\n')]);
}

export function ProfileScreen() {
  const t = useTranslations();
  const errorText = useErrorText();
  const { user, refreshToken } = useSession();
  const { locale, setLocale, profileSyncFailed } = useLocaleState();
  const printLang = usePrintLang();
  const { canInstall, install } = useInstallPrompt();
  const [printerName, setPrinterName] = useState<string | null>(printer.name);
  const [printerMsg, setPrinterMsg] = useState<string | null>(null);
  const isAgentOrCourier = Boolean(user?.scope.agentId || user?.scope.courierId);

  async function connect() {
    setPrinterMsg(null);
    try {
      setPrinterName(await printer.choose());
    } catch (e) {
      setPrinterMsg(e instanceof PrinterError && e.reason === 'cancelled' ? t('pwa.print.notFound') : t('pwa.print.failed', { reason: (e as Error).message }));
    }
  }
  async function test() {
    setPrinterMsg(null);
    try {
      await printer.print(testPage());
      setPrinterMsg(t('pwa.print.printed'));
    } catch (e) {
      setPrinterMsg(t('pwa.print.failed', { reason: (e as Error).message }));
    }
  }

  return (
    <Page title={t('pwa.nav.profile')}>
      {isAgentOrCourier && (
        <div className="card divide-y divide-slate-200 !p-0">
          <Link to="/parcels" className="flex min-h-14 items-center justify-between px-4">
            <span className="flex items-center gap-3 font-semibold">
              <IconList /> {t('pwa.parcels.title')}
            </span>
            <IconChevron className="text-slate-500" />
          </Link>
          <Link to="/wallet" className="flex min-h-14 items-center justify-between px-4">
            <span className="flex items-center gap-3 font-semibold">
              <IconWallet /> {t('pwa.wallet.title')}
            </span>
            <IconChevron className="text-slate-500" />
          </Link>
        </div>
      )}

      <section className="card space-y-3" aria-labelledby="lang-h">
        <h2 id="lang-h" className="h2">
          {t('pwa.settings.language')}
        </h2>
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-labelledby="lang-h">
          {LOCALES.map((l) => (
            <button key={l} type="button" role="radio" aria-checked={l === locale} lang={l} onClick={() => void setLocale(l)} className={`min-h-12 rounded-xl border-2 px-3 font-semibold ${l === locale ? 'border-brand-700 bg-brand-50 text-brand-800' : 'border-slate-300 bg-white text-slate-800'}`}>
              {LOCALE_LABELS[l].native}
            </button>
          ))}
        </div>
        <p className="field-hint">{t('pwa.settings.languageHint')}</p>
        {profileSyncFailed && <Notice tone="warn">{t('pwa.settings.languageSaveFailed')}</Notice>}
      </section>

      {isAgentOrCourier && (
        <section className="card space-y-3" aria-labelledby="printer-h">
          <h2 id="printer-h" className="h2">
            {t('pwa.settings.printer')}
          </h2>
          <p className="field-hint !mt-0">{t('pwa.settings.printerHint')}</p>
          {isBluetoothSupported() ? (
            <>
              <p className="font-semibold">{printerName ? t('pwa.settings.printerConnected', { name: printerName }) : t('pwa.settings.printerNone')}</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn btn-outline" onClick={() => void connect()}>
                  {t('pwa.settings.connectPrinter')}
                </button>
                {printerName && (
                  <>
                    <button type="button" className="btn btn-outline" onClick={() => void test()}>
                      {t('pwa.settings.testPrint')}
                    </button>
                    <button type="button" className="min-h-12 px-3 font-semibold underline" onClick={() => (printer.forget(), setPrinterName(null))}>
                      {t('pwa.settings.forgetPrinter')}
                    </button>
                  </>
                )}
              </div>
            </>
          ) : (
            <Notice tone="warn">{t('pwa.print.unsupported')}</Notice>
          )}
          {printerMsg && <p className="text-base" role="status">{printerMsg}</p>}
          <Field label={t('pwa.settings.printLang')}>
            {(p) => (
              <select {...p} className="input" value={printLang} onChange={(e) => setPrintLang(e.target.value as PrintLang)}>
                <option value="auto">{t('pwa.settings.printLangAuto')}</option>
                {LOCALES.map((l) => (
                  <option key={l} value={l}>
                    {LOCALE_LABELS[l].native}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </section>
      )}

      <ChangePin onError={errorText} />

      {canInstall && (
        <section className="card space-y-2">
          <h2 className="h2">{t('pwa.app.installTitle')}</h2>
          <p className="field-hint !mt-0">{t('pwa.app.installBody')}</p>
          <button type="button" className="btn btn-primary" onClick={() => void install()}>
            {t('pwa.app.install')}
          </button>
        </section>
      )}

      <button type="button" className="btn btn-outline w-full" onClick={() => signOut(refreshToken, user?.id)}>
        {t('pwa.auth.signOut')}
      </button>
      <p className="text-center text-sm text-slate-600">
        {t('pwa.app.name')} · {t('pwa.settings.version', { version: pkg.version })}
      </p>
    </Page>
  );
}

function ChangePin({ onError }: { onError: (e: unknown) => string }) {
  const t = useTranslations();
  const { refreshToken } = useSession();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = /^\d{6}$/.test(current) && /^\d{6}$/.test(next);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      await api.changePin(current, next);
      // The server ends every session after a PIN change; leave cleanly and say why on the login screen.
      sessionStore.signOut('pin_changed');
    } catch (err) {
      setError(onError(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="card space-y-3" aria-labelledby="pin-h">
      <h2 id="pin-h" className="h2">
        {t('pwa.settings.changePin')}
      </h2>
      {error && <ErrorNote>{error}</ErrorNote>}
      <Field label={t('pwa.settings.currentPin')}>
        {(p) => <input {...p} className="input" type="password" inputMode="numeric" maxLength={6} autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value.replace(/\D/g, ''))} />}
      </Field>
      <Field label={t('pwa.settings.newPin')}>
        {(p) => <input {...p} className="input" type="password" inputMode="numeric" maxLength={6} autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value.replace(/\D/g, ''))} />}
      </Field>
      <button type="submit" className="btn btn-outline" disabled={!valid || busy}>
        {t('pwa.settings.changePin')}
      </button>
    </form>
  );
}
