import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'use-intl';
import { DataTable, Empty, ErrorNote, Field, Loading, Modal, Page } from '@/components/ui';
import { useErrorText } from '@/hooks';
import { useLocaleState } from '@/i18n';
import { accessApi } from '@/lib/endpoints';
import { diliDayEndIso, diliDayStartIso, diliToday, formatDiliDateTime } from '@/lib/format';
import type { AuditLogRow } from '@/lib/types';

/** The values the API writes today (free text is also accepted for new ones). */
const ENTITY_TYPES = ['addon_tariff', 'agent', 'claim', 'courier', 'deposit_request', 'driver', 'fleet_partner', 'fleet_payout', 'hub', 'inbound_incident', 'manifest', 'master_bag', 'municipality', 'notification_template', 'pickup_booking', 'pricing_zone', 'role', 'route', 'shipment', 'system_setting', 'user', 'vehicle'];
const SECURITY = ['AUTHZ_DENIED', 'AUTH_ACCOUNT_LOCKED', 'AUTH_LOGIN_FAILED', 'AUTH_REFRESH_REUSE_DETECTED', 'FLEET_BANK_DETAILS_REVEALED', 'SHIPMENT_STATUS_OVERRIDDEN', 'ROLE_PERMISSIONS_CHANGED', 'USER_ROLES_CHANGED', 'USER_CREDENTIALS_RESET'];

function Json({ value }: { value: unknown }) {
  return <pre className="max-h-72 overflow-auto rounded bg-slate-50 p-2 text-xs">{value == null ? '—' : JSON.stringify(value, null, 2)}</pre>;
}

function Detail({ row, onClose }: { row: AuditLogRow; onClose: () => void }) {
  const t = useTranslations();
  const { locale } = useLocaleState();
  return (
    <Modal title={row.action} onClose={onClose} wide>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="font-semibold">{t('common.labels.date')}</dt>
        <dd>{formatDiliDateTime(row.at, locale)}</dd>
        <dt className="font-semibold">{t('admin.audit.actor')}</dt>
        <dd>
          {row.actor ?? t('admin.audit.system')} {row.actorRoles.length > 0 && <span className="text-slate-600">({row.actorRoles.join(', ')})</span>}
        </dd>
        <dt className="font-semibold">{t('admin.audit.entity')}</dt>
        <dd className="font-mono text-xs">
          {row.entityType} {row.entityId}
        </dd>
        {row.reason && (
          <>
            <dt className="font-semibold">{t('admin.audit.reason')}</dt>
            <dd>{row.reason}</dd>
          </>
        )}
        <dt className="font-semibold">IP</dt>
        <dd className="font-mono text-xs">{row.ip ?? '—'}</dd>
        <dt className="font-semibold">{t('admin.audit.requestId')}</dt>
        <dd className="font-mono text-xs">{row.requestId ?? '—'}</dd>
      </dl>
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <h3 className="h2 mb-1">{t('admin.audit.before')}</h3>
          <Json value={row.before} />
        </div>
        <div>
          <h3 className="h2 mb-1">{t('admin.audit.after')}</h3>
          <Json value={row.after} />
        </div>
      </div>
      <p className="text-xs text-slate-600">{t('admin.audit.redacted')}</p>
    </Modal>
  );
}

