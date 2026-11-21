import { useNavigate, useParams, Link } from 'react-router';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { IconBus, IconCheck, IconShip, IconTruck } from '@/components/icons';
import { PhotoField } from '@/components/PhotoField';
import { ScanOrType } from '@/components/Scanner';
import { ErrorNote, Empty, Loading, Notice, Page } from '@/components/ui';
import { useErrorText, useResource } from '@/hooks';
import { api } from '@/lib/api';
import type { TransportCanal } from '@/lib/types';

const CANAL_ICON = { BUS_BAGGAGE: IconBus, CARGO_TRUCK_PICKUP: IconTruck, SEA_FERRY_CARGO: IconShip } as const;
const STATUS_TONE: Record<string, string> = {
  READY: 'bg-accent-100 text-accent-700',
  IN_TRANSIT: 'bg-brand-100 text-brand-800',
  ARRIVED: 'bg-amber-100 text-amber-950',
  COMPLETED: 'bg-emerald-100 text-emerald-900',
  DISCREPANCY: 'bg-red-100 text-red-900',
  CANCELLED: 'bg-slate-200 text-slate-700',
};

/** The driver's trips, and scan-to-open of a manifest QR. */
export function TripsScreen() {
  const t = useTranslations();
  const errorText = useErrorText();
  const navigate = useNavigate();
  const trips = useResource((s) => api.manifests(s), []);
  return (
    <Page title={t('pwa.driver.trips')} actions={<button type="button" className="min-h-11 px-3 font-semibold text-brand-700 underline" onClick={trips.reload}>{t('pwa.app.refresh')}</button>}>
      <section className="card space-y-2">
        <p className="text-base text-slate-700">{t('pwa.driver.scanHint')}</p>
        <ScanOrType accept={['MANIFEST']} onResolve={(s) => navigate(`/trips/${s.code}`)} label={t('pwa.driver.scanManifest')} />
      </section>
      {trips.loading && <Loading />}
      {trips.error ? <ErrorNote onRetry={trips.reload}>{errorText(trips.error)}</ErrorNote> : null}
      {!trips.loading && !trips.error && trips.data?.length === 0 && <Empty>{t('pwa.driver.noTrips')}</Empty>}
      <ul className="space-y-2">
        {trips.data?.map((m) => {
          const Icon = CANAL_ICON[m.canal];
          return (
            <li key={m.manifestCode}>
              <Link to={`/trips/${m.manifestCode}`} className="card flex items-center gap-3">
                <Icon width={30} height={30} className="shrink-0 text-brand-700" />
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-sm font-bold text-brand-700">{m.manifestCode}</p>
                  <p className="text-lg font-bold">{m.destination.name}</p>
                  <p className="text-sm text-slate-600">{t('pwa.driver.parcelsBags', { parcels: m.parcelCount, bags: m.masterBagCount })}</p>
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-bold ${STATUS_TONE[m.status] ?? ''}`}>{t(`pwa.driver.statuses.${m.status as 'READY'}`)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </Page>
  );
}

/** One trip: check the load, photograph the closed baggage compartment, start; arrive; confirm incidents. */
export function TripScreen() {
  const t = useTranslations();
  const errorText = useErrorText();
  const navigate = useNavigate();
  const { code = '' } = useParams();
  const trip = useResource((s) => api.manifest(code, s), [code]);
  const [photo, setPhoto] = useState<string | undefined>();
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await fn();
      setMessage(ok);
      trip.reload();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  if (trip.loading && !trip.data) return <Loading />;
  if (trip.error || !trip.data) return <Page title={t('pwa.driver.trips')}><ErrorNote onRetry={trip.reload}>{trip.error && (trip.error as { status?: number }).status === 404 ? t('pwa.driver.notYourTrip') : errorText(trip.error)}</ErrorNote></Page>;
  const m = trip.data;
  const baggageNeeded = m.canal === 'BUS_BAGGAGE';
  const open = m.incidents.filter((i) => !i.driverConfirmed);

  return (
    <Page title={m.destination.name} back={<button type="button" className="min-h-11 min-w-11 text-2xl text-brand-700" onClick={() => navigate('/')} aria-label={t('common.actions.back')}>‹</button>}>
      <div className="card space-y-1">
        <p className="font-mono text-sm font-bold text-brand-700">{m.manifestCode}</p>
        <span className={`inline-block rounded-full px-3 py-1 text-sm font-bold ${STATUS_TONE[m.status] ?? ''}`}>{t(`pwa.driver.statuses.${m.status as 'READY'}`)}</span>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 pt-2 text-base">
          <dt className="text-slate-600">{t('pwa.driver.canal')}</dt>
          <dd>{t(`web.calculator.canal.${m.canal as TransportCanal}`)}</dd>
          <dt className="text-slate-600">{t('pwa.driver.vehicle')}</dt>
          <dd>{m.vehicle.plateNumber}</dd>
          {m.portManifestNo && (
            <>
              <dt className="text-slate-600">{t('pwa.driver.portManifest')}</dt>
              <dd className="font-mono">{m.portManifestNo}</dd>
            </>
          )}
          <dt className="text-slate-600">{t('pwa.driver.contents')}</dt>
          <dd>{t('pwa.driver.parcelsBags', { parcels: m.parcelCount, bags: m.masterBagCount })}</dd>
        </dl>
      </div>

      <ul className="space-y-2" aria-label={t('pwa.driver.contents')}>
        {m.items.map((i) => (
          <li key={i.code} className="card flex items-center justify-between gap-3 !p-3">
            <div className="min-w-0">
              <p className="truncate font-mono text-sm font-bold">{i.code}</p>
              <p className="text-sm text-slate-600">{i.type === 'MASTER_BAG' ? `${i.parcelCount} ×` : ''}</p>
            </div>
            {i.inboundCondition && (
              <span className={`flex items-center gap-1 text-sm font-bold ${i.inboundCondition === 'INTACT' ? 'text-emerald-800' : 'text-accent-700'}`}>
                {i.inboundCondition === 'INTACT' && <IconCheck width={18} height={18} />}
                {t(`pwa.inbound.conditions.${i.inboundCondition as 'INTACT'}`)}
              </span>
            )}
          </li>
        ))}
      </ul>

      {error && <ErrorNote>{error}</ErrorNote>}
      {message && <Notice tone="ok">{message}</Notice>}

      {m.status === 'READY' && (
        <section className="card space-y-3" aria-labelledby="ho-h">
          <h2 id="ho-h" className="h2">
            {t('pwa.driver.handoverTitle')}
          </h2>
          <p className="text-base text-slate-700">{t('pwa.driver.handoverHint')}</p>
          <PhotoField label={t('pwa.driver.baggagePhoto')} photoType="BAGGAGE_PLACEMENT" value={photo} onChange={(v) => setPhoto(v?.id)} error={attempted && baggageNeeded && !photo ? t('pwa.driver.baggageRequired') : undefined} />
          <button
            type="button"
            className="btn btn-primary w-full"
            disabled={busy}
            onClick={() => {
              setAttempted(true);
              if (baggageNeeded && !photo) return;
              void run(() => api.handover(m.manifestCode, photo), t('pwa.driver.handedOver'));
            }}
          >
            {t('pwa.driver.confirmHandover')}
          </button>
        </section>
      )}

      {m.status === 'IN_TRANSIT' && (
        <button type="button" className="btn btn-accent w-full" disabled={busy} onClick={() => void run(() => api.arrive(m.manifestCode), t('pwa.driver.arrivedDone'))}>
          {t('pwa.driver.arrived')}
        </button>
      )}

      {m.incidents.length > 0 && (
        <section className="space-y-2" aria-labelledby="inc-h">
          <h2 id="inc-h" className="h2">
            {t('pwa.driver.incidents')}
          </h2>
          {m.incidents.map((i) => (
            <article key={i.id} className="card space-y-2">
              <p className="break-all font-mono text-sm font-bold">{i.waybill}</p>
              <p className="font-semibold text-accent-700">{t(`pwa.inbound.conditions.${i.condition as 'WET'}`)}</p>
              {i.notes && <p className="text-slate-700">{i.notes}</p>}
              {i.driverConfirmed ? (
                <p className="flex items-center gap-1 font-bold text-emerald-800">
                  <IconCheck width={18} height={18} /> {t('pwa.driver.incidentConfirmed')}
                </p>
              ) : (
                <button type="button" className="btn btn-danger w-full" disabled={busy} onClick={() => void run(() => api.confirmIncident(i.id), t('pwa.driver.incidentConfirmed'))}>
                  {t('pwa.driver.confirmIncident')}
                </button>
              )}
            </article>
          ))}
          {open.length === 0 && <p className="text-sm text-slate-600">{t('pwa.driver.noIncidents')}</p>}
        </section>
      )}
    </Page>
  );
}
