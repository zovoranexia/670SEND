'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { Locale, ShipmentStatus } from '@670send/types';
import { IconAlert, IconCheck, IconCopy, IconPin, IconSearch } from '@/components/icons';
import { useRouter } from '@/i18n/navigation';
import { ApiRequestError, publicApi, type TrackResult } from '@/lib/api';
import { formatDiliDateTime, mapLink, normalizeWaybill, WAYBILL_SHAPE } from '@/lib/format';

type View =
  | { kind: 'idle' }
  | { kind: 'loading'; waybill: string }
  | { kind: 'ok'; result: TrackResult }
  | { kind: 'problem'; reason: 'invalid' | 'notFound' | 'network' | 'generic'; message?: string };

export function Tracker() {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const router = useRouter();
  const search = useSearchParams();
  const uid = useId();
  const noParam = search.get('no') ?? '';

  const [input, setInput] = useState(noParam);
  const [view, setView] = useState<View>({ kind: 'idle' });
  const abortRef = useRef<AbortController | null>(null);

  // The URL is the single source of truth: ?no=… is what WhatsApp links carry and what "copy link" shares.
  useEffect(() => {
    abortRef.current?.abort();
    if (!noParam) {
      setView({ kind: 'idle' });
      return;
    }
    const waybill = normalizeWaybill(noParam);
    setInput(waybill);
    if (!WAYBILL_SHAPE.test(waybill)) {
      setView({ kind: 'problem', reason: 'invalid' });
      return;
    }
    const ctl = new AbortController();
    abortRef.current = ctl;
    setView({ kind: 'loading', waybill });
    publicApi
      .track(waybill, locale, ctl.signal)
      .then((result) => setView({ kind: 'ok', result }))
      .catch((err: unknown) => {
        if ((err as { name?: string }).name === 'AbortError') return;
        const e = err as ApiRequestError;
        setView(e.isNotFound ? { kind: 'problem', reason: 'notFound' } : e.isNetwork ? { kind: 'problem', reason: 'network' } : { kind: 'problem', reason: 'generic', message: e.message });
      });
    return () => ctl.abort();
    // The API answer does not depend on the UI language (labels are translated here), so only the waybill re-fetches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noParam]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const waybill = normalizeWaybill(input);
    if (!WAYBILL_SHAPE.test(waybill)) {
      setInput(waybill);
      setView({ kind: 'problem', reason: 'invalid' });
      return;
    }
    if (waybill === normalizeWaybill(noParam)) {
      // same number again → a fresh look (the parcel may have moved)
      setView({ kind: 'loading', waybill });
      publicApi.track(waybill, locale).then((result) => setView({ kind: 'ok', result })).catch(() => setView({ kind: 'problem', reason: 'generic' }));
      return;
    }
    router.replace({ pathname: '/track', query: { no: waybill } });
  }

  const problemText = (v: Extract<View, { kind: 'problem' }>) => (v.reason === 'invalid' ? t('web.tracker.invalid') : v.reason === 'notFound' ? t('web.tracker.notFound') : v.reason === 'network' ? t('web.tracker.errorNetwork') : v.message || t('web.calculator.errorGeneric'));

  return (
    <div className="mx-auto max-w-3xl">
      <form onSubmit={onSubmit} className="card" noValidate>
        <label htmlFor={`${uid}-no`} className="field-label">
          {t('web.tracker.title')}
        </label>
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            id={`${uid}-no`}
            name="no"
            type="text"
            className="input font-mono uppercase"
            placeholder="670S-DIL-BCU-261121-0042"
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            aria-describedby={`${uid}-hint`}
            aria-invalid={view.kind === 'problem' && view.reason === 'invalid' ? true : undefined}
          />
          <button type="submit" className="btn btn-primary shrink-0" disabled={view.kind === 'loading'}>
            <IconSearch width={20} height={20} />
            {view.kind === 'loading' ? t('web.tracker.searching') : t('web.tracker.button')}
          </button>
        </div>
        <p id={`${uid}-hint`} className="field-hint">
          {t('web.tracker.format')}
        </p>
      </form>

      <div aria-live="polite" className="mt-6">
        {view.kind === 'problem' && (
          <p className="rounded-xl border border-red-300 bg-red-50 p-4 text-base font-medium text-red-900" role="alert">
            {problemText(view)}
          </p>
        )}
        {view.kind === 'loading' && <p className="p-4 text-center text-slate-600">{t('web.tracker.searching')}</p>}
        {view.kind === 'ok' && <Result result={view.result} locale={locale} />}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------ */

function Result({ result, locale }: { result: TrackResult; locale: Locale }) {
  const t = useTranslations();
  const [copied, setCopied] = useState(false);
  const status = result.status as ShipmentStatus;
  const reachedCount = result.steps.filter((s) => s.reachedAt).length;
  const currentIndex = result.steps.findIndex((s) => s.current);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      /* clipboard blocked: the address bar still has the link */
    }
  }

  return (
    <article className="space-y-6" aria-labelledby="track-waybill">
      <header className="card">
        <p className="text-sm font-semibold uppercase tracking-wide text-slate-600">{t('web.nav.track')}</p>
        <h2 id="track-waybill" className="mt-1 break-all font-mono text-xl font-bold text-brand-800 sm:text-2xl">
          {result.waybill}
        </h2>
        <p className="mt-3 text-lg font-semibold text-slate-900">
          {result.origin} → {result.destination}
        </p>
        <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-brand-50 px-4 py-2 font-bold text-brand-800" data-testid="track-status">
          <span className="h-2.5 w-2.5 rounded-full bg-brand-700" aria-hidden="true" />
          {t(`status.${status}.label`)}
        </div>
        <dl className="mt-5 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-slate-600">{t('web.tracker.sender')}</dt>
            <dd className="font-semibold text-slate-900">{result.sender}</dd>
          </div>
          <div>
            <dt className="text-slate-600">{t('web.tracker.recipient')}</dt>
            <dd className="font-semibold text-slate-900">{result.recipient}</dd>
          </div>
          <div>
            <dt className="text-slate-600">{t('web.tracker.transport')}</dt>
            <dd className="font-semibold text-slate-900">{t(`web.calculator.canal.${result.canal}`)}</dd>
          </div>
          <div>
            <dt className="text-slate-600">{t('web.tracker.lastUpdate')}</dt>
            <dd className="font-semibold text-slate-900">{formatDiliDateTime(result.lastUpdate, locale)}</dd>
          </div>
        </dl>
        <button type="button" onClick={copyLink} className="btn btn-outline mt-5 !min-h-10 !px-4 !py-1.5 text-sm">
          <IconCopy width={18} height={18} />
          {copied ? t('web.tracker.copied') : t('web.tracker.copyLink')}
        </button>
      </header>

      {result.exception && (
        <div className="flex gap-3 rounded-2xl border-2 border-amber-400 bg-amber-50 p-5" role="status">
          <IconAlert width={28} height={28} className="mt-0.5 shrink-0 text-accent-600" />
          <div>
            <p className="text-sm font-bold uppercase tracking-wide text-accent-700">{t('web.tracker.exceptionTitle')}</p>
            <p className="mt-1 text-lg font-bold text-slate-900">{t(`status.${result.exception}.label`)}</p>
            <p className="mt-1 text-base text-slate-800">{t(`status.${result.exception}.description`)}</p>
          </div>
        </div>
      )}

      <section className="card" aria-labelledby="progress-title">
        <h3 id="progress-title" className="text-lg font-bold text-brand-800">
          {t('web.tracker.progress')}
        </h3>
        {currentIndex >= 0 && <p className="sr-only">{t('web.tracker.stepOf', { current: currentIndex + 1, total: result.steps.length })}</p>}
        <ol className="mt-5">
          {result.steps.map((step, i) => {
            const reached = Boolean(step.reachedAt);
            const last = i === result.steps.length - 1;
            const s = step.status as ShipmentStatus;
            return (
              <li key={step.status} className="relative flex gap-4 pb-6 last:pb-0" aria-current={step.current ? 'step' : undefined}>
                {!last && <span className={`absolute left-[15px] top-8 h-[calc(100%-2rem)] w-0.5 ${reached && i < reachedCount - 1 ? 'bg-brand-700' : 'bg-slate-300'}`} aria-hidden="true" />}
                <span
                  className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 ${
                    reached ? 'border-brand-700 bg-brand-700 text-white' : step.current ? 'border-accent-600 bg-white' : 'border-slate-300 bg-white'
                  }`}
                  aria-hidden="true"
                >
                  {reached ? <IconCheck width={18} height={18} strokeWidth={3} /> : step.current ? <span className="h-3 w-3 rounded-full bg-accent-600" /> : null}
                </span>
                <div className="min-w-0 flex-1">
                  <p className={`text-base font-bold ${reached || step.current ? 'text-brand-800' : 'text-slate-600'}`}>
                    {t(`status.${s}.label`)}
                    <span className="sr-only"> — {reached ? t('web.tracker.reached') : step.current ? t('web.tracker.current') : t('web.tracker.pending')}</span>
                  </p>
                  {reached && <p className="text-sm text-slate-600">{formatDiliDateTime(step.reachedAt!, locale)}</p>}
                  {(step.current || (reached && i === reachedCount - 1 && !result.exception)) && <p className="mt-1 text-base text-slate-700">{t(`status.${s}.description`)}</p>}
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      {result.kiosk && (
        <section className="card" aria-labelledby="kiosk-title">
          <h3 id="kiosk-title" className="flex items-center gap-2 text-lg font-bold text-brand-800">
            <IconPin width={22} height={22} />
            {t('web.tracker.destinationKiosk')}
          </h3>
          <p className="mt-3 text-lg font-bold text-slate-900">{result.kiosk.name}</p>
          <p className="text-base text-slate-700">{result.kiosk.address}</p>
          {result.kiosk.openingHours && (
            <p className="mt-1 text-sm text-slate-600">
              {t('web.tracker.openingHours')}: <span className="font-semibold text-slate-900">{result.kiosk.openingHours}</span>
            </p>
          )}
          {status === 'ARRIVED_AT_DEST_AGENT' && <p className="mt-4 rounded-xl bg-brand-50 p-4 text-base font-medium text-brand-900">{t('web.tracker.kioskHint')}</p>}
          {result.kiosk.lat != null && result.kiosk.lng != null && (
            <a href={mapLink(result.kiosk.lat, result.kiosk.lng)} target="_blank" rel="noopener noreferrer" className="btn btn-outline mt-4">
              {t('web.tracker.openMap')}
              <span className="sr-only">{t('web.a11y.external')}</span>
            </a>
          )}
        </section>
      )}
    </article>
  );
}
