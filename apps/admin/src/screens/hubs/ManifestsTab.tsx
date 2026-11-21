import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { useTranslations } from 'use-intl';
import { HUBS, MUNICIPALITIES, TRANSPORT_CANALS } from '@670send/types';
import { StateBadge } from '@/components/StatusBadge';
import { Await, ConfirmDialog, DataTable, ErrorNote, Field, Modal, Notice, Section } from '@/components/ui';
import { useAction, useCan, useResource } from '@/hooks';
import { useLocaleState } from '@/i18n';
import { hubsApi, partnersApi, shipmentsApi } from '@/lib/endpoints';
import { formatDiliDateTime } from '@/lib/format';
import type { ManifestCreate, ManifestStatus } from '@/lib/types';
import { municipalitiesOf } from './common';

const STATUSES: ManifestStatus[] = ['DRAFT', 'READY', 'HANDED_OVER', 'IN_TRANSIT', 'ARRIVED', 'COMPLETED', 'DISCREPANCY', 'CANCELLED'];
/** Which fleet vehicle types may carry which canal (mirrors the server rule). */
const VEHICLE_FOR: Record<string, string[]> = { BUS_BAGGAGE: ['BUS_PASSENGER'], CARGO_TRUCK_PICKUP: ['PICKUP_CARGO', 'TRUCK_CARGO'], SEA_FERRY_CARGO: ['SEA_FERRY'] };

/** The code the driver scans at hand-over, drawn as a QR image (generated in the browser, never sent anywhere). */
function Qr({ text }: { text: string }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let live = true;
    QRCode.toDataURL(text, { margin: 1, width: 220, errorCorrectionLevel: 'M' }).then(
      (u) => live && setSrc(u),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [text]);
  return src ? <img src={src} alt={text} width={220} height={220} className="rounded border border-slate-300" /> : null;
}

