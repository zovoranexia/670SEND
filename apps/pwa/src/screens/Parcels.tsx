import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useTranslations } from 'use-intl';
import { IconChevron } from '@/components/icons';
import { PrintActions } from '@/components/PrintActions';
import { ErrorNote, Empty, Loading, Page } from '@/components/ui';
import { useErrorText, useResource } from '@/hooks';
import { useLocaleState } from '@/i18n';
import { api } from '@/lib/api';
import { formatDiliDateTime } from '@/lib/format';
import { receiptLang, usePrintLang } from '@/lib/prefs';
import type { Shipment } from '@/lib/types';

const FILTERS = {
  all: undefined,
  active: 'PICKUP_ASSIGNED,DROPPED_AT_ORIGIN,CONSOLIDATED_AT_HUB,IN_TRANSIT,ARRIVED_AT_DEST_AGENT,OUT_FOR_DELIVERY,ON_HOLD_ISSUE',
  waiting: 'ARRIVED_AT_DEST_AGENT',
} as const;
type Filter = keyof typeof FILTERS;

export function ParcelsScreen() {
  const t = useTranslations();
  const errorText = useErrorText();
  const { locale } = useLocaleState();
  const [filter, setFilter] = useState<Filter>('active');
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [extra, setExtra] = useState<Shipment[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [more, setMore] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(query.trim()), 350);
    return () => clearTimeout(id);
  }, [query]);

  const first = useResource((s) => api.listShipments({ ...(FILTERS[filter] ? { status: FILTERS[filter] } : {}), ...(debounced ? { q: debounced } : {}), limit: 20 }, s), [filter, debounced]);
  useEffect(() => {
    setExtra([]);
    setCursor(null);
  }, [filter, debounced]);

  const items = [...(first.data?.items ?? []), ...extra];
  const next = cursor ?? first.data?.nextBefore ?? null;

  async function loadMore() {
    if (!next) return;
    setMore(true);
    try {
      const page = await api.listShipments({ ...(FILTERS[filter] ? { status: FILTERS[filter] } : {}), ...(debounced ? { q: debounced } : {}), before: next, limit: 20 });
      setExtra((e) => [...e, ...page.items]);
      setCursor(page.nextBefore);
    } finally {
      setMore(false);
    }
  }

  return (
    <Page title={t('pwa.parcels.title')}>
      <div className="flex gap-2" role="group" aria-label={t('pwa.parcels.title')}>
        {(Object.keys(FILTERS) as Filter[]).map((f) => (
          <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)} className={`min-h-11 flex-1 rounded-full px-3 text-sm font-bold ${filter === f ? 'bg-brand-700 text-white' : 'bg-white text-brand-800 ring-1 ring-slate-300'}`}>
            {t(`pwa.parcels.${f}`)}
          </button>
        ))}
      </div>
      <input className="input" type="search" inputMode="search" placeholder={t('pwa.parcels.search')} aria-label={t('pwa.parcels.search')} value={query} onChange={(e) => setQuery(e.target.value)} />

      {first.loading && <Loading />}
      {first.error ? <ErrorNote onRetry={first.reload}>{errorText(first.error)}</ErrorNote> : null}
      {!first.loading && !first.error && items.length === 0 && <Empty>{t('pwa.app.empty')}</Empty>}
      <ul className="space-y-2">
        {items.map((s) => (
          <li key={s.id}>
            <Link to={`/parcels/${s.waybillNumber}`} className="card flex min-h-16 items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-mono text-sm font-bold text-brand-700">{s.waybillNumber}</p>
                <p className="truncate text-base">
                  {s.origin.name} → {s.destination.name}
                </p>
                <p className="text-sm text-slate-600">
                  {t(`status.${s.status as 'DELIVERED'}.label`)} · {formatDiliDateTime(s.createdAt, locale)}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <span className="font-bold text-brand-800">{s.fees.total.display}</span>
                <IconChevron className="text-slate-500" />
              </div>
            </Link>
          </li>
        ))}
      </ul>
      {next && (
        <button type="button" className="btn btn-outline w-full" onClick={() => void loadMore()} disabled={more}>
          {t('pwa.parcels.loadMore')}
        </button>
      )}
    </Page>
  );
}

export function ParcelDetailScreen() {
  const t = useTranslations();
  const errorText = useErrorText();
  const navigate = useNavigate();
  const { locale } = useLocaleState();
  const printLang = usePrintLang();
  const { waybill = '' } = useParams();
  const parcel = useResource((s) => api.shipment(waybill, s), [waybill]);

  if (parcel.loading) return <Loading />;
  if (parcel.error || !parcel.data) return <Page title={t('pwa.parcels.title')}><ErrorNote onRetry={parcel.reload}>{errorText(parcel.error)}</ErrorNote></Page>;
  const s = parcel.data;
  const canHandOver = s.status === 'ARRIVED_AT_DEST_AGENT';
  return (
    <Page title={t('pwa.parcels.details')} back={<button type="button" className="min-h-11 min-w-11 text-2xl text-brand-700" onClick={() => navigate(-1)} aria-label={t('common.actions.back')}>‹</button>}>
      <div className="card space-y-2">
        <p className="break-all font-mono text-lg font-bold text-brand-700">{s.waybillNumber}</p>
        <p className="font-semibold text-brand-800">{t(`status.${s.status as 'DELIVERED'}.label`)}</p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-base">
          <dt className="text-slate-600">{t('pwa.parcels.route')}</dt>
          <dd>
            {s.origin.name} → {s.destination.name}
          </dd>
          <dt className="text-slate-600">{t('pwa.wizard.sender')}</dt>
          <dd>{s.sender.name}</dd>
          <dt className="text-slate-600">{t('pwa.wizard.recipient')}</dt>
          <dd>{s.recipient.name}</dd>
          <dt className="text-slate-600">{t('pwa.parcels.fee')}</dt>
          <dd className="font-bold">{s.fees.total.display}</dd>
          <dt className="text-slate-600">{t('pwa.parcels.created')}</dt>
          <dd>{formatDiliDateTime(s.createdAt, locale)}</dd>
        </dl>
      </div>
      {canHandOver && (
        <Link to={`/handover?no=${s.waybillNumber}`} className="btn btn-accent w-full">
          {t('pwa.nav.pickup')}
        </Link>
      )}
      <PrintActions load={() => api.receipt(s.id, receiptLang(printLang, s.sender.lang))} deps={[s.id, printLang]} />
    </Page>
  );
}
