import { useState } from 'react';
import { Link } from 'react-router';
import { useTranslations } from 'use-intl';
import { IconChat, IconPhone, IconPin } from '@/components/icons';
import { ErrorNote, Empty, Loading, Notice, Page } from '@/components/ui';
import { useErrorText, useResource } from '@/hooks';
import { api } from '@/lib/api';
import { mapsUrl, telUrl, whatsappUrl } from '@/lib/format';
import type { CourierStop } from '@/lib/types';
import { useProfile } from '@/profile';

/** Courier home: pick-ups to collect, parcels to deliver, and the hand-over to the hub. */
export function CourierJobs() {
  const t = useTranslations();
  const errorText = useErrorText();
  const { profile } = useProfile();
  const jobs = useResource((s) => api.courierJobs(s), []);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isAvailable = available ?? (profile?.kind === 'COURIER' ? profile.isAvailable : true);

  async function toggle() {
    const next = !isAvailable;
    setAvailable(next);
    try {
      await api.setAvailability(next);
    } catch (e) {
      setAvailable(!next);
      setError(errorText(e));
    }
  }
  async function action(run: () => Promise<string | void>) {
    setError(null);
    setMsg(null);
    try {
      const m = await run();
      if (m) setMsg(m);
      jobs.reload();
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <Page
      title={t('pwa.nav.jobs')}
      actions={
        <button type="button" className="min-h-11 rounded-lg px-3 font-semibold text-brand-700 underline" onClick={jobs.reload}>
          {t('pwa.app.refresh')}
        </button>
      }
    >
      <button type="button" role="switch" aria-checked={isAvailable} onClick={() => void toggle()} className={`flex min-h-14 w-full items-center justify-between rounded-2xl border-2 px-4 font-bold ${isAvailable ? 'border-emerald-600 bg-emerald-50 text-emerald-900' : 'border-slate-300 bg-white text-slate-700'}`}>
        <span>{isAvailable ? t('pwa.courier.available') : t('pwa.courier.unavailable')}</span>
        <span className={`h-7 w-12 rounded-full p-1 ${isAvailable ? 'bg-emerald-600' : 'bg-slate-400'}`} aria-hidden="true">
          <span className={`block h-5 w-5 rounded-full bg-white transition-transform ${isAvailable ? 'translate-x-5' : ''}`} />
        </span>
      </button>

      {error && <ErrorNote>{error}</ErrorNote>}
      {msg && <Notice tone="ok">{msg}</Notice>}
      {jobs.loading && !jobs.data && <Loading />}
      {jobs.error ? <ErrorNote onRetry={jobs.reload}>{errorText(jobs.error)}</ErrorNote> : null}

      {jobs.data && (
        <>
          <section className="space-y-3" aria-labelledby="pk-h">
            <h2 id="pk-h" className="h2">
              {t('web.nav.book')} ({jobs.data.pickups.length})
            </h2>
            {jobs.data.pickups.length === 0 && <Empty>{t('pwa.courier.noPickups')}</Empty>}
            {jobs.data.pickups.map((p) => (
              <article key={p.id} className="card space-y-2">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="font-mono text-sm font-bold text-brand-700">{p.batchCode}</p>
                  <p className="text-sm font-semibold text-slate-700">{t('pwa.courier.parcelsToCollect', { n: p.parcelCount })}</p>
                </div>
                <p className="text-lg font-bold">{p.senderName}</p>
                <p className="text-slate-700">{p.pickupAddress}</p>
                <ContactRow phone={p.senderPhone} lat={p.lat} lng={p.lng} address={p.pickupAddress} />
                <Link to={`/receive?booking=${p.id}`} className="btn btn-accent w-full">
                  {t('pwa.courier.collect')}
                </Link>
              </article>
            ))}
          </section>

          <section className="space-y-3" aria-labelledby="dl-h">
            <h2 id="dl-h" className="h2">
              {t('pwa.courier.onRoute')} ({jobs.data.outForDelivery.length})
            </h2>
            {jobs.data.outForDelivery.length === 0 && <Empty>{t('pwa.courier.noDeliveries')}</Empty>}
            {jobs.data.outForDelivery.map((s) => (
              <OutForDelivery key={s.waybill} stop={s} onFailed={(notes) => action(async () => {
                const r = await api.deliveryFailed(s.waybill, notes);
                return r.returnedToAgent ? t('pwa.courier.returnedToKiosk') : t('pwa.courier.failedSaved', { n: r.attempts });
              })} />
            ))}

            <h2 className="h2 pt-2">
              {t('pwa.courier.ready')} ({jobs.data.readyForDelivery.length})
            </h2>
            {jobs.data.readyForDelivery.map((s) => (
              <article key={s.waybill} className="card space-y-2">
                <StopInfo stop={s} />
                <button type="button" className="btn btn-primary w-full" onClick={() => void action(async () => void (await api.startDelivery(s.waybill)))}>
                  {t('pwa.courier.startDelivery')}
                </button>
              </article>
            ))}
          </section>

          <Link to="/hub" className="btn btn-outline w-full">
            {t('pwa.nav.handover')}
          </Link>
        </>
      )}
    </Page>
  );
}

function StopInfo({ stop }: { stop: CourierStop }) {
  return (
    <>
      <p className="break-all font-mono text-sm font-bold text-brand-700">{stop.waybill}</p>
      <p className="text-lg font-bold">{stop.recipientName}</p>
      {stop.recipientAddress && <p className="text-slate-700">{stop.recipientAddress}</p>}
      <ContactRow phone={stop.recipientPhone} lat={null} lng={null} address={stop.recipientAddress ?? ''} />
    </>
  );
}

function OutForDelivery({ stop, onFailed }: { stop: CourierStop; onFailed: (notes: string) => Promise<void> }) {
  const t = useTranslations();
  const [failing, setFailing] = useState(false);
  const [notes, setNotes] = useState('');
  return (
    <article className="card space-y-2">
      <StopInfo stop={stop} />
      {stop.attempts > 0 && <p className="text-sm font-semibold text-accent-700">{t('pwa.courier.attempt', { n: stop.attempts + 1 })}</p>}
      <Link to={`/deliver/${stop.waybill}`} className="btn btn-primary w-full">
        {t('pwa.courier.deliverNow')}
      </Link>
      {!failing ? (
        <button type="button" className="min-h-12 w-full font-semibold text-slate-700 underline" onClick={() => setFailing(true)}>
          {t('pwa.courier.markFailed')}
        </button>
      ) : (
        <div className="space-y-2">
          <label htmlFor={`n-${stop.waybill}`} className="field-label">
            {t('pwa.courier.failedNotes')}
          </label>
          <textarea id={`n-${stop.waybill}`} className="input min-h-20" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          <button type="button" className="btn btn-danger w-full" onClick={() => void onFailed(notes.trim()).then(() => (setFailing(false), setNotes('')))}>
            {t('pwa.courier.markFailed')}
          </button>
        </div>
      )}
    </article>
  );
}

function ContactRow({ phone, lat, lng, address }: { phone: string; lat: number | null; lng: number | null; address: string }) {
  const t = useTranslations();
  const cls = 'btn btn-outline !min-h-11 flex-1 !px-2 !py-2 text-sm';
  return (
    <div className="flex gap-2">
      <a className={cls} href={telUrl(phone)}>
        <IconPhone width={18} height={18} />
        {t('common.actions.call')}
      </a>
      <a className={cls} href={whatsappUrl(phone)} target="_blank" rel="noopener noreferrer">
        <IconChat width={18} height={18} />
        WhatsApp
      </a>
      <a className={cls} href={mapsUrl(lat, lng, address)} target="_blank" rel="noopener noreferrer">
        <IconPin width={18} height={18} />
        {t('pwa.courier.openMap')}
      </a>
    </div>
  );
}