function ManifestModal({ code, onClose, onChanged }: { code: string; onClose: () => void; onChanged: () => void }) {
  const t = useTranslations();
  const can = useCan();
  const { locale } = useLocaleState();
  const res = useResource((s) => hubsApi.manifest(code, s), [code]);
  const action = useAction();
  const [mode, setMode] = useState<null | 'ready' | 'cancel'>(null);
  const [port, setPort] = useState('');
  const m = res.data;
  const sea = m?.canal === 'SEA_FERRY_CARGO';

  return (
    <Modal title={code} onClose={onClose} wide>
      <Await res={res}>
        {(d) => (
          <div className="grid gap-4 md:grid-cols-[1fr_auto]">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <StateBadge state={d.status} />
                <span className="text-sm">{t(`admin.canal.${d.canal}` as 'admin.canal.BUS_BAGGAGE')}</span>
              </div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                <dt className="font-semibold">{t('admin.shipments.route')}</dt>
                <dd>
                  {d.hub.name} → {d.destination.name}
                </dd>
                <dt className="font-semibold">{t('admin.hubs.fleet')}</dt>
                <dd>{d.fleetPartner.companyName}</dd>
                <dt className="font-semibold">{t('admin.hubs.vehicle')}</dt>
                <dd>{d.vehicle.plateNumber}</dd>
                <dt className="font-semibold">{t('admin.hubs.driver')}</dt>
                <dd>
                  {d.driver.name} ({d.driver.licenseNumber})
                </dd>
                <dt className="font-semibold">{t('admin.hubs.departure')}</dt>
                <dd>{formatDiliDateTime(d.scheduledDepartureAt, locale) || '—'}</dd>
                {d.portManifestNo && (
                  <>
                    <dt className="font-semibold">{t('admin.hubs.portManifest')}</dt>
                    <dd className="font-mono">{d.portManifestNo}</dd>
                  </>
                )}
                <dt className="font-semibold">{t('admin.hubs.dispatchedAt')}</dt>
                <dd>{formatDiliDateTime(d.dispatchedAt, locale) || '—'}</dd>
                <dt className="font-semibold">{t('admin.hubs.arrivedAt')}</dt>
                <dd>{formatDiliDateTime(d.arrivedAt, locale) || '—'}</dd>
                <dt className="font-semibold">{t('admin.hubs.baggagePhoto')}</dt>
                <dd>{d.hasBaggagePhoto ? t('common.labels.yes') : t('common.labels.no')}</dd>
              </dl>

              <DataTable
                caption={t('admin.hubs.items')}
                head={
                  <>
                    <th>{t('admin.hubs.itemType')}</th>
                    <th>{t('admin.hubs.code')}</th>
                    <th>{t('admin.hubs.parcels')}</th>
                    <th>{t('admin.hubs.condition')}</th>
                  </>
                }
              >
                {d.items.map((i) => (
                  <tr key={i.code}>
                    <td>{t(`admin.hubs.type.${i.type}` as 'admin.hubs.type.PARCEL')}</td>
                    <td className="font-mono">{i.code}</td>
                    <td>{i.parcelCount}</td>
                    <td>{i.inboundCondition ? t(`admin.condition.${i.inboundCondition}` as 'admin.condition.INTACT') : '—'}</td>
                  </tr>
                ))}
              </DataTable>

              {d.incidents.length > 0 && (
                <Notice tone="warn">
                  <p className="font-semibold">{t('admin.hubs.incidents')}</p>
                  <ul className="mt-1 list-disc pl-5">
                    {d.incidents.map((i) => (
                      <li key={i.id}>
                        <span className="font-mono">{i.waybill}</span> — {t(`admin.condition.${i.condition}` as 'admin.condition.INTACT')} · <StateBadge state={i.status} /> {i.driverConfirmed ? `· ${t('admin.hubs.driverConfirmed')}` : ''}
                      </li>
                    ))}
                  </ul>
                </Notice>
              )}
              {action.error && <ErrorNote>{action.error}</ErrorNote>}
              <div className="flex flex-wrap gap-2">
                {can('manifests:dispatch') && d.status === 'DRAFT' && (
                  <button type="button" className="btn btn-primary" onClick={() => setMode('ready')}>
                    {t('admin.hubs.markReady')}
                  </button>
                )}
                {can('manifests:create') && (d.status === 'DRAFT' || d.status === 'READY') && (
                  <button type="button" className="btn btn-outline" onClick={() => setMode('cancel')}>
                    {t('admin.hubs.cancelManifest')}
                  </button>
                )}
              </div>
            </div>
            {(d.status === 'READY' || d.status === 'DRAFT') && (
              <div className="space-y-2 text-center">
                <Qr text={d.manifestCode} />
                <p className="max-w-56 text-sm text-slate-600">{t('admin.hubs.qrHint')}</p>
              </div>
            )}
          </div>
        )}
      </Await>

      {mode === 'ready' && (
        <ConfirmDialog
          title={t('admin.hubs.markReady')}
          message={
            <div className="space-y-3">
              <p>{t('admin.hubs.readyIntro')}</p>
              {sea && (
                <Field label={t('admin.hubs.portManifest')} hint={t('admin.hubs.portManifestHint')}>
                  {(p) => <input {...p} className="input font-mono" value={port} onChange={(e) => setPort(e.target.value)} maxLength={60} />}
                </Field>
              )}
            </div>
          }
          confirmLabel={t('admin.hubs.markReady')}
          busy={action.busy || (sea && !m?.portManifestNo && port.trim().length < 3)}
          error={action.error}
          onClose={() => setMode(null)}
          onConfirm={async () => {
            if (await action.run(() => hubsApi.readyManifest(code, port.trim() || undefined))) {
              setMode(null);
              res.reload();
              onChanged();
            }
          }}
        />
      )}
      {mode === 'cancel' && (
        <ConfirmDialog
          title={t('admin.hubs.cancelManifest')}
          message={t('admin.hubs.cancelIntro')}
          confirmLabel={t('admin.hubs.cancelManifest')}
          danger
          busy={action.busy}
          error={action.error}
          onClose={() => setMode(null)}
          onConfirm={async () => {
            if (await action.run(() => hubsApi.cancelManifest(code))) {
              setMode(null);
              res.reload();
              onChanged();
            }
          }}
        />
      )}
    </Modal>
  );
}

