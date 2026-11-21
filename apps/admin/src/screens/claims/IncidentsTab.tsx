import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { ShipmentStatus, StateBadge } from '@/components/StatusBadge';
import { Await, DataTable, ErrorNote, Field, Modal, Notice, Section } from '@/components/ui';
import { useAction, useCan, useResource } from '@/hooks';
import { useLocaleState } from '@/i18n';
import { claimsApi } from '@/lib/endpoints';
import { formatDiliDateTime } from '@/lib/format';
import type { IncidentDto } from '@/lib/types';

/** Problems found when a parcel arrived (damaged seal, wet, missing): release it or send it back. */
export function IncidentsTab() {
  const t = useTranslations();
  const can = useCan();
  const { locale } = useLocaleState();
  const [status, setStatus] = useState('OPEN');
  const [open, setOpen] = useState<IncidentDto | null>(null);
  const [resolution, setResolution] = useState<'RELEASE_TO_RECIPIENT' | 'RETURN_TO_SENDER'>('RELEASE_TO_RECIPIENT');
  const [notes, setNotes] = useState('');
  const [fleetLiable, setFleetLiable] = useState(true);
  const action = useAction();
  const list = useResource((s) => claimsApi.incidents({ status: status || undefined }, s), [status]);

  return (
    <Section title={t('admin.claims.incidentsTitle')}>
      <div className="card">
        <Field label={t('common.labels.status')}>
          {(p) => (
            <select {...p} className="input w-52" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">{t('admin.common.all')}</option>
              {['OPEN', 'RESOLVED'].map((s) => (
                <option key={s} value={s}>
                  {t(`admin.state.${s}` as 'admin.state.OPEN')}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <Notice tone="info">{t('admin.claims.incidentPhotosNote')}</Notice>
      <Await res={list} empty={(d) => d.length === 0}>
        {(rows) => (
          <DataTable
            caption={t('admin.claims.incidentsTitle')}
            head={
              <>
                <th>{t('admin.shipments.waybill')}</th>
                <th>{t('admin.hubs.condition')}</th>
                <th>{t('common.labels.status')}</th>
                <th>{t('admin.claims.parcelStatus')}</th>
                <th>{t('common.labels.notes')}</th>
                <th>{t('admin.shipments.created')}</th>
                {can('incidents:manage') && <th />}
              </>
            }
          >
            {rows.map((i) => (
              <tr key={i.id}>
                <td className="font-mono">{i.waybill}</td>
                <td>{t(`admin.condition.${i.condition}` as 'admin.condition.INTACT')}</td>
                <td>
                  <StateBadge state={i.status} />
                  <p className="text-xs text-slate-600">{i.driverConfirmedAt ? t('admin.hubs.driverConfirmed') : t('admin.claims.awaitingDriver')}</p>
                </td>
                <td>
                  <ShipmentStatus status={i.shipmentStatus} />
                </td>
                <td className="max-w-64 text-sm">
                  {i.notes}
                  {i.resolutionNotes && <p className="text-xs text-slate-600">→ {i.resolutionNotes}</p>}
                </td>
                <td>{formatDiliDateTime(i.createdAt, locale)}</td>
                {can('incidents:manage') && (
                  <td>
                    {i.status !== 'RESOLVED' && (
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => {
                          setNotes('');
                          setResolution('RELEASE_TO_RECIPIENT');
                          setFleetLiable(true);
                          setOpen(i);
                        }}
                      >
                        {t('admin.claims.resolve')}
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </DataTable>
        )}
      </Await>
      {open && (
        <Modal title={`${t('admin.claims.resolve')} · ${open.waybill}`} onClose={() => setOpen(null)}>
          {!open.driverConfirmedAt && <Notice tone="warn">{t('admin.claims.needsDriver')}</Notice>}
          <fieldset className="space-y-2">
            <legend className="field-label">{t('admin.claims.resolution')}</legend>
            {(['RELEASE_TO_RECIPIENT', 'RETURN_TO_SENDER'] as const).map((r) => (
              <label key={r} className="flex items-start gap-2">
                <input type="radio" name="resolution" className="mt-1" checked={resolution === r} onChange={() => setResolution(r)} />
                <span>
                  <span className="font-semibold">{t(`admin.claims.res.${r}`)}</span>
                  <span className="block text-sm text-slate-600">{t(`admin.claims.resHint.${r}`)}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={fleetLiable} onChange={(e) => setFleetLiable(e.target.checked)} />
            <span>
              {t('admin.claims.fleetLiable')}
              <span className="block text-slate-600">{t('admin.claims.fleetLiableHint')}</span>
            </span>
          </label>
          <Field label={t('admin.claims.resolutionNotes')}>
            {(p) => <textarea {...p} className="input min-h-24" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />}
          </Field>
          {action.error && <ErrorNote>{action.error}</ErrorNote>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn btn-outline" onClick={() => setOpen(null)}>
              {t('common.actions.cancel')}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={action.busy || notes.trim().length < 5}
              onClick={async () => {
                if (await action.run(() => claimsApi.resolveIncident(open.id, { resolution, notes: notes.trim(), fleetLiable }))) {
                  setOpen(null);
                  list.reload();
                }
              }}
            >
              {t('admin.claims.resolve')}
            </button>
          </div>
        </Modal>
      )}
    </Section>
  );
}
