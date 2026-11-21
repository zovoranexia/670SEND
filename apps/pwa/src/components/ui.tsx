import { useId, type ReactNode } from 'react';
import { useTranslations } from 'use-intl';
import { IconAlert } from './icons';

/** Labelled form control with hint and error, wired for screen readers (aria-describedby / role=alert). */
export function Field({ label, hint, error, optional, children }: { label: string; hint?: string; error?: string; optional?: boolean; children: (props: { id: string; 'aria-invalid'?: true; 'aria-describedby'?: string }) => ReactNode }) {
  const t = useTranslations();
  const id = useId();
  const describedBy = error ? `${id}-err` : hint ? `${id}-hint` : undefined;
  return (
    <div>
      <label htmlFor={id} className="field-label">
        {label}
        {optional && <span className="ml-2 font-normal text-slate-600">({t('common.labels.optional')})</span>}
      </label>
      {children({ id, ...(error ? { 'aria-invalid': true as const } : {}), ...(describedBy ? { 'aria-describedby': describedBy } : {}) })}
      {error ? (
        <p id={`${id}-err`} className="field-error" role="alert">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-hint`} className="field-hint">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

export function ErrorNote({ children, onRetry }: { children: ReactNode; onRetry?: () => void }) {
  const t = useTranslations();
  return (
    <div className="flex items-start gap-3 rounded-xl border border-red-300 bg-red-50 p-3 text-red-900" role="alert">
      <IconAlert width={22} height={22} className="mt-0.5 shrink-0" />
      <div className="flex-1">
        <p className="text-base font-medium">{children}</p>
        {onRetry && (
          <button type="button" onClick={onRetry} className="mt-2 min-h-11 font-semibold underline">
            {t('common.actions.retry')}
          </button>
        )}
      </div>
    </div>
  );
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'ok'; children: ReactNode }) {
  const tones = { info: 'border-brand-200 bg-brand-50 text-brand-900', warn: 'border-amber-300 bg-amber-50 text-amber-950', ok: 'border-emerald-300 bg-emerald-50 text-emerald-950' };
  return (
    <div className={`rounded-xl border p-3 text-base ${tones[tone]}`} role={tone === 'warn' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

export function Loading() {
  const t = useTranslations();
  return (
    <p className="py-10 text-center text-slate-600" role="status">
      {t('common.labels.loading')}
    </p>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-600">{children}</p>;
}

export function Page({ title, back, children, actions }: { title: string; back?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="screen" aria-labelledby="page-title">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {back}
          <h1 id="page-title" className="h1 truncate">
            {title}
          </h1>
        </div>
        {actions}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}