/** Immutable audit trail: who did what, to what, when — with before/after values. Sensitive values are redacted by the API. */
export function AuditScreen() {
  const t = useTranslations();
  const { locale } = useLocaleState();
  const errorText = useErrorText();
  const [from, setFrom] = useState(() => diliToday(-6));
  const [to, setTo] = useState(() => diliToday());
  const [entityType, setEntityType] = useState('');
  const [entityId, setEntityId] = useState('');
  const [action, setAction] = useState('');
  const [onlySecurity, setOnlySecurity] = useState(false);
  const [rows, setRows] = useState<AuditLogRow[]>([]);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [open, setOpen] = useState<AuditLogRow | null>(null);

  const load = useCallback(
    async (before?: string) => {
      setBusy(true);
      setError(null);
      try {
        const page = await accessApi.audit({
          from: diliDayStartIso(from),
          to: diliDayEndIso(to),
          entityType: entityType || undefined,
          entityId: entityId.trim() || undefined,
          action: action.trim().toUpperCase() || undefined,
          before,
          limit: 100,
        });
        setRows((r) => (before ? [...r, ...page] : page));
        setMore(page.length === 100);
      } catch (e) {
        setError(e);
      } finally {
        setBusy(false);
      }
    },
    [from, to, entityType, entityId, action],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const shown = onlySecurity ? rows.filter((r) => SECURITY.includes(r.action)) : rows;

  return (
    <Page title={t('admin.nav.audit')} subtitle={t('admin.audit.subtitle')}>
      <div className="card flex flex-wrap items-end gap-3">
        <Field label={t('common.labels.from')}>{(p) => <input {...p} className="input w-44" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />}</Field>
        <Field label={t('common.labels.to')}>{(p) => <input {...p} className="input w-44" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />}</Field>
        <Field label={t('admin.audit.entity')}>
          {(p) => (
            <select {...p} className="input w-56" value={entityType} onChange={(e) => setEntityType(e.target.value)}>
              <option value="">{t('admin.common.all')}</option>
              {ENTITY_TYPES.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t('admin.audit.entityId')} hint={t('admin.audit.entityIdHint')}>
          {(p) => <input {...p} className="input w-64 font-mono" value={entityId} onChange={(e) => setEntityId(e.target.value)} maxLength={80} />}
        </Field>
        <Field label={t('admin.audit.action')} hint={t('admin.audit.actionHint')}>
          {(p) => <input {...p} className="input w-60 font-mono" value={action} onChange={(e) => setAction(e.target.value)} maxLength={80} />}
        </Field>
        <label className="flex min-h-10 items-center gap-2 pb-1 text-sm">
          <input type="checkbox" checked={onlySecurity} onChange={(e) => setOnlySecurity(e.target.checked)} />
          {t('admin.audit.onlySecurity')}
        </label>
      </div>
      {error ? <ErrorNote onRetry={() => void load()}>{errorText(error)}</ErrorNote> : null}
      {shown.length === 0 && !busy && !error ? (
        <Empty>{t('admin.common.empty')}</Empty>
      ) : (
        <DataTable
          caption={t('admin.nav.audit')}
          head={
            <>
              <th>{t('common.labels.date')}</th>
              <th>{t('admin.audit.actor')}</th>
              <th>{t('admin.audit.action')}</th>
              <th>{t('admin.audit.entity')}</th>
              <th>{t('admin.audit.reason')}</th>
              <th />
            </>
          }
        >
          {shown.map((r) => (
            <tr key={r.id} className={SECURITY.includes(r.action) ? 'bg-amber-50' : ''}>
              <td className="whitespace-nowrap">{formatDiliDateTime(r.at, locale)}</td>
              <td>
                {r.actor ?? t('admin.audit.system')}
                {r.actorRoles.length > 0 && <p className="text-xs text-slate-600">{r.actorRoles.join(', ')}</p>}
              </td>
              <td className="font-mono text-xs font-semibold">{r.action}</td>
              <td className="text-xs">
                {r.entityType}
                {r.entityId && <p className="max-w-52 truncate font-mono text-slate-600">{r.entityId}</p>}
              </td>
              <td className="max-w-64 text-sm">{r.reason ?? ''}</td>
              <td>
                <button type="button" className="btn btn-outline btn-sm" onClick={() => setOpen(r)}>
                  {t('admin.audit.details')}
                </button>
              </td>
            </tr>
          ))}
        </DataTable>
      )}
      {busy && <Loading />}
      {more && !busy && rows.length > 0 && (
        <button type="button" className="btn btn-outline" onClick={() => void load(rows[rows.length - 1]!.at)}>
          {t('admin.common.loadMore')}
        </button>
      )}
      {open && <Detail row={open} onClose={() => setOpen(null)} />}
    </Page>
  );
}
