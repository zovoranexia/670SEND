import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { Await, Empty, Modal } from '@/components/ui';
import { useResource } from '@/hooks';
import { useLocaleState } from '@/i18n';
import { claimsApi } from '@/lib/endpoints';
import { formatDiliDateTime } from '@/lib/format';
import type { ClaimEvidence, EvidencePhotoType } from '@/lib/types';

interface Photo {
  key: string;
  url: string;
  label: string;
  takenAt?: string;
  sha256: string;
}

/** Photos taken when the parcel was handed in vs. what was found on the way, at arrival, or at hand-over. */
const BEFORE: EvidencePhotoType[] = ['OPEN_BOX_CONTENT', 'SEALED_PARCEL', 'BAGGAGE_PLACEMENT'];

function Gallery({ title, photos, empty, onOpen }: { title: string; photos: Photo[]; empty: string; onOpen: (p: Photo) => void }) {
  const { locale } = useLocaleState();
  return (
    <section aria-label={title} className="min-w-0 space-y-2">
      <h3 className="h2">{title}</h3>
      {photos.length === 0 ? (
        <Empty>{empty}</Empty>
      ) : (
        <ul className="grid grid-cols-2 gap-2">
          {photos.map((p) => (
            <li key={p.key}>
              <button type="button" onClick={() => onOpen(p)} className="block w-full overflow-hidden rounded-lg border border-slate-300 bg-slate-50 text-left hover:border-brand-500">
                <img src={p.url} alt={p.label} loading="lazy" referrerPolicy="no-referrer" className="aspect-square w-full object-cover" />
                <span className="block p-1.5 text-xs">
                  <span className="block font-semibold">{p.label}</span>
                  {p.takenAt && <span className="block text-slate-600">{formatDiliDateTime(p.takenAt, locale)}</span>}
                  <span className="block font-mono text-[10px] text-slate-500">{p.sha256.slice(0, 12)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function split(e: ClaimEvidence, label: (type: EvidencePhotoType) => string, claimantLabel: string) {
  const shipment = e.shipmentPhotos.map((p, i): Photo & { type: EvidencePhotoType } => ({ key: `${p.sha256}-${i}`, url: p.url, label: label(p.type), takenAt: p.takenAt, sha256: p.sha256, type: p.type }));
  const before = shipment.filter((p) => BEFORE.includes(p.type));
  const after: Photo[] = [
    ...shipment.filter((p) => !BEFORE.includes(p.type)),
    ...e.claimEvidence.map((c, i): Photo => ({ key: `claim-${c.sha256}-${i}`, url: c.url, label: claimantLabel, sha256: c.sha256 })),
  ];
  return { before, after };
}

/** Side-by-side evidence desk: "as handed in" next to "as found", with the incident notes and tracking timeline below. */
export function EvidenceDesk({ claimId }: { claimId: string }) {
  const t = useTranslations();
  const photoT = useTranslations('admin.claims.photo');
  const { locale } = useLocaleState();
  const res = useResource((s) => claimsApi.evidence(claimId, s), [claimId]);
  const [zoom, setZoom] = useState<Photo | null>(null);

  return (
    <Await res={res}>
      {(e) => {
        const { before, after } = split(e, (type) => photoT(type), photoT('CLAIMANT'));
        return (
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Gallery title={t('admin.claims.beforeTitle')} photos={before} empty={t('admin.claims.noPhotos')} onOpen={setZoom} />
              <Gallery title={t('admin.claims.afterTitle')} photos={after} empty={t('admin.claims.noPhotos')} onOpen={setZoom} />
            </div>
            <p className="flex flex-wrap items-center gap-3 text-sm text-slate-600">
              {t('admin.claims.photoExpiry')}
              <button type="button" className="btn btn-outline btn-sm" onClick={res.reload}>
                {t('admin.claims.refreshPhotos')}
              </button>
            </p>
            {e.incidents.length > 0 && (
              <div className="card space-y-1">
                <h3 className="h2">{t('admin.claims.incidents')}</h3>
                <ul className="space-y-1 text-sm">
                  {e.incidents.map((i) => (
                    <li key={i.id}>
                      <span className="font-semibold">{t(`admin.condition.${i.condition}` as 'admin.condition.INTACT')}</span> · {formatDiliDateTime(i.createdAt, locale)}
                      {i.driverConfirmedAt ? ` · ${t('admin.hubs.driverConfirmed')}` : ''}
                      {i.notes ? ` — ${i.notes}` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <details className="card">
              <summary className="cursor-pointer font-semibold text-brand-700">{t('admin.shipments.timeline')}</summary>
              <ol className="mt-2 space-y-1 border-l-2 border-brand-200 pl-3 text-sm">
                {e.timeline.map((x, i) => (
                  <li key={`${x.createdAt}-${i}`}>
                    <span className="font-semibold">{t(`status.${x.status}.label` as 'status.IN_TRANSIT.label')}</span> · {formatDiliDateTime(x.createdAt, locale)}
                    {x.locationLabel ? ` · ${x.locationLabel}` : ''}
                    {x.notes ? ` — ${x.notes}` : ''}
                  </li>
                ))}
              </ol>
            </details>
            {zoom && (
              <Modal title={zoom.label} onClose={() => setZoom(null)} wide>
                <img src={zoom.url} alt={zoom.label} referrerPolicy="no-referrer" className="mx-auto max-h-[70vh] rounded" />
                <p className="text-center font-mono text-xs text-slate-600">SHA-256 {zoom.sha256}</p>
              </Modal>
            )}
          </div>
        );
      }}
    </Await>
  );
}
