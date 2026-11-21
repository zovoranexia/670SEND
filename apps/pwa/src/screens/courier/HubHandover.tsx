import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { HUBS } from '@670send/types';
import { Check, SelectInput } from '@/components/forms';
import { ErrorNote, Empty, Loading, Notice, Page } from '@/components/ui';
import { useErrorText, useResource } from '@/hooks';
import { api } from '@/lib/api';
import { useProfile } from '@/profile';

/** The courier hands the parcels they collected at the door over to a hub desk. */
export function HubHandoverScreen() {
  const t = useTranslations();
  const errorText = useErrorText();
  const { profile } = useProfile();
  const parcels = useResource((s) => api.listShipments({ status: 'DROPPED_AT_ORIGIN', limit: 50 }, s), []);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [hub, setHub] = useState<string>(profile?.kind === 'COURIER' ? (profile.hub?.code ?? HUBS[0]!.code) : HUBS[0]!.code);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ received: string[]; failed: Array<{ waybill: string; reason?: string }> } | null>(null);

  const items = parcels.data?.items ?? [];
  const allPicked = items.length > 0 && items.every((s) => picked.has(s.waybillNumber));

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      setResult(await api.hubReceive(hub, [...picked]));
      setPicked(new Set());
      parcels.reload();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page title={t('pwa.nav.handover')}>
      <p className="text-base text-slate-700">{t('pwa.courier.handoverHint')}</p>
      <SelectInput label={t('pwa.courier.hub')} value={hub} onChange={setHub} options={HUBS.map((h) => ({ value: h.code, label: h.name }))} />
      {parcels.loading && <Loading />}
      {parcels.error ? <ErrorNote onRetry={parcels.reload}>{errorText(parcels.error)}</ErrorNote> : null}
      {!parcels.loading && !parcels.error && items.length === 0 && !result && <Empty>{t('pwa.courier.noPickedUp')}</Empty>}

      {items.length > 0 && (
        <div className="space-y-2">
          <Check checked={allPicked} onChange={(v) => setPicked(v ? new Set(items.map((s) => s.waybillNumber)) : new Set())}>
            <span className="font-bold">{t('pwa.parcels.all')}</span>
          </Check>
          {items.map((s) => (
            <Check
              key={s.id}
              checked={picked.has(s.waybillNumber)}
              onChange={(v) =>
                setPicked((cur) => {
                  const next = new Set(cur);
                  if (v) next.add(s.waybillNumber);
                  else next.delete(s.waybillNumber);
                  return next;
                })
              }
            >
              <span className="block font-mono text-sm font-bold text-brand-700">{s.waybillNumber}</span>
              <span className="block">
                {s.sender.name} → {s.destination.name}
              </span>
            </Check>
          ))}
        </div>
      )}

      {error && <ErrorNote>{error}</ErrorNote>}
      {result && (
        <>
          {result.received.length > 0 && <Notice tone="ok">{t('pwa.courier.handedOver', { n: result.received.length })}</Notice>}
          {result.failed.length > 0 && <Notice tone="warn">{t('pwa.courier.handoverFailed', { list: result.failed.map((f) => f.waybill).join(', ') })}</Notice>}
        </>
      )}
      {items.length > 0 && (
        <button type="button" className="btn btn-primary w-full" disabled={picked.size === 0 || busy} onClick={() => void submit()}>
          {t('pwa.courier.handOver')} ({picked.size})
        </button>
      )}
    </Page>
  );
}
