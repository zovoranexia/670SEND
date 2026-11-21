'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { ITEM_CATEGORIES, SERVICE_SCHEMES, type Locale } from '@670send/types';
import { IconSwap } from '@/components/icons';
import { ApiRequestError, publicApi, type Quote } from '@/lib/api';
import { buildQuoteRequest, DEFAULT_FORM, type CalcForm, type FieldError, type FieldKey } from '@/lib/calculator';
import { coerceRoute, groupByCorridor } from '@/lib/municipalities';
import { QuoteResult } from './quote-result';

const DEBOUNCE_MS = 450;

type Status = { kind: 'idle' } | { kind: 'loading'; previous?: Quote } | { kind: 'ok'; quote: Quote } | { kind: 'error'; message: string; previous?: Quote };

function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      {children}
      {hint && !error && (
        <p id={`${id}-hint`} className="field-hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-err`} className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function Calculator() {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const uid = useId();
  const id = (n: string) => `${uid}-${n}`;
  const search = useSearchParams();

  const initialScheme = (SERVICE_SCHEMES as readonly string[]).includes(search.get('scheme') ?? '') ? (search.get('scheme') as CalcForm['scheme']) : DEFAULT_FORM.scheme;
  const [form, setForm] = useState<CalcForm>({ ...DEFAULT_FORM, scheme: initialScheme });
  const [dirty, setDirty] = useState<Set<FieldKey>>(new Set());
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  const built = useMemo(() => buildQuoteRequest(form), [form]);
  const requestKey = built.ok ? JSON.stringify(built.request) : null;
  const abortRef = useRef<AbortController | null>(null);
  const lastQuote = status.kind === 'ok' ? status.quote : status.kind === 'loading' || status.kind === 'error' ? status.previous : undefined;

  async function run(request: Extract<typeof built, { ok: true }>['request']) {
    abortRef.current?.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;
    setStatus((s) => ({ kind: 'loading', previous: s.kind === 'ok' ? s.quote : s.kind === 'loading' || s.kind === 'error' ? s.previous : undefined }));
    try {
      const quote = await publicApi.quote(request, locale, ctl.signal);
      if (!ctl.signal.aborted) setStatus({ kind: 'ok', quote });
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') return;
      const e = err as ApiRequestError;
      const message = e.isNetwork ? t('web.calculator.errorNetwork') : e.message || t('web.calculator.errorGeneric');
      setStatus((s) => ({ kind: 'error', message, previous: s.kind === 'ok' ? s.quote : s.kind === 'loading' ? s.previous : undefined }));
    }
  }

  // Live: recalculate shortly after the visitor stops typing (and when the language changes → localized ETA / errors).
  useEffect(() => {
    if (!built.ok) {
      abortRef.current?.abort();
      setStatus({ kind: 'idle' });
      return;
    }
    const timer = setTimeout(() => void run(built.request), DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- requestKey captures built.request
  }, [requestKey, locale]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const set = <K extends keyof CalcForm>(key: K, value: CalcForm[K], field?: FieldKey) => {
    setForm((f) => ({ ...f, [key]: value }));
    if (field) setDirty((d) => new Set(d).add(field));
  };
  const setRoute = (which: 'origin' | 'dest', value: string) => {
    setForm((f) => {
      const next = coerceRoute({ origin: which === 'origin' ? value : f.origin, dest: which === 'dest' ? value : f.dest }, which);
      return { ...f, origin: next.origin, dest: next.dest };
    });
  };

  const errors = !built.ok ? built.errors : {};
  const showErr = (k: FieldKey): FieldError | undefined => (dirty.has(k) ? errors[k] : undefined);
  const errText = (e?: FieldError): string | undefined => {
    if (!e) return undefined;
    switch (e.key) {
      case 'sameRoute':
        return t('web.calculator.sameRoute');
      case 'needDili':
        return t('web.calculator.needDili');
      case 'max':
        return t('web.form.max', { max: e.params?.max ?? 0 });
      case 'number':
        return t('web.form.number');
      case 'positive':
        return t('web.form.positive');
      default:
        return t('web.form.required');
    }
  };
  const aria = (name: string, e?: FieldError, hint?: boolean) => ({ 'aria-invalid': e ? true : undefined, 'aria-describedby': e ? `${id(name)}-err` : hint ? `${id(name)}-hint` : undefined });

  const groups = groupByCorridor();
  const munOptions = (
    <>
      {groups.map((g) => (
        <optgroup key={g.corridor} label={t(`web.corridors.${g.corridor}`)}>
          {g.items.map((m) => (
            <option key={m.code} value={m.code}>
              {m.name}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  );

  const numeric = (name: 'weight' | 'length' | 'width' | 'height', label: string, unit: string) => (
    <Field id={id(name)} label={`${label}`} error={errText(showErr(name))}>
      <div className="relative">
        <input id={id(name)} className="input pr-12" type="text" inputMode="decimal" autoComplete="off" value={form[name]} onChange={(e) => set(name, e.target.value, name)} onBlur={() => setDirty((d) => new Set(d).add(name))} {...aria(name, showErr(name))} />
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-slate-600" aria-hidden="true">
          {unit}
        </span>
      </div>
    </Field>
  );

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-start">
      <form
        className="card space-y-8"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setDirty(new Set<FieldKey>(['weight', 'length', 'width', 'height', 'declared', 'route']));
          if (built.ok) void run(built.request);
        }}
      >
        {/* ----------------------------------------------------------- route */}
        <fieldset>
          <legend className="text-lg font-bold text-brand-800">{t('web.calculator.routeTitle')}</legend>
          <div className="mt-3 grid items-end gap-3 sm:grid-cols-[1fr_auto_1fr]">
            <Field id={id('origin')} label={t('web.calculator.origin')}>
              <select id={id('origin')} className="input" value={form.origin} onChange={(e) => setRoute('origin', e.target.value)}>
                {munOptions}
              </select>
            </Field>
            <button type="button" className="btn btn-outline mx-auto h-11 w-11 !min-h-0 !p-0" aria-label={t('web.calculator.swap')} title={t('web.calculator.swap')} onClick={() => setForm((f) => ({ ...f, origin: f.dest, dest: f.origin }))}>
              <IconSwap width={20} height={20} />
            </button>
            <Field id={id('dest')} label={t('web.calculator.destination')}>
              <select id={id('dest')} className="input" value={form.dest} onChange={(e) => setRoute('dest', e.target.value)}>
                {munOptions}
              </select>
            </Field>
          </div>
          <p className="field-hint">{t('web.calculator.routeHint')}</p>
          {showErr('route') && (
            <p className="field-error" role="alert">
              {errText(showErr('route'))}
            </p>
          )}
        </fieldset>

        {/* ---------------------------------------------------------- parcel */}
        <fieldset>
          <legend className="text-lg font-bold text-brand-800">{t('web.calculator.parcelTitle')}</legend>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            {numeric('weight', t('web.calculator.weight'), t('web.calculator.kg'))}
            <Field id={id('category')} label={t('web.calculator.category')}>
              <select id={id('category')} className="input" value={form.category} onChange={(e) => set('category', e.target.value)}>
                {ITEM_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {t(`web.calculator.categories.${c}`)}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            {numeric('length', t('web.calculator.length'), t('web.calculator.cm'))}
            {numeric('width', t('web.calculator.width'), t('web.calculator.cm'))}
            {numeric('height', t('web.calculator.height'), t('web.calculator.cm'))}
          </div>
          <div className="mt-4 flex flex-wrap gap-x-8 gap-y-3">
            <label className="flex min-h-11 items-center gap-3 text-base">
              <input type="checkbox" className="h-5 w-5 accent-brand-700" checked={form.fragile} onChange={(e) => set('fragile', e.target.checked)} />
              {t('web.calculator.fragile')}
            </label>
            <label className="flex min-h-11 items-center gap-3 text-base">
              <input type="checkbox" className="h-5 w-5 accent-brand-700" checked={form.heavyBulk} onChange={(e) => set('heavyBulk', e.target.checked)} />
              {t('web.calculator.heavyBulk')}
            </label>
          </div>
        </fieldset>

        {/* --------------------------------------------------------- options */}
        <fieldset>
          <legend className="text-lg font-bold text-brand-800">{t('web.calculator.optionsTitle')}</legend>
          <div className="mt-3">
            <Field id={id('scheme')} label={t('web.calculator.scheme')} hint={t(`web.home.schemeDesc.${form.scheme}`)}>
              <select id={id('scheme')} className="input" value={form.scheme} onChange={(e) => set('scheme', e.target.value as CalcForm['scheme'])} aria-describedby={`${id('scheme')}-hint`}>
                {SERVICE_SCHEMES.map((s) => (
                  <option key={s} value={s}>
                    {t(`web.schemes.${s}`)}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="mt-4">
            <label className="flex min-h-11 items-center gap-3 text-base">
              <input type="checkbox" className="h-5 w-5 accent-brand-700" checked={form.insure} onChange={(e) => set('insure', e.target.checked, 'declared')} />
              {t('web.calculator.insure')}
            </label>
            {form.insure && (
              <div className="mt-3 max-w-xs">
                <Field id={id('declared')} label={t('web.calculator.declaredValue')} hint={t('web.calculator.insureHint')} error={errText(showErr('declared'))}>
                  <input id={id('declared')} className="input" type="text" inputMode="decimal" autoComplete="off" value={form.declared} onChange={(e) => set('declared', e.target.value, 'declared')} onBlur={() => setDirty((d) => new Set(d).add('declared'))} {...aria('declared', showErr('declared'), true)} />
                </Field>
              </div>
            )}
          </div>
        </fieldset>

        <button type="submit" className="btn btn-primary w-full sm:w-auto" disabled={status.kind === 'loading'}>
          {status.kind === 'loading' ? t('web.calculator.calculating') : t('web.calculator.calculate')}
        </button>
      </form>

      {/* ----------------------------------------------------------- result */}
      <div className="lg:sticky lg:top-24" aria-live="polite" aria-atomic="true">
        {status.kind === 'error' && (
          <p className="mb-4 rounded-xl border border-red-300 bg-red-50 p-4 text-base font-medium text-red-900" role="alert">
            {status.message}
          </p>
        )}
        {lastQuote ? (
          <QuoteResult quote={lastQuote} stale={status.kind === 'loading' || status.kind === 'error'} scheme={form.scheme} />
        ) : (
          <div className="card text-center text-slate-600">
            <p>{status.kind === 'loading' ? t('web.calculator.calculating') : t('web.calculator.lead')}</p>
          </div>
        )}
      </div>
    </div>
  );
}
