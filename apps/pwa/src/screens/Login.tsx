import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router';
import { useTranslations } from 'use-intl';
import { tlPhoneSchema } from '@670send/validation';
import { LOCALES, LOCALE_LABELS } from '@670send/types';
import { Field, ErrorNote, Notice } from '@/components/ui';
import { useErrorText } from '@/hooks';
import { useLocaleState } from '@/i18n';
import { api } from '@/lib/api';
import { sessionStore, useSession } from '@/lib/session';

export function LoginScreen() {
  const t = useTranslations();
  const errorText = useErrorText();
  const { user, endedBecause } = useSession();
  const { locale, setLocale } = useLocaleState();
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (user) return <Navigate to="/" replace />;

  const phoneOk = tlPhoneSchema.safeParse(phone).success;
  const pinOk = /^\d{6}$/.test(pin);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    setError(null);
    if (!phoneOk || !pinOk) return;
    setBusy(true);
    try {
      const res = await api.loginPin(tlPhoneSchema.parse(phone), pin);
      sessionStore.signIn(res.user, res);
    } catch (err) {
      setError(errorText(err));
      setPin('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-8">
      <div className="mb-6 flex justify-center gap-2" role="group" aria-label={t('common.language.label')}>
        {LOCALES.map((l) => (
          <button
            key={l}
            type="button"
            lang={l}
            onClick={() => void setLocale(l)}
            aria-pressed={l === locale}
            className={`min-h-11 min-w-14 rounded-full px-3 text-sm font-bold ${l === locale ? 'bg-brand-700 text-white' : 'bg-white text-brand-800 ring-1 ring-slate-300'}`}
          >
            {LOCALE_LABELS[l].short}
          </button>
        ))}
      </div>

      <div className="mb-6 text-center">
        <img src="/icons/icon-192.png" alt="" width={72} height={72} className="mx-auto h-[72px] w-[72px] rounded-2xl" />
        <h1 className="mt-3 text-2xl font-extrabold text-brand-800">{t('pwa.auth.title')}</h1>
        <p className="mt-1 text-slate-600">{t('pwa.auth.subtitle')}</p>
      </div>

      <form onSubmit={submit} noValidate className="card space-y-4">
        {endedBecause === 'expired' && <Notice tone="warn">{t('pwa.auth.sessionExpired')}</Notice>}
        {endedBecause === 'pin_changed' && <Notice tone="ok">{t('pwa.settings.pinChanged')}</Notice>}
        {error && <ErrorNote>{error}</ErrorNote>}
        <Field label={t('pwa.auth.phone')} hint="+670 7712 3456" error={touched && !phoneOk ? t('errors.validation.phone') : undefined}>
          {(p) => <input {...p} className="input" type="tel" inputMode="tel" autoComplete="username" value={phone} onChange={(e) => setPhone(e.target.value)} />}
        </Field>
        <Field label={t('pwa.auth.pin')} error={touched && !pinOk ? t('errors.validation.pin') : undefined}>
          {(p) => <input {...p} className="input tracking-[0.5em]" type="password" inputMode="numeric" pattern="[0-9]*" maxLength={6} autoComplete="current-password" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />}
        </Field>
        <button type="submit" className="btn btn-primary w-full" disabled={busy}>
          {busy ? t('pwa.auth.submitting') : t('pwa.auth.submit')}
        </button>
        <p className="text-center text-sm text-slate-600">{t('pwa.auth.forgotPin')}</p>
      </form>
    </main>
  );
}
