import { Link } from 'react-router';
import { useTranslations } from 'use-intl';
import { SHIPMENT_STATUSES } from '@670send/types';
import { ExportReports } from '@/components/ExportReports';
import { IconRefresh } from '@/components/icons';
import { Await, DataTable, Page, StatCard } from '@/components/ui';
import { useCan, useResource } from '@/hooks';
import { useLocaleState } from '@/i18n';
import { analyticsApi } from '@/lib/endpoints';
import { formatDiliDateTime, usd } from '@/lib/format';
import type { Executive } from '@/lib/types';

/** 14 daily bars: height = parcels. The table below carries the exact numbers (and is what screen readers read). */
function VolumeChart({ days }: { days: Executive['last14Days'] }) {
  const t = useTranslations();
  const max = Math.max(1, ...days.map((d) => d.parcels));
  return (
    <div className="card">
      <h2 className="h2 mb-3">{t('admin.dashboard.last14')}</h2>
      <div className="flex h-36 items-end gap-1" role="img" aria-label={t('admin.dashboard.last14')}>
        {days.map((d) => (
          <div key={d.date} className="flex h-full flex-1 flex-col items-center justify-end" title={`${d.date}: ${d.parcels} · ${usd(d.gmv)}`}>
            <div className="w-full rounded-t bg-brand-500" style={{ height: `${Math.max(2, (d.parcels / max) * 100)}%` }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-xs text-slate-600">
        <span>{days[0]?.date.slice(5)}</span>
        <span>{days[days.length - 1]?.date.slice(5)}</span>
      </div>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer font-semibold text-brand-700">{t('admin.dashboard.showNumbers')}</summary>
        <DataTable
          caption={t('admin.dashboard.last14')}
          head={
            <>
              <th>{t('common.labels.date')}</th>
              <th>{t('admin.dashboard.parcels')}</th>
              <th>GMV</th>
            </>
          }
        >
          {days.map((d) => (
            <tr key={d.date}>
              <td>{d.date}</td>
              <td>{d.parcels}</td>
              <td>{usd(d.gmv)}</td>
            </tr>
          ))}
        </DataTable>
      </details>
    </div>
  );
}

export function DashboardScreen() {
  const t = useTranslations();
  const can = useCan();
  const { locale } = useLocaleState();
  const res = useResource((signal) => analyticsApi.executive(signal), []);

  const queueLink = (to: string, perm: string, label: string, value: string | number, tone?: 'warn' | 'bad', hint?: string) => (
    <Link to={to} className={can(perm) ? 'block' : 'pointer-events-none block opacity-60'} aria-disabled={!can(perm)} tabIndex={can(perm) ? 0 : -1}>
      <StatCard label={label} value={value} tone={tone} hint={hint} />
    </Link>
  );

  return (
    <Page
      title={t('admin.nav.dashboard')}
      subtitle={res.data ? t('admin.dashboard.asOf', { time: formatDiliDateTime(res.data.asOf, locale) }) : undefined}
      actions={
        <button type="button" className="btn btn-outline btn-sm" onClick={res.reload} disabled={res.loading}>
          <IconRefresh width={16} height={16} />
          {t('admin.common.refresh')}
        </button>
      }
    >
      <Await res={res}>
        {(d) => (
          <>
            <section aria-label={t('admin.dashboard.money')} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard label={t('admin.dashboard.gmvToday')} value={usd(d.gmv.today)} />
              <StatCard label={t('admin.dashboard.gmvMonth')} value={usd(d.gmv.month)} />
              <StatCard label={t('admin.dashboard.platformRevenue')} value={usd(d.platformRevenue.month)} hint={t('admin.dashboard.walletBalance', { amount: usd(d.platformRevenue.walletBalance) })} />
              <StatCard label={t('admin.dashboard.claimReserve')} value={usd(d.reserves.claimEscrow)} hint={t('admin.dashboard.insurancePool', { amount: usd(d.reserves.insurancePool) })} />
            </section>

            <section aria-label={t('admin.dashboard.queuesTitle')} className="space-y-2">
              <h2 className="h2">{t('admin.dashboard.queuesTitle')}</h2>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {queueLink('/finance', 'deposits:read', t('admin.dashboard.pendingDeposits'), d.queues.pendingDeposits.count, d.queues.pendingDeposits.count > 0 ? 'warn' : undefined, usd(d.queues.pendingDeposits.amount))}
                {queueLink('/finance', 'payouts:read', t('admin.dashboard.payoutsAwaiting'), d.queues.payoutsAwaitingApproval, d.queues.payoutsAwaitingApproval > 0 ? 'warn' : undefined)}
                {queueLink('/claims', 'claims:read', t('admin.dashboard.openClaims'), d.queues.openClaims, d.queues.openClaims > 0 ? 'warn' : undefined)}
                {queueLink('/claims', 'incidents:read', t('admin.dashboard.openIncidents'), d.queues.openIncidents, d.queues.openIncidents > 0 ? 'bad' : undefined)}
              </div>
            </section>

            <section aria-label={t('admin.dashboard.parcelsTitle')} className="space-y-2">
              <h2 className="h2">{t('admin.dashboard.parcelsTitle')}</h2>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard label={t('admin.dashboard.inTransit')} value={d.shipments.inTransit} />
                <StatCard label={t('admin.dashboard.atHub')} value={d.shipments.atHub} />
                <StatCard label={t('admin.dashboard.atKiosk')} value={d.shipments.atKiosk} />
                <StatCard label={t('admin.dashboard.onHold')} value={d.shipments.onHold} tone={d.shipments.onHold > 0 ? 'bad' : undefined} />
                <StatCard label={t('admin.dashboard.unclaimed')} value={d.shipments.unclaimedOver5Days} tone={d.shipments.unclaimedOver5Days > 0 ? 'warn' : undefined} />
                {queueLink('/claims', 'rts:manage', t('admin.dashboard.rtsPending'), d.shipments.returnToSenderPending, d.shipments.returnToSenderPending > 0 ? 'warn' : undefined)}
              </div>
            </section>

            <div className="grid gap-4 xl:grid-cols-2">
              <VolumeChart days={d.last14Days} />
              <div className="space-y-4">
                <div className="card">
                  <h2 className="h2 mb-3">{t('admin.dashboard.byStatus')}</h2>
                  <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                    {SHIPMENT_STATUSES.map((s) => (
                      <li key={s} className="flex justify-between text-sm">
                        <span>{t(`status.${s}.label`)}</span>
                        <span className="font-semibold">{d.shipments.byStatus[s] ?? 0}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h2 className="h2 mb-2">{t('admin.dashboard.byCorridor')}</h2>
                  <DataTable
                    caption={t('admin.dashboard.byCorridor')}
                    head={
                      <>
                        <th>{t('admin.dashboard.corridor')}</th>
                        <th>{t('admin.dashboard.parcels')}</th>
                        <th>GMV</th>
                      </>
                    }
                  >
                    {d.byCorridor.map((c) => (
                      <tr key={c.corridor}>
                        <td>{t(`web.corridors.${c.corridor}` as 'web.corridors.EAST')}</td>
                        <td>{c.parcels}</td>
                        <td>{usd(c.gmv)}</td>
                      </tr>
                    ))}
                  </DataTable>
                </div>
              </div>
            </div>
          </>
        )}
      </Await>
      <ExportReports reports={['shipments', 'ledger', 'claims', 'deposits']} />
    </Page>
  );
}
