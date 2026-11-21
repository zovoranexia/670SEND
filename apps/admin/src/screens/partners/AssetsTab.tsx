import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { Await, Badge, DataTable, ErrorNote, Field, Section } from '@/components/ui';
import { useAction, useCan, useResource } from '@/hooks';
import { useLocaleState } from '@/i18n';
import { partnersApi } from '@/lib/endpoints';
import { formatDiliDate } from '@/lib/format';

/** Vehicles (DNTT permit + KIR) and drivers (licence) of the fleet partners: verify, deactivate. */
export function AssetsTab() {
  const t = useTranslations();
  const can = useCan();
  const { locale } = useLocaleState();
  const [partnerId, setPartnerId] = useState('');
  const action = useAction();
  const partners = useResource((s) => partnersApi.fleetPartners({ limit: 200 }, s), []);
  const vehicles = useResource((s) => partnersApi.vehicles({ fleetPartnerId: partnerId || undefined }, s), [partnerId], { enabled: can('vehicles:read') });
  const drivers = useResource((s) => partnersApi.drivers({ fleetPartnerId: partnerId || undefined }, s), [partnerId], { enabled: can('drivers:read') });

  const date = (iso: string | null) => formatDiliDate(iso, locale) || t('admin.partners.missing');

  return (
    <div className="space-y-6">
      <div className="card">
        <Field label={t('admin.hubs.fleet')}>
          {(p) => (
            <select {...p} className="input w-80" value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
              <option value="">{t('admin.common.all')}</option>
              {(partners.data ?? []).map((x) => (
                <option key={x.id} value={x.id}>
                  {x.companyName}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      {action.error && <ErrorNote>{action.error}</ErrorNote>}

      {can('vehicles:read') && (
        <Section title={t('admin.partners.vehicles')}>
          <Await res={vehicles} empty={(d) => d.length === 0}>
            {(rows) => (
              <DataTable
                caption={t('admin.partners.vehicles')}
                head={
                  <>
                    <th>{t('admin.partners.plate')}</th>
                    <th>{t('admin.partners.vehicleType')}</th>
                    <th>{t('admin.hubs.fleet')}</th>
                    <th>{t('admin.partners.slots')}</th>
                    <th>DNTT</th>
                    <th>KIR</th>
                    <th>{t('common.labels.status')}</th>
                    {can('vehicles:manage') && <th />}
                  </>
                }
              >
                {rows.map((v) => (
                  <tr key={v.id}>
                    <td className="font-mono font-semibold">{v.plateNumber}</td>
                    <td>{t(`admin.partners.vtype.${v.type}` as 'admin.partners.vtype.BUS_PASSENGER')}</td>
                    <td>{v.fleetPartner.companyName}</td>
                    <td>{v.maxParcelSlots}</td>
                    <td>{date(v.dnttPermitExpiry)}</td>
                    <td>{date(v.kirExpiry)}</td>
                    <td>
                      {v.isActive ? <Badge tone="green">{t('admin.state.ACTIVE')}</Badge> : <Badge tone="slate">{t('admin.partners.inactive')}</Badge>} {!v.permitsValid && <Badge tone="red">{t('admin.partners.permitsExpired')}</Badge>}
                    </td>
                    {can('vehicles:manage') && (
                      <td>
                        <button
                          type="button"
                          className="btn btn-outline btn-sm"
                          disabled={action.busy}
                          onClick={async () => {
                            if (await action.run(() => (v.isActive ? partnersApi.deactivateVehicle(v.id) : partnersApi.verifyVehicle(v.id)))) vehicles.reload();
                          }}
                        >
                          {v.isActive ? t('admin.partners.deactivate') : t('admin.partners.verify')}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </DataTable>
            )}
          </Await>
        </Section>
      )}

      {can('drivers:read') && (
        <Section title={t('admin.partners.drivers')}>
          <Await res={drivers} empty={(d) => d.length === 0}>
            {(rows) => (
              <DataTable
                caption={t('admin.partners.drivers')}
                head={
                  <>
                    <th>{t('common.labels.name')}</th>
                    <th>{t('common.labels.phone')}</th>
                    <th>{t('admin.hubs.fleet')}</th>
                    <th>{t('admin.partners.license')}</th>
                    <th>{t('admin.partners.licenseExpiry')}</th>
                    <th>{t('common.labels.status')}</th>
                    {can('drivers:manage') && <th />}
                  </>
                }
              >
                {rows.map((d) => (
                  <tr key={d.id}>
                    <td className="font-semibold">{d.name}</td>
                    <td>{d.phone ?? '—'}</td>
                    <td>{d.fleetPartner.companyName}</td>
                    <td className="font-mono">{d.licenseNumber}</td>
                    <td>{date(d.licenseExpiry)}</td>
                    <td>
                      {d.isActive ? <Badge tone="green">{t('admin.state.ACTIVE')}</Badge> : <Badge tone="slate">{t('admin.partners.inactive')}</Badge>} {!d.licenseValid && <Badge tone="red">{t('admin.partners.licenseExpired')}</Badge>}
                    </td>
                    {can('drivers:manage') && (
                      <td>
                        <button
                          type="button"
                          className="btn btn-outline btn-sm"
                          disabled={action.busy}
                          onClick={async () => {
                            if (await action.run(() => (d.isActive ? partnersApi.deactivateDriver(d.id) : partnersApi.verifyDriver(d.id)))) drivers.reload();
                          }}
                        >
                          {d.isActive ? t('admin.partners.deactivate') : t('admin.partners.verify')}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </DataTable>
            )}
          </Await>
        </Section>
      )}
    </div>
  );
}