function CreateManifest({ onClose, onCreated }: { onClose: () => void; onCreated: (code: string) => void }) {
  const t = useTranslations();
  const action = useAction();
  const [hub, setHub] = useState<string>(HUBS[0]!.code);
  const dests = municipalitiesOf(hub);
  const [dest, setDest] = useState(dests[0]?.code ?? '');
  const destDef = MUNICIPALITIES.find((m) => m.code === dest);
  const canals = destDef?.isSeaRoute ? ['SEA_FERRY_CARGO'] : TRANSPORT_CANALS.filter((c) => c !== 'SEA_FERRY_CARGO');
  const [canal, setCanal] = useState<string>(canals[0]!);
  const [partnerId, setPartnerId] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [driverId, setDriverId] = useState('');
  const [bags, setBags] = useState<string[]>([]);
  const [loose, setLoose] = useState<string[]>([]);
  const [departure, setDeparture] = useState('');
  const [port, setPort] = useState('');

  const partners = useResource((s) => partnersApi.fleetPartners({ status: 'ACTIVE' }, s), []);
  const vehicles = useResource((s) => partnersApi.vehicles({ fleetPartnerId: partnerId }, s), [partnerId], { enabled: !!partnerId });
  const drivers = useResource((s) => partnersApi.drivers({ fleetPartnerId: partnerId }, s), [partnerId], { enabled: !!partnerId });
  const sealed = useResource((s) => hubsApi.bags({ hubCode: hub, status: 'SEALED' }, s), [hub]);
  const waiting = useResource((s) => shipmentsApi.list({ status: 'CONSOLIDATED_AT_HUB', limit: 100 }, s), []);

  const okPartners = (partners.data ?? []).filter((p) => !p.mou.expired);
  const okVehicles = (vehicles.data ?? []).filter((v) => v.isActive && v.permitsValid && VEHICLE_FOR[canal]!.includes(v.type));
  const okDrivers = (drivers.data ?? []).filter((d) => d.isActive && d.licenseValid);
  const okBags = (sealed.data ?? []).filter((b) => b.destination === dest);
  const okLoose = (waiting.data?.items ?? []).filter((s) => s.destination?.code === dest && s.transportCanal === canal);
  const sea = canal === 'SEA_FERRY_CARGO';

  const toggle = (list: string[], set: (v: string[]) => void, v: string) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const weight = useMemo(() => okLoose.filter((s) => loose.includes(s.waybillNumber)).reduce((n, s) => n + s.parcel.chargeableWeightKg, 0), [okLoose, loose]);
  const ready = !!partnerId && !!vehicleId && !!driverId && bags.length + loose.length > 0 && (!sea || port.trim().length >= 3);

  function changeHub(h: string) {
    setHub(h);
    const first = municipalitiesOf(h)[0];
    changeDest(first?.code ?? '');
  }
  function changeDest(d: string) {
    setDest(d);
    const def = MUNICIPALITIES.find((m) => m.code === d);
    setCanal(def?.isSeaRoute ? 'SEA_FERRY_CARGO' : 'BUS_BAGGAGE');
    setBags([]);
    setLoose([]);
    setVehicleId('');
  }

  return (
    <Modal title={t('admin.hubs.newManifest')} onClose={onClose} wide>
      <div className="grid gap-3 md:grid-cols-3">
        <Field label={t('admin.hubs.hub')}>
          {(p) => (
            <select {...p} className="input" value={hub} onChange={(e) => changeHub(e.target.value)}>
              {HUBS.map((h) => (
                <option key={h.code} value={h.code}>
                  {h.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t('admin.hubs.destination')}>
          {(p) => (
            <select {...p} className="input" value={dest} onChange={(e) => changeDest(e.target.value)}>
              {dests.map((m) => (
                <option key={m.code} value={m.code}>
                  {m.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t('admin.shipments.canal')} hint={destDef?.isSeaRoute ? t('admin.hubs.seaOnly') : undefined}>
          {(p) => (
            <select {...p} className="input" value={canal} onChange={(e) => { setCanal(e.target.value); setLoose([]); setVehicleId(''); }}>
              {canals.map((c) => (
                <option key={c} value={c}>
                  {t(`admin.canal.${c}` as 'admin.canal.BUS_BAGGAGE')}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t('admin.hubs.fleet')} hint={t('admin.hubs.fleetHint')}>
          {(p) => (
            <select {...p} className="input" value={partnerId} onChange={(e) => { setPartnerId(e.target.value); setVehicleId(''); setDriverId(''); }}>
              <option value="">—</option>
              {okPartners.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.companyName}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t('admin.hubs.vehicle')} hint={partnerId && okVehicles.length === 0 ? t('admin.hubs.noVehicle') : undefined}>
          {(p) => (
            <select {...p} className="input" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} disabled={!partnerId}>
              <option value="">—</option>
              {okVehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.plateNumber} ({v.maxParcelSlots})
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t('admin.hubs.driver')} hint={partnerId && okDrivers.length === 0 ? t('admin.hubs.noDriver') : undefined}>
          {(p) => (
            <select {...p} className="input" value={driverId} onChange={(e) => setDriverId(e.target.value)} disabled={!partnerId}>
              <option value="">—</option>
              {okDrivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t('admin.hubs.departure')} optional>
          {(p) => <input {...p} className="input" type="datetime-local" value={departure} onChange={(e) => setDeparture(e.target.value)} />}
        </Field>
        {sea && (
          <Field label={t('admin.hubs.portManifest')} hint={t('admin.hubs.portManifestHint')}>
            {(p) => <input {...p} className="input font-mono" value={port} onChange={(e) => setPort(e.target.value)} maxLength={60} />}
          </Field>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <fieldset className="space-y-1">
          <legend className="field-label">{t('admin.hubs.sealedBags')}</legend>
          {okBags.length === 0 ? (
            <p className="text-sm text-slate-600">{t('admin.hubs.noSealedBags')}</p>
          ) : (
            okBags.map((b) => (
              <label key={b.bagCode} className="flex min-h-9 items-center gap-2 text-sm">
                <input type="checkbox" checked={bags.includes(b.bagCode)} onChange={() => toggle(bags, setBags, b.bagCode)} />
                <span className="font-mono">{b.bagCode}</span> · {t('admin.hubs.parcelCount', { count: b.parcelCount })}
              </label>
            ))
          )}
        </fieldset>
        <fieldset className="space-y-1">
          <legend className="field-label">{t('admin.hubs.looseParcels')}</legend>
          {okLoose.length === 0 ? (
            <p className="text-sm text-slate-600">{t('admin.hubs.noLoose')}</p>
          ) : (
            okLoose.map((s) => (
              <label key={s.id} className="flex min-h-9 items-center gap-2 text-sm">
                <input type="checkbox" checked={loose.includes(s.waybillNumber)} onChange={() => toggle(loose, setLoose, s.waybillNumber)} />
                <span className="font-mono">{s.waybillNumber}</span> · {s.parcel.chargeableWeightKg} kg
              </label>
            ))
          )}
          {loose.length > 0 && (
            <p className="text-sm font-semibold">
              {t('admin.hubs.selected', { count: loose.length })} · {weight} kg
            </p>
          )}
        </fieldset>
      </div>
      <Notice tone="info">{t('admin.hubs.capacityNote')}</Notice>
      {action.error && <ErrorNote>{action.error}</ErrorNote>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-outline" onClick={onClose}>
          {t('common.actions.cancel')}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={action.busy || !ready}
          onClick={async () => {
            const body: ManifestCreate = {
              hubCode: hub,
              destMunicipalityCode: dest,
              canal,
              fleetPartnerId: partnerId,
              vehicleId,
              driverId,
              masterBagCodes: bags,
              waybills: loose,
              ...(departure ? { scheduledDepartureAt: new Date(`${departure}:00+09:00`).toISOString() } : {}),
              ...(sea ? { portManifestNo: port.trim() } : {}),
            };
            let code = '';
            if (await action.run(async () => (code = (await hubsApi.createManifest(body)).manifestCode))) onCreated(code);
          }}
        >
          {t('admin.hubs.createManifest')}
        </button>
      </div>
    </Modal>
  );
}

export function ManifestsTab() {
  const t = useTranslations();
  const can = useCan();
  const { locale } = useLocaleState();
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const list = useResource((s) => hubsApi.manifests({ status: status || undefined, limit: 60 }, s), [status]);

  return (
    <Section
      title={t('admin.hubs.manifestsTitle')}
      actions={
        can('manifests:create') && (
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
            {t('admin.hubs.newManifest')}
          </button>
        )
      }
    >
      <div className="card">
        <Field label={t('common.labels.status')}>
          {(p) => (
            <select {...p} className="input w-60" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">{t('admin.common.all')}</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`admin.state.${s}`)}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <Await res={list} empty={(d) => d.length === 0}>
        {(rows) => (
          <DataTable
            caption={t('admin.hubs.manifestsTitle')}
            head={
              <>
                <th>{t('admin.hubs.code')}</th>
                <th>{t('common.labels.status')}</th>
                <th>{t('admin.hubs.destination')}</th>
                <th>{t('admin.shipments.canal')}</th>
                <th>{t('admin.hubs.vehicle')}</th>
                <th>{t('admin.hubs.parcels')}</th>
                <th>{t('admin.hubs.departure')}</th>
              </>
            }
          >
            {rows.map((m) => (
              <tr key={m.manifestCode}>
                <td>
                  <button type="button" className="font-mono font-semibold text-brand-700 underline" onClick={() => setOpen(m.manifestCode)}>
                    {m.manifestCode}
                  </button>
                </td>
                <td>
                  <StateBadge state={m.status} />
                </td>
                <td>{m.destination.name}</td>
                <td>{t(`admin.canal.${m.canal}` as 'admin.canal.BUS_BAGGAGE')}</td>
                <td>{m.vehicle}</td>
                <td>
                  {m.parcelCount} ({t('admin.hubs.bagsShort', { count: m.masterBagCount })})
                </td>
                <td>{formatDiliDateTime(m.scheduledDepartureAt, locale) || '—'}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Await>
      {creating && (
        <CreateManifest
          onClose={() => setCreating(false)}
          onCreated={(code) => {
            setCreating(false);
            list.reload();
            setOpen(code);
          }}
        />
      )}
      {open && <ManifestModal code={open} onClose={() => setOpen(null)} onChanged={list.reload} />}
    </Section>
  );
}
