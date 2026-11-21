import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslations } from 'use-intl';
import { createFrameReader, parseScannedAs, type FrameReader, type Scanned, type ScanKind } from '@/lib/scan';
import { IconClose, IconScan } from './icons';

const POLL_MS = 250;

type CamState = 'starting' | 'live' | 'denied' | 'unavailable';

/** Full-screen camera that reads QR codes (and Code 128 where the phone supports it). Typing is always possible. */
export function ScanSheet({ accept, onCode, onClose, readerFactory = createFrameReader }: { accept: readonly ScanKind[]; onCode: (s: Scanned) => void; onClose: () => void; readerFactory?: () => Promise<FrameReader> }) {
  const t = useTranslations('pwa.scan');
  const tc = useTranslations('common.actions');
  const video = useRef<HTMLVideoElement>(null);
  const [cam, setCam] = useState<CamState>('starting');
  const [rejected, setRejected] = useState(false);
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    let stream: MediaStream | undefined;

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) return setCam('unavailable');
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      } catch (e) {
        return setCam((e as { name?: string }).name === 'NotAllowedError' ? 'denied' : 'unavailable');
      }
      if (stopped) return stream.getTracks().forEach((tr) => tr.stop());
      const el = video.current;
      if (!el) return;
      el.srcObject = stream;
      await el.play().catch(() => undefined);
      setCam('live');
      const read = await readerFactory();
      let busy = false;
      timer = setInterval(() => {
        if (busy || stopped) return;
        busy = true;
        read(el)
          .then((text) => {
            if (!text || stopped) return;
            const hit = parseScannedAs(text, accept);
            if (hit) {
              stopped = true;
              navigator.vibrate?.(60);
              onCodeRef.current(hit);
            } else setRejected(true);
          })
          .catch(() => undefined)
          .finally(() => (busy = false));
      }, POLL_MS);
    }
    void start();
    return () => {
      stopped = true;
      if (timer) clearInterval(timer);
      stream?.getTracks().forEach((tr) => tr.stop());
    };
  }, [accept, readerFactory]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black" role="dialog" aria-modal="true" aria-label={t('title')}>
      <div className="flex items-center justify-between p-3 text-white">
        <h2 className="text-lg font-bold">{t('title')}</h2>
        <button type="button" onClick={onClose} className="flex h-12 w-12 items-center justify-center rounded-full bg-white/15" aria-label={tc('close')}>
          <IconClose />
        </button>
      </div>
      <div className="relative flex-1 overflow-hidden">
        <video ref={video} className="h-full w-full object-cover" playsInline muted aria-hidden="true" />
        {cam === 'live' && <div className="pointer-events-none absolute left-1/2 top-1/2 h-56 w-56 -translate-x-1/2 -translate-y-1/2 rounded-3xl border-4 border-white/80" aria-hidden="true" />}
        <p className="absolute inset-x-0 top-4 mx-auto w-fit max-w-[90%] rounded-full bg-black/60 px-4 py-2 text-center text-white" role="status">
          {cam === 'starting' ? t('starting') : cam === 'denied' ? t('denied') : cam === 'unavailable' ? t('noCamera') : rejected ? t('notRecognised') : t('aim')}
        </p>
      </div>
      <div className="bg-white p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <CodeInput accept={accept} onResolve={onCode} />
      </div>
    </div>
  );
}

/** Type or paste a code (waybill, bag, manifest…); anything that does not look like an accepted code is refused. */
export function CodeInput({ accept, onResolve, label, autoFocus }: { accept: readonly ScanKind[]; onResolve: (s: Scanned) => void; label?: string; autoFocus?: boolean }) {
  const t = useTranslations('pwa.scan');
  const [value, setValue] = useState('');
  const [bad, setBad] = useState(false);
  function submit(e: FormEvent) {
    e.preventDefault();
    const hit = parseScannedAs(value, accept);
    if (hit) {
      setBad(false);
      onResolve(hit);
    } else setBad(true);
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-2" noValidate>
      <label htmlFor="code-input" className="field-label !mb-0">
        {label ?? t('typeCode')}
      </label>
      <div className="flex gap-2">
        <input
          id="code-input"
          className="input font-mono uppercase"
          value={value}
          onChange={(e) => (setValue(e.target.value), setBad(false))}
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          autoFocus={autoFocus}
          aria-invalid={bad || undefined}
          aria-describedby={bad ? 'code-input-err' : undefined}
        />
        <button type="submit" className="btn btn-primary shrink-0">
          {t('open')}
        </button>
      </div>
      {bad && (
        <p id="code-input-err" className="field-error" role="alert">
          {t('notRecognised')}
        </p>
      )}
    </form>
  );
}

/** "Scan" button + code input in one block: the usual way to pick a parcel / bag / manifest. */
export function ScanOrType({ accept, onResolve, label }: { accept: readonly ScanKind[]; onResolve: (s: Scanned) => void; label?: string }) {
  const t = useTranslations('pwa.scan');
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-3">
      <button type="button" className="btn btn-accent w-full" onClick={() => setOpen(true)}>
        <IconScan />
        {t('title')}
      </button>
      <CodeInput accept={accept} onResolve={onResolve} {...(label ? { label } : {})} />
      {open && (
        <ScanSheet
          accept={accept}
          onClose={() => setOpen(false)}
          onCode={(s) => {
            setOpen(false);
            onResolve(s);
          }}
        />
      )}
    </div>
  );
}
