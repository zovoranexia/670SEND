import { useLocale, useTranslations } from 'next-intl';
import type { Locale } from '@670send/types';
import { IconAlert, IconBus, IconClock, IconShip, IconTruck } from '@/components/icons';
import { Link } from '@/i18n/navigation';
import type { Money, Quote } from '@/lib/api';

const CANAL_ICON = { BUS_BAGGAGE: IconBus, CARGO_TRUCK_PICKUP: IconTruck, SEA_FERRY_CARGO: IconShip } as const;

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 py-2 ${strong ? 'font-bold text-brand-800' : 'text-slate-700'}`}>
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

/** The price breakdown and the way the parcel will travel. */
export function QuoteResult({ quote, stale, scheme }: { quote: Quote; stale?: boolean; scheme: string }) {
  const t = useTranslations('web');
  const tc = useTranslations('common');
  const locale = useLocale() as Locale;
  const CanalIcon = CANAL_ICON[quote.canal];
  const money = (m: Money) => m.display;
  const hasPickup = scheme === 'SCHEME_B' || scheme === 'SCHEME_D';

  return (
    <section className={`card transition-opacity ${stale ? 'opacity-60' : ''}`} aria-labelledby="quote-title" aria-busy={stale || undefined}>
      <h2 id="quote-title" className="text-lg font-bold text-brand-800">
        {t('calculator.resultTitle')}
      </h2>
      <p className="mt-1 text-slate-600">
        {quote.origin} → {quote.destination} · {t(`schemes.${quote.scheme as 'SCHEME_A'}`)}
      </p>

      <p className="mt-5 text-sm font-semibold uppercase tracking-wide text-slate-600">{t('calculator.total')}</p>
      <p className="text-5xl font-extrabold tabular-nums text-brand-700" data-testid="quote-total">
        {money(quote.total)}
      </p>

      <div className="mt-5 flex items-start gap-3 rounded-xl bg-brand-50 p-4">
        <CanalIcon width={28} height={28} className="mt-0.5 shrink-0 text-brand-700" />
        <div>
          <p className="text-sm font-semibold text-slate-600">{t('calculator.canal.label')}</p>
          <p className="text-lg font-bold text-brand-800" data-testid="quote-canal">
            {t(`calculator.canal.${quote.canal}`)}
          </p>
        </div>
      </div>
      {quote.isSeaRoute && (
        <p className="mt-3 flex gap-2 rounded-xl border border-brand-200 bg-white p-3 text-sm text-brand-900">
          <IconShip width={20} height={20} className="mt-0.5 shrink-0" />
          {t('calculator.seaNotice')}
        </p>
      )}

      <dl className="mt-5 divide-y divide-slate-200 border-y border-slate-200">
        <Row label={t('calculator.baseFee')} value={money(quote.baseShippingFee)} />
        {quote.pickupAddon && <Row label={t('calculator.pickupFee')} value={money(quote.pickupAddon.fee)} />}
        {quote.deliveryAddon && <Row label={t('calculator.deliveryFee')} value={money(quote.deliveryAddon.fee)} />}
        {quote.insurance && <Row label={t('calculator.insuranceFee')} value={money(quote.insurance.premium)} />}
        <Row label={tc('labels.total')} value={money(quote.total)} strong />
      </dl>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <div>
          <dt className="text-slate-600">{t('calculator.eta')}</dt>
          <dd className="flex items-center gap-1.5 font-semibold text-slate-900">
            <IconClock width={16} height={16} />
            {quote.eta[locale] || quote.eta.tet}
          </dd>
        </div>
        <div>
          <dt className="text-slate-600">{t('calculator.zone')}</dt>
          <dd className="font-semibold text-slate-900">{quote.zone.replace('ZONE_', '')}</dd>
        </div>
        <div>
          <dt className="text-slate-600">{t('calculator.chargeableWeight')}</dt>
          <dd className="font-semibold text-slate-900">
            {quote.chargeableWeightKg} {t('calculator.kg')}
          </dd>
        </div>
        <div>
          <dt className="text-slate-600">{t('calculator.tier')}</dt>
          <dd className="font-semibold text-slate-900">{t(`calculator.tiers.${quote.tariffTier}`)}</dd>
        </div>
        <div className="col-span-2">
          <dt className="text-slate-600">{t('calculator.volumetric')}</dt>
          <dd className="font-semibold text-slate-900">
            {quote.volumetricWeightKg} {t('calculator.kg')}
          </dd>
        </div>
      </dl>

      {(quote.pickupAddon?.wholesaleApplied || quote.deliveryAddon?.wholesaleApplied) && <p className="mt-4 text-sm text-slate-700">{t('calculator.wholesale')}</p>}

      <p className="mt-5 flex gap-2 text-sm text-slate-600">
        <IconAlert width={18} height={18} className="mt-0.5 shrink-0" />
        {t('calculator.indicative')}
      </p>

      <div className="mt-5 flex flex-wrap gap-3">
        {hasPickup && (
          <Link href="/book" className="btn btn-accent">
            {t('calculator.ctaBook')}
          </Link>
        )}
        <Link href="/prohibited" className="btn btn-outline">
          {t('nav.prohibited')}
        </Link>
      </div>
    </section>
  );
}
