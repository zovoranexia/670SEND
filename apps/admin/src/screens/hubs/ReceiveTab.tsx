import { useMemo, useState } from 'react';
import { useTranslations } from 'use-intl';
import { HUBS } from '@670send/types';
import { DataTable, ErrorNote, Field, Notice } from '@/components/ui';
import { useAction, useResource } from '@/hooks';
import { hubsApi, shipmentsApi } from '@/lib/endpoints';
import type { ReceiveResult } from '@/lib/types';
import { HubSelect, municipalitiesOf, parseWaybills, useReasonText } from './common';

/** Parcels dropped at origin arrive at the hub: scan or paste their waybills → CONSOLIDATED_AT_HUB. */
export function ReceiveTab() {
  const t = useTranslations();
  const reason = useReasonText();
  const [hub, setHub] = useState<string>(HUBS[0]!.code);
  const [text, setText] = useState('');
  const [result, setResult] = useState<ReceiveResult | null>(null);
  const action = useAction();

  const incoming = useResource((s) => shipmentsApi.list({ status: 'DROPPED_AT_ORIGIN', limit: 100 }, s), []);
  const dests = useMemo(() => new Set(municipalitiesOf(hub).map((m) => m.code)), [hub]);
  const forThisHub = (incoming.data?.items ?? []).filter((s) => s.destination && dests.has(s.destination.code));
  const waybills = parseWaybills(text);

  async function submit() {
    setResult(null);
    await action.run(async () => {
      const r = await hubsApi.receive(hub, waybills);
      setResult(r);
      const failed = new Set(r.failed.map((f) => f.waybill));
      setText(waybills.filter((w) => failed.has(w)).join('\n')); // what is left is exactly what needs attention
      incoming.reload();
    });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="card space-y-3">
        <h2 className="h2">{t('admin.hubs.receiveTitle')}</h2>
        <p className="text-sm text-slate-600">{t('admin.hubs.receiveIntro')}</p>
        <HubSelect
          value={hub}
          onChange={(h) => {
            setHub(h);
            setResult(null);
          }}
        />
        <Field label={t('admin.hubs.waybillsLabel')} hint={t('admin.hubs.waybillsHint', { count: waybills.length })}>
          {(p) => <textarea {...p} className="input min-h-32 font-mono" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />}
        </Field>
        {action.error && <ErrorNote>{action.error}</ErrorNote>}
        <button type="button" className="btn btn-primary" disabled={action.busy || waybills.length === 0 || waybills.length > 100} onClick={() => void submit()}>
          {t('admin.hubs.receiveSubmit')}
        </button>
        {result && (
          <div className="space-y-2" aria-live="polite">
            {result.received.length > 0 && <Notice tone="ok">{t('admin.hubs.receivedCount', { count: result.received.length })}</Notice>}
            {result.failed.length > 0 && (
              <Notice tone="warn">
                <p className="font-semibold">{t('admin.hubs.failedCount', { count: result.failed.length })}</p>
                <ul className="mt-1 list-disc pl-5">
                  {result.failed.map((f) => (
                    <li key={f.waybill}>
                      <span className="font-mono">{f.waybill}</span> — {reason(f.code)}
                    </li>
                  ))}
                </ul>
              </Notice>
            )}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="h2">{t('admin.hubs.expected')}</h2>
          {forThisHub.length > 0 && (
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setText(forThisHub.map((s) => s.waybillNumber).join('\n'))}>
              {t('admin.hubs.addAll', { count: forThisHub.length })}
            </button>
          )}
        </div>
        <DataTable
          caption={t('admin.hubs.expected')}
          head={
            <>
              <th>{t('admin.shipments.waybill')}</th>
              <th>{t('admin.shipments.route')}</th>
              <th>{t('admin.shipments.canal')}</th>
            </>
          }
        >
          {forThisHub.length === 0 ? (
            <tr>
              <td colSpan={3} className="text-center text-slate-600">
                {t('admin.hubs.nothingExpected')}
              </td>
            </tr>
          ) : (
            forThisHub.map((s) => (
              <tr key={s.id}>
                <td className="font-mono">{s.waybillNumber}</td>
                <td>
                  {s.origin?.code} → {s.destination?.code}
                </td>
                <td>{t(`admin.canal.${s.transportCanal}` as 'admin.canal.BUS_BAGGAGE')}</td>
              </tr>
            ))
          )}
        </DataTable>
      </div>
    </div>
  );
}
