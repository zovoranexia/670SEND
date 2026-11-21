import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router';
import { useTranslations } from 'use-intl';
import { ErrorNote, Field, Notice } from '@/components/ui';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { useErrorText } from '@/hooks';
import { api } from '@/lib/api';
import { sessionStore, useSession } from '@/lib/session';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function LoginScreen() {
  const t = useTranslations();
  const errorText = useErrorText();
  const { user, endedBecause } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (user) return <Navigate to="/" replace />;

  const emailOk = EMAIL.test(email.trim());
  const passwordOk = password.length > 0;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    setError(null);
    if (!emailOk || !passwordOk) return;
    setBusy(true);
    try {
      const res = await api.login(email.trim().toLowerCase(), password);
      sessionStore.signIn(res.user, res);
    } catch (err) {
      setError(errorText(err));
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-8">
      <div className="mb-6 flex justify-center">
        <LanguageSwitcher />
      </div>
      <div className="mb-6 text-center">
        <img src="/favicon.svg" alt="" width={64} height={64} className="mx-auto h-16 w-16" />
        <h1 className="mt-3 text-2xl font-extrabold text-brand-800">{t('admin.auth.title')}</h1>
        <p className="mt-1 text-slate-600">{t('admin.auth.subtitle')}</p>
      </div>

      <form onSubmit={submit} noValidate className="card space-y-4">
        {endedBecause === 'expired' && <Notice tone="warn">{t('admin.auth.sessionExpired')}</Notice>}
        {endedBecause === 'password_changed' && <Notice tone="ok">{t('admin.auth.passwordChanged')}</Notice>}
        {error && <ErrorNote>{error}</ErrorNote>}
        <Field label={t('admin.auth.email')} error={touched && !emailOk ? t('admin.auth.emailInvalid') : undefined}>
          {(p) => <input {...p} className="input" type="email" inputMode="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />}
        </Field>
        <Field label={t('admin.auth.password')} error={touched && !passwordOk ? t('web.form.required') : undefined}>
          {(p) => <input {...p} className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
        </Field>
        <button type="submit" className="btn btn-primary w-full" disabled={busy}>
          {busy ? t('admin.auth.submitting') : t('admin.auth.submit')}
        </button>
        <p className="text-center text-sm text-slate-600">{t('admin.auth.forgot')}</p>
      </form>
    </main>
  );
}
