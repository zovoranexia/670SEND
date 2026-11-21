import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'use-intl';
import { api, ApiError } from '@/lib/api';
import { compressPhoto, kb, PhotoError } from '@/lib/image';
import { IconCamera, IconCheck } from './icons';

export interface PhotoValue {
  id: string;
  kb: number;
  /** Only available in the session that took the photo (object URL); absent after a draft is restored. */
  previewUrl?: string;
}

type State = { kind: 'idle' } | { kind: 'preparing' } | { kind: 'uploading' } | { kind: 'error'; message: string };

/**
 * Camera → compress → upload. The picture is shrunk on the phone (≈ 400–900 KB instead of 5 MB) before it is
 * sent, and what the server stores is only referenced by id, so nothing sensitive stays on the device.
 */
export function PhotoField({ label, hint, photoType, value, onChange, error }: { label: string; hint?: string; photoType: string; value?: string | undefined; onChange: (v: PhotoValue | undefined) => void; error?: string | undefined }) {
  const t = useTranslations('pwa');
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [info, setInfo] = useState<{ kb: number; previewUrl: string } | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(() => () => void (urlRef.current && URL.revokeObjectURL(urlRef.current)), []);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setState({ kind: 'preparing' });
    try {
      const photo = await compressPhoto(file);
      setState({ kind: 'uploading' });
      const up = await api.uploadPhoto(photo.blob, photoType);
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      const previewUrl = URL.createObjectURL(photo.blob);
      urlRef.current = previewUrl;
      setInfo({ kb: kb(photo.blob.size), previewUrl });
      setState({ kind: 'idle' });
      onChange({ id: up.id, kb: kb(photo.blob.size), previewUrl });
    } catch (e) {
      const message = e instanceof ApiError ? (e.isNetwork ? t('app.needsConnection') : e.message) : e instanceof PhotoError ? t('camera.failed') : t('camera.failed');
      setState({ kind: 'error', message });
    } finally {
      if (input.current) input.current.value = ''; // allow taking the same file again
    }
  }

  const busy = state.kind === 'preparing' || state.kind === 'uploading';
  const done = Boolean(value);

  return (
    <div className="rounded-2xl border border-slate-300 bg-white p-3">
      <p className="field-label !mb-0">{label}</p>
      {hint && <p className="field-hint">{hint}</p>}
      <div className="mt-3 flex items-center gap-3">
        {info?.previewUrl && done ? (
          <img src={info.previewUrl} alt="" className="h-16 w-16 rounded-lg border border-slate-300 object-cover" />
        ) : (
          <span className={`flex h-16 w-16 items-center justify-center rounded-lg border-2 border-dashed ${done ? 'border-emerald-500 text-emerald-700' : 'border-slate-300 text-slate-500'}`}>{done ? <IconCheck width={28} height={28} /> : <IconCamera width={28} height={28} />}</span>
        )}
        <div className="min-w-0 flex-1">
          {busy ? (
            <p className="text-base text-slate-700" role="status">
              {state.kind === 'preparing' ? t('camera.preparing') : t('camera.uploading')}
            </p>
          ) : done ? (
            <p className="text-base font-medium text-emerald-800" role="status">
              {info ? t('camera.uploaded', { kb: info.kb }) : t('camera.uploaded', { kb: '…' })}
            </p>
          ) : null}
          <div className="mt-2 flex gap-2">
            <button type="button" className="btn btn-outline !min-h-11 !px-4 !py-2 text-sm" onClick={() => input.current?.click()} disabled={busy}>
              <IconCamera width={18} height={18} />
              {done ? t('camera.retake') : t('camera.take')}
            </button>
            {done && !busy && (
              <button type="button" className="min-h-11 px-3 text-sm font-semibold text-slate-700 underline" onClick={() => (setInfo(null), onChange(undefined))}>
                {t('camera.remove')}
              </button>
            )}
          </div>
        </div>
      </div>
      {/* `capture` opens the rear camera directly on phones; desktop browsers fall back to a file chooser. */}
      <input ref={input} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-label={label} onChange={(e) => void onFile(e.target.files?.[0])} />
      {state.kind === 'error' && (
        <p className="field-error" role="alert">
          {state.message}
        </p>
      )}
      {error && !done && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
