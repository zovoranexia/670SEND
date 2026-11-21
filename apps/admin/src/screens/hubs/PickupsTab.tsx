import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { StateBadge } from '@/components/StatusBadge';
import { Await, ConfirmDialog, DataTable, ErrorNote, Field, Modal, Section } from '@/components/ui';
import { useAction, useCan, useResource } from '@/hooks';
import { useLocaleState } from '@/i18n';
import { hubsApi, partnersApi } from '@/lib/endpoints';
import { formatDiliDateTime, whatsappUrl } from '@/lib/format';
import type { BookingRow, BookingStatus } from '@/lib/types';

const STATUSES: BookingStatus[] = ['REQUESTED', 'ASSIGNED', 'PICKED_UP', 'CANCELLED', 'EXPIRED'];

function AssignDialog({ booking, onClose, onDone }: { booking: BookingRow; onClose: () => void; onDone: () => void }) {
  const t = useTranslations();
  const action = useAction();
  const [courierId, setCourierId] = useState('');
  const couriers = useResource((s) => partnersApi.couriers({ limit: 200 }, s), []);
  const available = (couriers.data ?? []).filter((c) => c.status === 'ACTIVE' && c.isAvailable);
  return (
    <Modal title={t('admin.hubs.assignCourier')} onClose={onClose}>
      <p className="text-sm">
        {booking.batchCode} · {booking.sender.name} · {booking.pickupAddress}
      </p>
      <Field label={t('admin.hubs.courier')} hint={couriers.data && available.length === 0 ? t('admin.hubs.noCourier') : undefined}>
        {(p) => (
          <select {...p} className="input" value={courierId} onChange={(e) => setCourierId(e.target.value)}>
            <option value="">—</option>
            {available.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · {c.municipality.name}
              </option>
            ))}
          </select>
        )}
      </Field>
      {action.error && <ErrorNote>{action.error}</ErrorNote>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-outline" onClick={onClose}>
          {t('common.actions.cancel')}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={action.busy || !courierId}
          onClick={async () => {
            if (await action.run(() => hubsApi.assignBooking(booking.id, courierId))) onDone();
          }}
        >
          {t('admin.hubs.assign')}
        </button>
      </div>
    </Modal>
  );
}

/** Pick-up requests from the public site: call the customer, confirm, hand to a courier. */
export function PickupsTab() {
  const t = useTranslations();
  const can = useCan();
  const { locale } = useLocaleState();
  const [status, setStatus] = useState('REQUESTED');
  const [assign, setAssign] = useState<BookingRow | null>(null);
  const [cancel, setCancel] = useState<BookingRow | null>(null);
  const list = useResource((s) => hubsApi.bookings({ status: status || undefined, limit: 100 }, s), [status]);
  const action = useAction();
  const manage = can('pickups:assign');

  return (
    <Section title={t('admin.hubs.pickupsTitle')}>
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
      {action.error && <ErrorNote>{action.error}</ErrorNote>}
      <Await res={list} empty={(d) => d.length === 0}>
        {(rows) => (
          <DataTable
            caption={t('admin.hubs.pickupsTitle')}
            head={
              <>
                <th>{t('admin.hubs.batch')}</th>
                <th>{t('common.labels.status')}</th>
                <th>{t('admin.shipments.sender')}</th>
                <th>{t('common.labels.address')}</th>
                <th>{t('admin.hubs.parcels')}</th>
                <th>{t('admin.hubs.courier')}</th>
                <th>{t('admin.shipments.created')}</th>
                {manage && <th />}
              </>
            }
          >
            {rows.map((b) => (
              <tr key={b.id}>
                <td className="font-mono">{b.batchCode}</td>
                <td>
                  <StateBadge state={b.status} /> {b.status === 'REQUESTED' && !b.confirmed && <span className="badge bg-amber-100 text-amber-950">{t('admin.hubs.unconfirmed')}</span>}
                </td>
                <td>
                  {b.sender.name}
                  <br />
                  <a className="text-brand-700 underline" href={whatsappUrl(b.sender.phone)} target="_blank" rel="noreferrer noopener">
                    {b.sender.phone}
                  </a>
                </td>
                <td className="max-w-64">{b.pickupAddress}</td>
                <td>{b.parcelCount}</td>
                <td>{b.courier?.name ?? '—'}</td>
                <td>{formatDiliDateTime(b.createdAt, locale)}</td>
                {manage && (
                  <td className="space-x-1 whitespace-nowrap">
                    {b.status === 'REQUESTED' && !b.confirmed && (
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        disabled={action.busy}
                        onClick={async () => {
                          if (await action.run(() => hubsApi.confirmBooking(b.id))) list.reload();
                        }}
                      >
                        {t('admin.hubs.confirm')}
                      </button>
                    )}
                    {(b.status === 'REQUESTED' || b.status === 'ASSIGNED') && b.confirmed && (
                      <button type="button" className="btn btn-primary btn-sm" onClick={() => setAssign(b)}>
                        {b.status === 'ASSIGNED' ? t('admin.hubs.reassign') : t('admin.hubs.assign')}
                      </button>
                    )}
                    {(b.status === 'REQUESTED' || b.status === 'ASSIGNED') && (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCancel(b)}>
                        {t('common.actions.cancel')}
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </DataTable>
        )}
      </Await>
      {assign && (
        <AssignDialog
          booking={assign}
          onClose={() => setAssign(null)}
          onDone={() => {
            setAssign(null);
            list.reload();
          }}
        />
      )}
      {cancel && (
        <ConfirmDialog
          title={t('admin.hubs.cancelBooking')}
          message={`${cancel.batchCode} · ${cancel.sender.name}`}
          confirmLabel={t('admin.hubs.cancelBooking')}
          danger
          reasonLabel={t('admin.hubs.cancelReason')}
          busy={action.busy}
          error={action.error}
          onClose={() => setCancel(null)}
          onConfirm={async (reason) => {
            if (await action.run(() => hubsApi.cancelBooking(cancel.id, reason))) {
              setCancel(null);
              list.reload();
            }
          }}
        />
      )}
    </Section>
  );
}
