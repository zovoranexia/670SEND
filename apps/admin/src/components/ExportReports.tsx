import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { ErrorNote, Field } from '@/components/ui';
import { IconDownload } from '@/components/icons';
import { useAction, useCan } from '@/hooks';
import { download, q } from '@/lib/api';
import { diliToday, saveBlob } from '@/lib/format';
import type { ReportName } from '@/lib/types';

/** Which permission each CSV needs on the server (mirrors AnalyticsController). */
const NEEDS: Record<ReportName, string[]> = {
  shipments: ['reports:export'],
  ledger: ['reports:export', 'ledger:read'],
  claims: ['reports:export', 'claims:read'],
  deposits: ['reports:export', 'deposits:read'],
};

/** CSV exports for a Dili date range. Only the reports this user may download are offered. */
export function ExportReports({ reports }: { reports: ReportName[] }) {
  const t = useTranslations();
  const can = useCan();
  const [from, setFrom] = useState(() => diliToday(-29));
  const [to, setTo] = useState(() => diliToday());
  const action = useAction();
  const allowed = reports.filter((r) => NEEDS[r].every(can));
  if (allowed.length === 0) return null;
  const rangeOk = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to;

  return (
    <section className="card space-y-3" aria-labelledby="export-title">
      <h2 id="export-title" className="h2">
        {t('admin.reports.title')}
      </h2>
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t('common.labels.from')}>{(p) => <input {...p} className="input w-44" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />}</Field>
        <Field label={t('common.labels.to')}>{(p) => <input {...p} className="input w-44" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />}</Field>
        {allowed.map((r) => (
          <button
            key={r}
            type="button"
            className="btn btn-outline"
            disabled={!rangeOk || action.busy}
            onClick={() =>
              void action.run(async () => {
                const f = await download(`/reports/${r}.csv${q({ from, to })}`);
                saveBlob(f.blob, `${r}-${from}_${to}.csv`);
              })
            }
          >
            <IconDownload width={16} height={16} />
            {t(`admin.reports.${r}`)}
          </button>
        ))}
      </div>
      {action.error && <ErrorNote>{action.error}</ErrorNote>}
      <p className="text-sm text-slate-600">{t('admin.reports.hint')}</p>
    </section>
  );
}
