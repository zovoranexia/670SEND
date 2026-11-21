import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { StateBadge } from '@/components/StatusBadge';
import { Await, DataTable, ErrorNote, Field, Modal, Section } from '@/components/ui';
import { useAction, useCan, useResource } from '@/hooks';
import { useLocaleState } from '@/i18n';
import { claimsApi } from '@/lib/endpoints';
import { formatDiliDateTime, usd } from '@/lib/format';
import type { RtsRow } from '@/lib/types';

const STAGES = ['TO_RECEIVE', 'AT_HUB', 'DONE'] as const;

/** Parcels nobody collected go back to the Díli hub; the sender then collects them with their ID. */
export function RtsTab() {
  const t = useTranslations();
  const can = useCan();
  const { locale } = useLocaleState();
  const [stage, setStage] = useState<string>('');
  const [handBack, setHandBack] = useState<RtsRow | null>(null);
  const [f, setF] = useState({ name: '', idType: 'BI', idNumber: '', rep: false });
  const action = useAction();
  const list = useResource((s) => claimsApi.rts({ stage: stage || undefined }, s), [stage]);
  const manage = can('rts:manage');

  return (
    <Section title={t('admin.claims.rtsTitle')}>
      <div className="card">
        <Field label={t('admin.claims.stage')}>
          {(p) => (
            <select {...p} className="input w-60" value={stage} onChange={(e) => setStage(e.target.value)}>
              <option value="">{t('admin.common.all')}</option>
              {STAGES.map((s) => (
                <option key={s} value={s}>
                  {t(`admin.state.${s}`)}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      {action.error && !handBack && <ErrorNote>{action.error}</ErrorNote>}
      <Await res={list} empty={(d) => d.length === 0}>
        {(rows) => (
          <DataTable
            caption={t('admin.claims.rtsTitle')}
            head={
              <>
                <th>{t('admin.shipments.waybill')}</th>
                <th>{t('admin.claims.stage')}</th>
                <th>{t('admin.shipments.kiosk')}</th>
                <th>{t('admin.shipments.sender')}</th>
                <th>{t('admin.claims.flagged')}</th>
                <th>{t('admin.claims.storageDue')}</th>
                {manage && <th />}
              </>
            }
          >
            {rows.map((r) => (
              <tr key={r.waybill}>
                <td className="font-mono">{r.waybill}</td>
                <td>
                  <StateBadge state={r.stage} />
                </td>
                <td>
                  {r.kiosk ?? '—'}
                  <br />
                  <span className="text-xs text-slate-600">{r.destination}</span>
                </td>
                <td>
                  {r.sender.name}
                  <br />
                  <span className="text-xs text-slate-600">{r.sender.phone}</span>
                </td>
                <td>{formatDiliDateTime(r.flaggedAt, locale)}</td>
                <td>{usd(r.unpaidStoragePenalty)}</td>
                {manage && (
                  <td className="whitespace-nowrap">
                    {r.stage === 'TO_RECEIVE' && (
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        disabled={action.busy}
                        onClick={async () => {
                          if (await action.run(() => claimsApi.rtsReceived(r.waybill))) list.reload();
                        }}
                      >
                        {t('admin.claims.receivedAtHub')}
                      </button>
                    )}
                    {r.stage === 'AT_HUB' && (
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => {
                          setF({ name: r.sender.name, idType: 'BI', idNumber: '', rep: false });
                          setHandBack(r);
                        }}
                      >
                        {t('admin.claims.handBack')}
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </DataTable>
        )}
      </Await>
      {handBack && (
        <Modal title={`${t('admin.claims.handBack')} · ${handBack.waybill}`} onClose={() => setHandBack(null)}>
          <p className="text-sm text-slate-600">{t('admin.claims.handBackIntro')}</p>
          <Field label={t('admin.claims.collectorName')}>{(p) => <input {...p} className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('admin.claims.idType')}>
              {(p) => (
                <select {...p} className="input" value={f.idType} onChange={(e) => setF({ ...f, idType: e.target.value })}>
                  {['BI', 'KARTAUN_ELEITORAL', 'PASSPORT'].map((x) => (
                    <option key={x} value={x}>
                      {t(`admin.claims.id.${x}` as 'admin.claims.id.BI')}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label={t('admin.claims.idNumber')}>{(p) => <input {...p} className="input font-mono" value={f.idNumber} onChange={(e) => setF({ ...f, idNumber: e.target.value })} />}</Field>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.rep} onChange={(e) => setF({ ...f, rep: e.target.checked })} />
            {t('admin.claims.representative')}
          </label>
          {action.error && <ErrorNote>{action.error}</ErrorNote>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn btn-outline" onClick={() => setHandBack(null)}>
              {t('common.actions.cancel')}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={action.busy || f.name.trim().length < 2 || f.idNumber.trim().length < 4}
              onClick={async () => {
                if (await action.run(() => claimsApi.rtsHandBack(handBack.waybill, { collectorName: f.name.trim(), idType: f.idType, idNumber: f.idNumber.trim(), isRepresentative: f.rep }))) {
                  setHandBack(null);
                  list.reload();
                }
              }}
            >
              {t('admin.claims.handBack')}
            </button>
          </div>
        </Modal>
      )}
    </Section>
  );
}
