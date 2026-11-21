import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'use-intl';
import { SHIPMENT_STATUSES } from '@670send/types';
import { ShipmentStatus } from '@/components/StatusBadge';
import { ConfirmDialog, DataTable, Empty, ErrorNote, Field, Loading, Modal, Notice, Page } from '@/components/ui';
import { useAction, useCan, useDebounced, useErrorText, useResource } from '@/hooks';
import { useLocaleState } from '@/i18n';
import { shipmentsApi } from '@/lib/endpoints';
import { formatDiliDateTime, normalizeWaybill } from '@/lib/format';
import type { ShipmentRow } from '@/lib/types';

export function ShipmentDetail({ waybill, onClose, onChanged }: { waybill: string; onClose: () => void; onChanged?: () => void }) {
  const t = useTranslations();
  const can = useCan();
  const { locale } = useLocaleState();
  const detail = useResource((s) => shipmentsApi.get(waybill, s), [waybill]);
  const events = useResource((s) => shipmentsApi.events(waybill, s), [waybill]);
  const errorText = useErrorText();
  const action = useAction();
  const [mode, setMode] = useState<null | 'override' | 'reminder'>(null);
  const [status, setStatus] = useState<string>('');
  const [done, setDone] = useState<string | null>(null);
  const s = detail.data;

  const reload = () => {
    detail.reload();
    events.reload();
    onChanged?.();
  };

  return (
    <Modal title={waybill} onClose={onClose} wide>
      {detail.loading && !s && <Loading />}
      {detail.error && !s ? <ErrorNote onRetry={detail.reload}>{errorText(detail.error)}</ErrorNote> : null}
      {done && <Notice tone="ok">{done}</Notice>}
      {s && (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <ShipmentStatus status={s.status} />
              <span className="text-sm text-slate-600">{t(`admin.shipments.scheme.${s.serviceScheme}` as 'admin.shipments.scheme.SCHEME_A')}</span>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="font-semibold">{t('admin.shipments.route')}</dt>
              <dd>
                {s.origin?.name} → {s.destination?.name}
              </dd>
              <dt className="font-semibold">{t('admin.shipments.canal')}</dt>
              <dd>{t(`admin.canal.${s.transportCanal}` as 'admin.canal.BUS_BAGGAGE')}</dd>
              <dt className="font-semibold">{t('admin.shipments.sender')}</dt>
              <dd>
                {s.sender.name} · {s.sender.phone}
              </dd>
              <dt className="font-semibold">{t('admin.shipments.recipient')}</dt>
              <dd>
                {s.recipient.name} · {s.recipient.phone}
              </dd>
              <dt className="font-semibold">{t('admin.shipments.kiosk')}</dt>
              <dd>{s.destAgent ? `${s.destAgent.kioskName}` : '—'}</dd>
              <dt className="font-semibold">{t('admin.shipments.item')}</dt>
              <dd>
                {s.item.description}
                {s.item.isFragile ? ` · ${t('admin.shipments.fragile')}` : ''}
              </dd>
              <dt className="font-semibold">{t('admin.shipments.weight')}</dt>
              <dd>{s.parcel.chargeableWeightKg} kg</dd>
              <dt className="font-semibold">{t('admin.shipments.total')}</dt>
              <dd className="font-bold">{s.fees.total?.display ?? '—'}</dd>
              <dt className="font-semibold">{t('admin.shipments.created')}</dt>
              <dd>{formatDiliDateTime(s.createdAt, locale)}</dd>
              {s.holdReason && (
                <>
                  <dt className="font-semibold">{t('admin.shipments.holdReason')}</dt>
                  <dd>{s.holdReason}</dd>
                </>
              )}
            </dl>
            <div className="flex flex-wrap gap-2 pt-1">
              {can('notifications:send_reminder') && s.status === 'ARRIVED_AT_DEST_AGENT' && (
                <button type="button" className="btn btn-outline btn-sm" onClick={() => setMode('reminder')}>
                  {t('admin.shipments.sendReminder')}
                </button>
              )}
              {can('shipments:override_status') && (
                <button type="button" className="btn btn-outline btn-sm" onClick={() => setMode('override')}>
                  {t('admin.shipments.override')}
                </button>
              )}
            </div>
          </div>

          <div>
            <h3 className="h2 mb-2">{t('admin.shipments.timeline')}</h3>
            {events.data ? (
              <ol className="space-y-2 border-l-2 border-brand-200 pl-3">
                {events.data.map((e, i) => (
                  <li key={`${e.at}-${i}`} className="text-sm">
                    <p className="font-semibold">
                      <ShipmentStatus status={e.status} />
                    </p>
                    <p className="text-slate-600">
                      {formatDiliDateTime(e.at, locale)}
                      {e.location ? ` · ${e.location}` : ''}
                      {e.actor ? ` · ${e.actor}` : ''}
                    </p>
                    {e.notes && <p>{e.notes}</p>}
                  </li>
                ))}
              </ol>
            ) : (
              <Loading />
            )}
          </div>
        </div>
      )}

      {mode === 'reminder' && s && (
        <Modal title={t('admin.shipments.sendReminder')} onClose={() => setMode(null)}>
          <p>{t('admin.shipments.reminderIntro', { waybill })}</p>
          {action.error && <ErrorNote>{action.error}</ErrorNote>}
          <div className="flex flex-wrap justify-end gap-2">
            {(['DAY3', 'DAY5'] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                className="btn btn-primary"
                disabled={action.busy}
                onClick={async () => {
                  const ok = await action.run(() => shipmentsApi.reminder(waybill, kind));
                  if (ok) {
                    setMode(null);
                    setDone(t('admin.shipments.reminderSent'));
                  }
                }}
              >
                {t(`admin.shipments.reminder.${kind}` as 'admin.shipments.reminder.DAY3')}
              </button>
            ))}
          </div>
        </Modal>
      )}

      {mode === 'override' && s && (
        <ConfirmDialog
          title={t('admin.shipments.override')}
          message={
            <div className="space-y-3">
              <Notice tone="warn">{t('admin.shipments.overrideWarning')}</Notice>
              <Field label={t('admin.shipments.newStatus')}>
                {(p) => (
                  <select {...p} className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
                    <option value="">—</option>
                    {SHIPMENT_STATUSES.filter((x) => x !== s.status && x !== 'DELIVERED').map((x) => (
                      <option key={x} value={x}>
                        {t(`status.${x}.label`)}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            </div>
          }
          confirmLabel={t('admin.shipments.override')}
          danger
          reasonLabel={t('admin.forceOverrideReason')}
          busy={action.busy || !status}
          error={action.error}
          onClose={() => setMode(null)}
          onConfirm={async (reason) => {
            if (!status) return;
            const ok = await action.run(() => shipmentsApi.override(waybill, status, reason));
            if (ok) {
              setMode(null);
              setDone(t('admin.shipments.overridden'));
              reload();
            }
          }}
        />
      )}
    </Modal>
  );
}

export function ShipmentsScreen() {
  const t = useTranslations();
  const { locale } = useLocaleState();
  const errorText = useErrorText();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const debounced = useDebounced(search);
  const [rows, setRows] = useState<ShipmentRow[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(
    async (before?: string) => {
      setBusy(true);
      setError(null);
      try {
        const q = debounced.trim();
        const page = await shipmentsApi.list({ status: status || undefined, q: q ? normalizeWaybill(q) : undefined, before, limit: 30 });
        setRows((r) => (before ? [...r, ...page.items] : page.items));
        setNext(page.nextBefore);
      } catch (e) {
        setError(e);
      } finally {
        setBusy(false);
      }
    },
    [debounced, status],
  );
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Page title={t('admin.nav.shipments')} subtitle={t('admin.shipments.subtitle')}>
      <div className="card flex flex-wrap items-end gap-3">
        <div className="min-w-60 flex-1">
          <Field label={t('admin.shipments.search')} hint={t('admin.shipments.searchHint')}>
            {(p) => <input {...p} className="input" type="search" value={search} onChange={(e) => setSearch(e.target.value)} />}
          </Field>
        </div>
        <Field label={t('common.labels.status')}>
          {(p) => (
            <select {...p} className="input w-64" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">{t('admin.common.all')}</option>
              {SHIPMENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`status.${s}.label`)}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>

      {error ? <ErrorNote onRetry={() => void load()}>{errorText(error)}</ErrorNote> : null}
      {rows.length === 0 && !busy && !error ? (
        <Empty>{t('admin.common.empty')}</Empty>
      ) : (
        <DataTable
          caption={t('admin.nav.shipments')}
          head={
            <>
              <th>{t('admin.shipments.waybill')}</th>
              <th>{t('common.labels.status')}</th>
              <th>{t('admin.shipments.route')}</th>
              <th>{t('admin.shipments.canal')}</th>
              <th>{t('admin.shipments.total')}</th>
              <th>{t('admin.shipments.created')}</th>
            </>
          }
        >
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                <button type="button" className="font-mono font-semibold text-brand-700 underline" onClick={() => setOpen(r.waybillNumber)}>
                  {r.waybillNumber}
                </button>
              </td>
              <td>
                <ShipmentStatus status={r.status} />
              </td>
              <td>
                {r.origin?.code} → {r.destination?.code}
              </td>
              <td>{t(`admin.canal.${r.transportCanal}` as 'admin.canal.BUS_BAGGAGE')}</td>
              <td>{r.fees.total?.display ?? '—'}</td>
              <td>{formatDiliDateTime(r.createdAt, locale)}</td>
            </tr>
          ))}
        </DataTable>
      )}
      {busy && <Loading />}
      {next && !busy && (
        <button type="button" className="btn btn-outline" onClick={() => void load(next)}>
          {t('admin.common.loadMore')}
        </button>
      )}
      {open && <ShipmentDetail waybill={open} onClose={() => setOpen(null)} onChanged={() => void load()} />}
    </Page>
  );
}
