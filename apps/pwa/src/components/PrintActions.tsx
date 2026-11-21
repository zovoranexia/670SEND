import { useCallback, useState } from 'react';
import { useTranslations } from 'use-intl';
import { useResource } from '@/hooks';
import { ApiError } from '@/lib/api';
import { base64ToBytes, isBluetoothSupported, printer, PrinterError, rawBtUrl } from '@/lib/printer';
import type { PrintJob } from '@/lib/types';
import { IconChat, IconPrinter } from './icons';
import { ErrorNote, Loading } from './ui';

/**
 * Print a receipt / label on the 58 mm Bluetooth printer, or fall back to the RawBT app, WhatsApp share or copy.
 * The job (text + ESC/POS bytes) is rendered by the server in the chosen language, so the paper always matches
 * the customer's language regardless of the app's.
 */
export function PrintActions({ load, deps, kind = 'receipt' }: { load: () => Promise<PrintJob>; deps: readonly unknown[]; kind?: 'receipt' | 'label' }) {
  const t = useTranslations();
  const job = useResource<PrintJob>(() => load(), deps);
  const [busy, setBusy] = useState<'idle' | 'connecting' | 'printing'>('idle');
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [preview, setPreview] = useState(false);

  const printNow = useCallback(async () => {
    const j = job.data;
    if (!j) return;
    setMsg(null);
    try {
      if (!printer.connected) {
        setBusy('connecting');
        if (printer.name) await printer.ensureConnected();
        else await printer.choose();
      }
      setBusy('printing');
      await printer.print(base64ToBytes(j.escposBase64));
      setMsg({ tone: 'ok', text: t('pwa.print.printed') });
    } catch (e) {
      const reason = e instanceof PrinterError ? e.reason : 'write_failed';
      const text = reason === 'cancelled' ? t('pwa.print.notFound') : reason === 'unsupported' ? t('pwa.print.unsupported') : t('pwa.print.failed', { reason: e instanceof Error && e.message !== reason ? e.message : reason });
      setMsg({ tone: 'error', text });
    } finally {
      setBusy('idle');
    }
  }, [job.data, t]);

  async function share() {
    const text = job.data?.text;
    if (!text) return;
    if (navigator.share) {
      try {
        await navigator.share({ text });
        return;
      } catch (e) {
        if ((e as { name?: string }).name === 'AbortError') return;
      }
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  }
  async function copy() {
    if (!job.data) return;
    try {
      await navigator.clipboard.writeText(job.data.text);
      setMsg({ tone: 'ok', text: t('pwa.print.copied') });
    } catch {
      setPreview(true); // clipboard blocked: show the text so it can be selected by hand
    }
  }

  if (job.loading) return <Loading />;
  if (job.error || !job.data)
    return (
      <ErrorNote onRetry={job.reload}>{job.error instanceof ApiError ? (job.error.isNetwork ? t('pwa.app.needsConnection') : job.error.message) : t('errors.generic')}</ErrorNote>
    );

  const bluetooth = isBluetoothSupported();
  return (
    <div className="space-y-3">
      {bluetooth ? (
        <button type="button" className="btn btn-primary w-full" onClick={() => void printNow()} disabled={busy !== 'idle'}>
          <IconPrinter />
          {busy === 'connecting' ? t('pwa.print.connecting') : busy === 'printing' ? t('pwa.print.printing') : kind === 'label' ? t('pwa.print.label') : t('pwa.print.receipt')}
        </button>
      ) : (
        <p className="text-base text-slate-700">{t('pwa.print.unsupported')}</p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <a className="btn btn-outline" href={rawBtUrl(job.data.escposBase64)}>
          {t('pwa.print.rawbt')}
        </a>
        <button type="button" className="btn btn-outline" onClick={() => void share()}>
          <IconChat width={20} height={20} />
          {t('pwa.print.shareText')}
        </button>
      </div>
      <div className="flex items-center justify-between">
        <button type="button" className="min-h-11 font-semibold text-brand-700 underline" onClick={() => void copy()}>
          {t('pwa.print.copyText')}
        </button>
        <button type="button" className="min-h-11 font-semibold text-brand-700 underline" onClick={() => setPreview((p) => !p)} aria-expanded={preview}>
          {t('pwa.print.preview')}
        </button>
      </div>
      {preview && (
        // 32 columns, exactly what the printer prints
        <pre className="overflow-x-auto rounded-xl bg-slate-900 p-3 text-xs leading-tight text-slate-50" aria-label={t('pwa.print.preview')}>
          {job.data.text}
        </pre>
      )}
      {msg && (
        <p className={msg.tone === 'ok' ? 'font-semibold text-emerald-800' : 'field-error'} role={msg.tone === 'ok' ? 'status' : 'alert'}>
          {msg.text}
        </p>
      )}
    </div>
  );
}
