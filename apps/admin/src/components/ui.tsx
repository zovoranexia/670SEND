import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'use-intl';
import { useErrorText, type Resource } from '@/hooks';
import { IconAlert, IconClose } from './icons';

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
    <div className="flex items-start gap-3 rounded-lg border border-red-300 bg-red-50 p-3 text-red-900" role="alert">
      <IconAlert width={20} height={20} className="mt-0.5 shrink-0" />
      <div className="flex-1">
        <p className="text-sm font-medium">{children}</p>
        {onRetry && (
          <button type="button" onClick={onRetry} className="mt-1 font-semibold underline">
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
    <div className={`rounded-lg border p-3 text-sm ${tones[tone]}`} role={tone === 'warn' ? 'alert' : 'status'}>
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
  return <p className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-slate-600">{children}</p>;
}

/** Shows loading / error / the content of a resource — every screen's list or detail goes through this. */
export function Await<T>({ res, children, empty }: { res: Resource<T>; children: (data: T) => ReactNode; empty?: (data: T) => boolean }) {
  const errorText = useErrorText();
  if (res.error && res.data === undefined) return <ErrorNote onRetry={res.reload}>{errorText(res.error)}</ErrorNote>;
  if (res.data === undefined) return <Loading />;
  return (
    <>
      {res.error ? <ErrorNote onRetry={res.reload}>{errorText(res.error)}</ErrorNote> : null}
      {empty?.(res.data) ? <EmptyRow /> : children(res.data)}
    </>
  );
}
function EmptyRow() {
  const t = useTranslations();
  return <Empty>{t('admin.common.empty')}</Empty>;
}

export function Page({ title, subtitle, children, actions }: { title: string; subtitle?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section aria-labelledby="page-title" className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 id="page-title" className="h1">
            {title}
          </h1>
          {subtitle && <p className="mt-1 text-sm text-slate-600">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

/** A titled block inside a tab (the page itself owns the h1). */
export function Section({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="h2 text-lg">{title}</h2>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

const TONES = {
  slate: 'bg-slate-100 text-slate-800',
  brand: 'bg-brand-100 text-brand-900',
  green: 'bg-emerald-100 text-emerald-900',
  amber: 'bg-amber-100 text-amber-950',
  red: 'bg-red-100 text-red-900',
  accent: 'bg-accent-100 text-accent-700',
} as const;
export type Tone = keyof typeof TONES;
export function Badge({ tone = 'slate', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`badge ${TONES[tone]}`}>{children}</span>;
}

export function StatCard({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: string; tone?: 'warn' | 'bad' }) {
  const ring = tone === 'bad' ? 'border-red-300 bg-red-50' : tone === 'warn' ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-white';
  return (
    <div className={`rounded-xl border p-4 shadow-sm ${ring}`}>
      <p className="text-xs font-bold tracking-wide text-slate-600 uppercase">{label}</p>
      <p className="mt-1 text-2xl font-extrabold text-brand-800">{value}</p>
      {hint && <p className="mt-1 text-sm text-slate-600">{hint}</p>}
    </div>
  );
}

/** Simple horizontal tab list; the caller keeps the active key. */
export function Tabs<K extends string>({ tabs, active, onChange, label }: { tabs: Array<{ key: K; label: string; count?: number }>; active: K; onChange: (k: K) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="flex flex-wrap gap-1 border-b border-slate-300">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          id={`tab-${tab.key}`}
          aria-selected={tab.key === active}
          aria-controls={`panel-${tab.key}`}
          onClick={() => onChange(tab.key)}
          className={`-mb-px min-h-10 rounded-t-lg border border-b-0 px-4 text-sm font-semibold ${tab.key === active ? 'border-slate-300 bg-white text-brand-800' : 'border-transparent text-slate-600 hover:text-brand-800'}`}
        >
          {tab.label}
          {tab.count != null && <span className="ml-2 rounded-full bg-slate-200 px-1.5 text-xs">{tab.count}</span>}
        </button>
      ))}
    </div>
  );
}
export const TabPanel = ({ k, children }: { k: string; children: ReactNode }) => (
  <div role="tabpanel" id={`panel-${k}`} aria-labelledby={`tab-${k}`} className="space-y-4 pt-4">
    {children}
  </div>
);

/** Modal dialog on the native <dialog>: focus trap, Escape and backdrop come from the platform. */
export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const t = useTranslations();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => {
      if (d?.open) d.close();
    };
  }, []);
  return (
    <dialog ref={ref} aria-labelledby={titleId} onCancel={(e) => (e.preventDefault(), onClose())} onClick={(e) => e.target === ref.current && onClose()} className={`m-auto w-full rounded-2xl p-0 shadow-2xl backdrop:bg-slate-900/50 ${wide ? 'max-w-4xl' : 'max-w-lg'}`}>
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-3">
        <h2 id={titleId} className="h2 text-lg">
          {title}
        </h2>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} aria-label={t('common.actions.close')}>
          <IconClose />
        </button>
      </div>
      <div className="max-h-[75vh] space-y-4 overflow-y-auto p-5">{children}</div>
    </dialog>
  );
}

/** Confirm a consequential action; an optional mandatory reason goes to the audit log. */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  danger,
  reasonLabel,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  title: string;
  message?: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  /** When set, a reason (≥ 5 characters) is required and passed to onConfirm. */
  reasonLabel?: string;
  busy?: boolean;
  error?: string | null;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}) {
  const t = useTranslations();
  const [reason, setReason] = useState('');
  const needsReason = reasonLabel !== undefined;
  const ok = !needsReason || reason.trim().length >= 5;
  return (
    <Modal title={title} onClose={onClose}>
      {message && <div className="text-base text-slate-800">{message}</div>}
      {needsReason && (
        <Field label={reasonLabel} hint={t('admin.common.reasonHint')}>
          {(p) => <textarea {...p} className="input min-h-24" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />}
        </Field>
      )}
      {error && <ErrorNote>{error}</ErrorNote>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-outline" onClick={onClose} disabled={busy}>
          {t('common.actions.cancel')}
        </button>
        <button type="button" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} disabled={busy || !ok} onClick={() => onConfirm(reason.trim())}>
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

/** Table frame with a caption for screen readers; rows come from the caller. */
export function DataTable({ caption, head, children }: { caption: string; head: ReactNode; children: ReactNode }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>{head}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
