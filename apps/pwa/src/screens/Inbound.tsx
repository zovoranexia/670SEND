import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { INBOUND_CONDITIONS, type InboundCondition } from '@670send/types';
import { WAYBILL_REGEX } from '@670send/validation';
import { Field } from '@/components/ui';
import { PhotoField } from '@/components/PhotoField';
import { ScanOrType } from '@/components/Scanner';
import { ErrorNote, Notice, Page } from '@/components/ui';
import { useErrorText } from '@/hooks';
import { api } from '@/lib/api';
import { normalizeWaybill } from '@/lib/format';
import type { Scanned } from '@/lib/scan';
import type { InboundResult } from '@/lib/types';

/** The destination kiosk receives a master bag (or one parcel) from the fleet driver, in front of the driver. */
export function InboundScreen() {
  const t = useTranslations();
  const errorText = useErrorText();
  const [scanned, setScanned] = useState<Scanned | null>(null);
  const [condition, setCondition] = useState<InboundCondition>('INTACT');
  const [notes, setNotes] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [missingText, setMissingText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<InboundResult | null>(null);
  const [attempted, setAttempted] = useState(false);

  const missing = missingText.split(/[\s,;]+/).map(normalizeWaybill).filter(Boolean);
  const missingBad = missing.some((w) => !WAYBILL_REGEX.test(w));
  const incident = condition !== 'INTACT' || missing.length > 0;
  const needsPhoto = incident && photos.length === 0;

  function reset() {
    setScanned(null);
    setCondition('INTACT');
    setNotes('');
    setPhotos([]);
    setMissingText('');
    setError(null);
    setResult(null);
    setAttempted(false);
  }

  async function submit() {
    setAttempted(true);
    if (needsPhoto || missingBad || !scanned) return;
    setBusy(true);
    setError(null);
    try {
      setResult(
        await api.inboundScan({
          code: scanned.code,
          condition,
          ...(notes.trim() ? { notes: notes.trim() } : {}),
          ...(photos.length ? { incidentPhotoUploadIds: photos } : {}),
          ...(scanned.kind === 'BAG' && missing.length ? { missingWaybills: missing } : {}),
        }),
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    const n = result.processed.length;
    return (
      <Page title={t('pwa.nav.inbound')}>
        <div className="card space-y-2 text-center" role="status">
          <p className="text-2xl font-extrabold text-brand-800">{t('pwa.inbound.received', { n })}</p>
          <p className="text-slate-700">{t('pwa.inbound.trip', { status: t(`pwa.driver.statuses.${result.manifest.status as 'READY'}`) })}</p>
        </div>
        {result.driverConfirmationRequired && <Notice tone="warn">{t('pwa.inbound.incidentRaised')}</Notice>}
        <button type="button" className="btn btn-accent w-full" onClick={reset}>
          {t('pwa.inbound.scanNext')}
        </button>
      </Page>
    );
  }

  if (!scanned) {
    return (
      <Page title={t('pwa.inbound.title')}>
        <p className="text-base text-slate-700">{t('pwa.inbound.scanPrompt')}</p>
        <ScanOrType accept={['BAG', 'WAYBILL']} onResolve={setScanned} />
      </Page>
    );
  }

  return (
    <Page title={t('pwa.inbound.title')}>
      <div className="card">
        <p className="text-sm font-semibold text-slate-600">{scanned.kind === 'BAG' ? 'MB' : t('receipt.waybill')}</p>
        <p className="break-all font-mono text-lg font-bold text-brand-700">{scanned.code}</p>
        <button type="button" className="mt-1 min-h-11 text-sm font-semibold underline" onClick={reset}>
          {t('common.actions.back')}
        </button>
      </div>

      <fieldset className="space-y-2">
        <legend className="h2 mb-2">{t('pwa.inbound.condition')}</legend>
        {INBOUND_CONDITIONS.map((c) => (
          <label key={c} className={`flex min-h-14 items-center gap-3 rounded-xl border-2 p-3 ${condition === c ? (c === 'INTACT' ? 'border-emerald-600 bg-emerald-50' : 'border-accent-600 bg-accent-50') : 'border-slate-300 bg-white'}`}>
            <input type="radio" name="condition" className="h-5 w-5 accent-brand-700" checked={condition === c} onChange={() => setCondition(c)} />
            <span className="text-base font-semibold">{t(`pwa.inbound.conditions.${c}`)}</span>
          </label>
        ))}
      </fieldset>

      {scanned.kind === 'BAG' && (
        <Field label={t('pwa.inbound.missingWaybills')} optional error={attempted && missingBad ? t('errors.validation.waybill') : undefined}>
          {(p) => <textarea {...p} className="input min-h-24 font-mono" rows={3} value={missingText} onChange={(e) => setMissingText(e.target.value)} autoCapitalize="characters" spellCheck={false} />}
        </Field>
      )}

      {incident && (
        <section className="space-y-3">
          <Field label={t('pwa.inbound.notes')} optional>
            {(p) => <textarea {...p} className="input min-h-20" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />}
          </Field>
          <h3 className="h2">{t('pwa.inbound.photos')}</h3>
          {[...photos, ''].slice(0, 4).map((id, i) => (
            <PhotoField key={i} label={`${t('pwa.inbound.photos')} ${i + 1}`} photoType="INBOUND_INCIDENT" value={id || undefined} onChange={(v) => setPhotos((cur) => (v ? [...cur.slice(0, i), v.id, ...cur.slice(i + 1)] : cur.filter((_, j) => j !== i)))} error={attempted && needsPhoto && i === 0 ? t('pwa.inbound.photosRequired') : undefined} />
          ))}
        </section>
      )}

      {error && <ErrorNote>{error}</ErrorNote>}
      <button type="button" className="btn btn-primary w-full" onClick={() => void submit()} disabled={busy}>
        {t('pwa.inbound.submit')}
      </button>
    </Page>
  );
}
