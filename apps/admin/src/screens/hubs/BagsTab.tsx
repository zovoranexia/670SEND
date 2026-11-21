import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { HUBS } from '@670send/types';
import { StateBadge } from '@/components/StatusBadge';
import { Await, DataTable, ErrorNote, Field, Modal, Section } from '@/components/ui';
import { useAction, useCan, useResource } from '@/hooks';
import { hubsApi, shipmentsApi } from '@/lib/endpoints';
import { formatDiliDateTime } from '@/lib/format';
import { useLocaleState } from '@/i18n';
import type { BagDetail, BagStatus } from '@/lib/types';
import { HubSelect, municipalitiesOf, parseWaybills } from './common';

const STATUSES: BagStatus[] = ['OPEN', 'SEALED', 'DISPATCHED', 'RECEIVED', 'DISCREPANCY'];

function BagModal({ code, onClose, onChanged }: { code: string; onClose: () => void; onChanged: () => void }) {
  const t = useTranslations();
  const can = useCan();
  const bag = useResource((s) => hubsApi.bag(code, s), [code]);
  const action = useAction();
  const [add, setAdd] = useState('');
  const [seal, setSeal] = useState('');
  const b: BagDetail | undefined = bag.data;
  const editable = can('master_bags:manage') && b?.status === 'OPEN';

  // Parcels waiting at the hub for this destination are offered as suggestions (the server re-checks everything).
  const waiting = useResource((s) => shipmentsApi.list({ status: 'CONSOLIDATED_AT_HUB', limit: 100 }, s), [code], { enabled: editable });
  const suggestions = (waiting.data?.items ?? []).filter((s) => s.destination?.code === b?.destination.code && !b?.parcels.some((p) => p.waybillNumber === s.waybillNumber));

  const run = async (fn: () => Promise<unknown>) => {
    if (await action.run(fn)) {
      bag.reload();
      waiting.reload();
      onChanged();
    }
  };

  return (
    <Modal title={code} onClose={onClose} wide>
      <Await res={bag}>
        {(d) => (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <StateBadge state={d.status} />
              <span>
                {d.hub.name} → {d.destination.name}
              </span>
              <span>{t('admin.hubs.parcelCount', { count: d.parcelCount })}</span>
              {d.plasticSealNumber && (
                <span>
                  {t('admin.hubs.sealNumber')}: <span className="font-mono font-semibold">{d.plasticSealNumber}</span>
                </span>
              )}
            </div>
            {action.error && <ErrorNote>{action.error}</ErrorNote>}
            <DataTable
              caption={t('admin.hubs.bagParcels')}
              head={
                <>
                  <th>{t('admin.shipments.waybill')}</th>
                  <th>{t('admin.shipments.canal')}</th>
                  <th>kg</th>
                  {editable && <th />}
                </>
              }
            >
              {d.parcels.length === 0 ? (
                <tr>
                  <td colSpan={4} className="text-center text-slate-600">
                    {t('admin.hubs.bagEmpty')}
                  </td>
                </tr>
              ) : (
                d.parcels.map((p) => (
                  <tr key={p.waybillNumber}>
                    <td className="font-mono">{p.waybillNumber}</td>
                    <td>{t(`admin.canal.${p.transportCanal}` as 'admin.canal.BUS_BAGGAGE')}</td>
                    <td>{p.chargeableWeightKg}</td>
                    {editable && (
                      <td>
                        <button type="button" className="btn btn-ghost btn-sm" disabled={action.busy} onClick={() => void run(() => hubsApi.removeFromBag(code, p.waybillNumber))}>
                          {t('admin.hubs.remove')}
                        </button>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </DataTable>

            {editable && (
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Field label={t('admin.hubs.addParcels')} hint={t('admin.hubs.waybillsHint', { count: parseWaybills(add).length })}>
                    {(p) => <textarea {...p} className="input min-h-20 font-mono" value={add} onChange={(e) => setAdd(e.target.value)} spellCheck={false} />}
                  </Field>
                  {suggestions.length > 0 && (
                    <div className="flex flex-wrap gap-1" aria-label={t('admin.hubs.suggestions')}>
                      {suggestions.slice(0, 12).map((s) => (
                        <button key={s.id} type="button" className="badge bg-brand-50 font-mono text-brand-800 ring-1 ring-brand-200" onClick={() => setAdd((v) => `${v}${v ? '\n' : ''}${s.waybillNumber}`)}>
                          {s.waybillNumber.slice(-12)}
                        </button>
                      ))}
                    </div>
                  )}
                  <button
                    type="button"
                    className="btn btn-outline"
                    disabled={action.busy || parseWaybills(add).length === 0}
                    onClick={() =>
                      void run(async () => {
                        for (const w of parseWaybills(add)) await hubsApi.addToBag(code, w);
                        setAdd('');
                      })
                    }
                  >
                    {t('admin.hubs.add')}
                  </button>
                </div>
                <div className="space-y-2">
                  <Field label={t('admin.hubs.sealNumber')} hint={t('admin.hubs.sealHint')}>
                    {(p) => <input {...p} className="input font-mono" value={seal} onChange={(e) => setSeal(e.target.value)} maxLength={40} />}
                  </Field>
                  <button type="button" className="btn btn-primary" disabled={action.busy || d.parcelCount === 0 || seal.trim().length < 4} onClick={() => void run(() => hubsApi.seal(code, seal.trim()))}>
                    {t('admin.hubs.sealBag')}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </Await>
    </Modal>
  );
}

export function BagsTab() {
  const t = useTranslations();
  const can = useCan();
  const { locale } = useLocaleState();
  const [hub, setHub] = useState<string>(HUBS[0]!.code);
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [dest, setDest] = useState('');
  const action = useAction();
  const list = useResource((s) => hubsApi.bags({ hubCode: hub, status: status || undefined }, s), [hub, status]);
  const dests = municipalitiesOf(hub);

  return (
    <Section
      title={t('admin.hubs.bagsTitle')}
      actions={
        can('master_bags:manage') && (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setDest(dests[0]?.code ?? '');
              setCreating(true);
            }}
          >
            {t('admin.hubs.newBag')}
          </button>
        )
      }
    >
      <div className="card flex flex-wrap items-end gap-3">
        <HubSelect value={hub} onChange={setHub} />
        <Field label={t('common.labels.status')}>
          {(p) => (
            <select {...p} className="input w-52" value={status} onChange={(e) => setStatus(e.target.value)}>
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
            caption={t('admin.hubs.bagsTitle')}
            head={
              <>
                <th>{t('admin.hubs.bagCode')}</th>
                <th>{t('common.labels.status')}</th>
                <th>{t('admin.hubs.destination')}</th>
                <th>{t('admin.hubs.parcels')}</th>
                <th>{t('admin.hubs.sealedAt')}</th>
              </>
            }
          >
            {rows.map((b) => (
              <tr key={b.bagCode}>
                <td>
                  <button type="button" className="font-mono font-semibold text-brand-700 underline" onClick={() => setOpen(b.bagCode)}>
                    {b.bagCode}
                  </button>
                </td>
                <td>
                  <StateBadge state={b.status} />
                </td>
                <td>{b.destination}</td>
                <td>{b.parcelCount}</td>
                <td>{formatDiliDateTime(b.sealedAt, locale)}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Await>

      {creating && (
        <Modal title={t('admin.hubs.newBag')} onClose={() => setCreating(false)}>
          <Field label={t('admin.hubs.destination')}>
            {(p) => (
              <select {...p} className="input" value={dest} onChange={(e) => setDest(e.target.value)}>
                {dests.map((m) => (
                  <option key={m.code} value={m.code}>
                    {m.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          {action.error && <ErrorNote>{action.error}</ErrorNote>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn btn-outline" onClick={() => setCreating(false)}>
              {t('common.actions.cancel')}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={action.busy || !dest}
              onClick={async () => {
                let code: string | null = null;
                const ok = await action.run(async () => {
                  code = (await hubsApi.createBag(hub, dest)).bagCode;
                });
                if (ok) {
                  setCreating(false);
                  list.reload();
                  setOpen(code);
                }
              }}
            >
              {t('admin.hubs.createBag')}
            </button>
          </div>
        </Modal>
      )}
      {open && <BagModal code={open} onClose={() => setOpen(null)} onChanged={list.reload} />}
    </Section>
  );
}
