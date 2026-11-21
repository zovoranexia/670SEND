import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { Await, Badge, DataTable, Field, Section, type Tone } from '@/components/ui';
import { useResource } from '@/hooks';
import { useLocaleState } from '@/i18n';
import { partnersApi } from '@/lib/endpoints';
import { formatDiliDate } from '@/lib/format';

const TONE: Record<string, Tone> = { EXPIRED: 'red', MISSING: 'amber', EXPIRING: 'accent', INFO: 'slate' };

/** Everything that expires (MoU, permits, licences) or is missing (agent addendum) — plus agents running out of float. */
export function AlertsTab() {
  const t = useTranslations();
  const { locale } = useLocaleState();
  const [days, setDays] = useState(30);
  const res = useResource((s) => partnersApi.alerts(days, s), [days]);
  return (
    <Section title={t('admin.partners.alertsTitle')}>
      <div className="card">
        <Field label={t('admin.partners.horizon')}>
          {(p) => (
            <select {...p} className="input w-48" value={days} onChange={(e) => setDays(Number(e.target.value))}>
              {[7, 30, 60, 90].map((d) => (
                <option key={d} value={d}>
                  {t('admin.partners.days', { count: d })}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <Await res={res} empty={(d) => d.length === 0}>
        {(rows) => (
          <DataTable
            caption={t('admin.partners.alertsTitle')}
            head={
              <>
                <th>{t('admin.partners.alertType')}</th>
                <th>{t('admin.partners.subject')}</th>
                <th>{t('common.labels.status')}</th>
                <th>{t('admin.partners.due')}</th>
              </>
            }
          >
            {rows.map((a) => (
              <tr key={`${a.type}-${a.subjectId}`}>
                <td>{t(`admin.partners.alert.${a.type}` as 'admin.partners.alert.MOU')}</td>
                <td>{a.subject}</td>
                <td>
                  <Badge tone={TONE[a.severity]}>{t(`admin.partners.severity.${a.severity}`)}</Badge>
                </td>
                <td>{a.dueDate ? `${formatDiliDate(a.dueDate, locale)}${a.daysLeft != null ? ` (${a.daysLeft})` : ''}` : '—'}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Await>
    </Section>
  );
}
