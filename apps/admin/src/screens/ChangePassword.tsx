import { useState, type FormEvent } from 'react';
import { useTranslations } from 'use-intl';
import { ErrorNote, Field, Notice } from '@/components/ui';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { useAction } from '@/hooks';
import { api } from '@/lib/api';
import { signOut } from '@/lib/auth';
import { useSession } from '@/lib/session';

/** Same rule the API enforces (≥ 12 characters, a letter and a digit, different from the current one). */
export function passwordProblem(current: string, next: string): 'short' | 'weak' | 'same' | null {
  if (next.length < 12) return 'short';
  if (!/[A-Za-z]/.test(next) || !/\d/.test(next)) return 'weak';
  if (next === current) return 'same';
  return null;
}

/**
 * A freshly provisioned (or reset) account may do nothing else until it replaces the password an admin typed.
 * The API refuses every other call with `password_change_required` until then. Changing it revokes all sessions:
 * the user signs in again with the new password.
 */
export function ChangePasswordScreen() {
  const t = useTranslations();
  const { user, refreshToken } = useSession();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [touched, setTouched] = useState(false);
  const action = useAction();

  const problem = passwordProblem(current, next);
  const mismatch = next !== confirm;
  const valid = current.length > 0 && !problem && !mismatch;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!valid) return;
    const ok = await action.run(() => api.changePassword(current, next));
    if (ok) signOut(refreshToken, 'password_changed');
  }

  const nextError = !touched ? undefined : problem === 'short' ? t('admin.auth.change.short') : problem === 'weak' ? t('errors.validation.password') : problem === 'same' ? t('admin.auth.change.same') : undefined;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-8">
      <div className="mb-6 flex justify-center">
        <LanguageSwitcher />
      </div>
      <h1 className="mb-1 text-2xl font-extrabold text-brand-800">{t('admin.auth.change.title')}</h1>
      <p className="mb-4 text-slate-600">{t('admin.auth.change.intro', { name: user?.fullName ?? '' })}</p>
      <form onSubmit={submit} noValidate className="card space-y-4">
        <Notice tone="warn">{t('admin.auth.change.rules')}</Notice>
        {action.error && <ErrorNote>{action.error}</ErrorNote>}
        <Field label={t('admin.auth.change.current')}>
          {(p) => <input {...p} className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />}
        </Field>
        <Field label={t('admin.auth.change.new')} error={nextError}>
          {(p) => <input {...p} className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />}
        </Field>
        <Field label={t('admin.auth.change.confirm')} error={touched && mismatch ? t('admin.auth.change.mismatch') : undefined}>
          {(p) => <input {...p} className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />}
        </Field>
        <button type="submit" className="btn btn-primary w-full" disabled={action.busy}>
          {t('admin.auth.change.submit')}
        </button>
        <button type="button" className="btn btn-ghost w-full" onClick={() => signOut(refreshToken)}>
          {t('admin.nav.signOut')}
        </button>
      </form>
    </main>
  );
}
