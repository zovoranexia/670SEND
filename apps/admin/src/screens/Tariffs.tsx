import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { LOCALES, LOCALE_LABELS, type Locale } from '@670send/types';
import { Await, Badge, DataTable, ErrorNote, Field, Modal, Notice, Page, Section } from '@/components/ui';
import { useAction, useCan, useResource } from '@/hooks';
import { contentApi } from '@/lib/endpoints';
import { toAmount, usd } from '@/lib/format';
import type { AddonDto, MunicipalityTariff, ZoneDto } from '@/lib/types';

const RATES = ['docRate', 'smallBase2kg', 'extraPerKg', 'cargoBase10kg', 'cargoExtraPerKg'] as const;
type Rate = (typeof RATES)[number];

/** A money field edited as text ("12,5" is fine); empty or invalid is flagged, never silently turned into 0. */
function MoneyField({ label, value, onChange, error }: { label: string; value: string; onChange: (v: string) => void; error?: boolean }) {
  const t = useTranslations();
  return (
    <Field label={label} error={error ? t('web.form.positive') : undefined}>
      {(p) => <input {...p} className="input" inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} />}
    </Field>
  );
}

function ZoneModal({ zone, onClose, onSaved }: { zone: ZoneDto; onClose: () => void; onSaved: () => void }) {
  const t = useTranslations();
  const action = useAction();
  const [rates, setRates] = useState<Record<Rate, string>>(() => Object.fromEntries(RATES.map((r) => [r, Number(zone[r]).toFixed(2)])) as Record<Rate, string>);
  const [names, setNames] = useState<Record<Locale, string>>({ ...zone.names });
  const [eta, setEta] = useState<Record<Locale, string>>({ ...zone.eta });
  const bad = RATES.filter((r) => toAmount(rates[r]) === null);
  const textOk = LOCALES.every((l) => names[l].trim().length >= 2 && eta[l].trim().length >= 2);

  return (
    <Modal title={`${t('admin.tariffs.zone')} ${zone.code.replace('ZONE_', '')}`} onClose={onClose} wide>
      <Notice tone="info">{t('admin.tariffs.futureOnly')}</Notice>
      <h3 className="h2">{t('admin.tariffs.rates')}</h3>
      <div className="grid gap-3 md:grid-cols-3">
        {RATES.map((r) => (
          <MoneyField key={r} label={t(`admin.tariffs.rate.${r}`)} value={rates[r]} error={bad.includes(r)} onChange={(v) => setRates((s) => ({ ...s, [r]: v }))} />
        ))}
      </div>
      <h3 className="h2">{t('admin.tariffs.localized')}</h3>
      <div className="grid gap-3 md:grid-cols-2">
        {LOCALES.map((l) => (
          <fieldset key={l} className="space-y-2 rounded-lg border border-slate-200 p-3">
            <legend className="px-1 text-sm font-bold" lang={l}>
              {LOCALE_LABELS[l].native}
            </legend>
            <Field label={t('admin.tariffs.zoneName')}>{(p) => <input {...p} lang={l} className="input" value={names[l]} onChange={(e) => setNames((s) => ({ ...s, [l]: e.target.value }))} maxLength={60} />}</Field>
            <Field label={t('admin.tariffs.eta')}>{(p) => <input {...p} lang={l} className="input" value={eta[l]} onChange={(e) => setEta((s) => ({ ...s, [l]: e.target.value }))} maxLength={60} />}</Field>
          </fieldset>
        ))}
      </div>
      {action.error && <ErrorNote>{action.error}</ErrorNote>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-outline" onClick={onClose}>
          {t('common.actions.cancel')}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={action.busy || bad.length > 0 || !textOk}
          onClick={async () => {
            const body = { ...(Object.fromEntries(RATES.map((r) => [r, toAmount(rates[r])!])) as Record<Rate, string>), names, eta };
            if (await action.run(() => contentApi.saveZone(zone.code, body))) onSaved();
          }}
        >
          {t('common.actions.save')}
        </button>
      </div>
    </Modal>
  );
}

function AddonModal({ addon, onClose, onSaved }: { addon: AddonDto; onClose: () => void; onSaved: () => void }) {
  const t = useTranslations();
  const action = useAction();
  const [fee, setFee] = useState(Number(addon.fee).toFixed(2));
  const [split, setSplit] = useState(Number(addon.courierSplitPct).toFixed(2));
  const [minParcels, setMinParcels] = useState(String(addon.wholesaleMinParcels));
  const [free, setFree] = useState(addon.wholesaleFreePickup);
  const [active, setActive] = useState(addon.isActive);
  const splitN = Number(split.replace(',', '.'));
  const splitOk = /^\d{1,3}([.,]\d{1,2})?$/.test(split.trim()) && splitN >= 0 && splitN <= 100;
  const minN = Number(minParcels);
  const minOk = Number.isInteger(minN) && minN >= 2 && minN <= 100;
  const feeOk = toAmount(fee) !== null;
  return (
    <Modal title={t(`admin.tariffs.addon.${addon.serviceType}`)} onClose={onClose}>
      <Notice tone="info">{t('admin.tariffs.futureOnly')}</Notice>
      <MoneyField label={t('admin.tariffs.addonFee')} value={fee} onChange={setFee} error={!feeOk} />
      <Field label={t('admin.tariffs.courierSplit')} hint={t('admin.tariffs.platformSplit', { pct: splitOk ? (100 - splitN).toFixed(2) : '—' })} error={splitOk ? undefined : t('web.form.number')}>
        {(p) => <input {...p} className="input" inputMode="decimal" value={split} onChange={(e) => setSplit(e.target.value)} />}
      </Field>
      <Field label={t('admin.tariffs.wholesaleMin')} error={minOk ? undefined : t('web.form.number')}>
        {(p) => <input {...p} className="input" inputMode="numeric" value={minParcels} onChange={(e) => setMinParcels(e.target.value)} />}
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={free} onChange={(e) => setFree(e.target.checked)} />
        {t('admin.tariffs.wholesaleFree')}
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
        {t('admin.tariffs.addonActive')}
      </label>
      {action.error && <ErrorNote>{action.error}</ErrorNote>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-outline" onClick={onClose}>
          {t('common.actions.cancel')}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={action.busy || !feeOk || !splitOk || !minOk}
          onClick={async () => {
            if (await action.run(() => contentApi.saveAddon(addon.serviceType, { fee: toAmount(fee)!, courierSplitPct: splitN.toFixed(2), wholesaleMinParcels: minN, wholesaleFreePickup: free, isActive: active }))) onSaved();
          }}
        >
          {t('common.actions.save')}
        </button>
      </div>
    </Modal>
  );
}

function SurchargeRow({ m, editable, onSaved }: { m: MunicipalityTariff; editable: boolean; onSaved: () => void }) {
  const t = useTranslations();
  const [v, setV] = useState(Number(m.surcharge).toFixed(2));
  const action = useAction();
  const n = Number(v.replace(',', '.'));
  const valid = /^\d{1,10}([.,]\d{1,4})?$/.test(v.trim());
  const dirty = valid && n !== Number(m.surcharge);
  return (
    <tr>
      <td className="font-semibold">{m.name}</td>
      <td>{t(`web.corridors.${m.corridor}` as 'web.corridors.EAST')}</td>
      <td>{m.zone ? m.zone.replace('ZONE_', '') : '—'}</td>
      <td>{m.isSeaRoute ? <Badge tone="brand">{t('admin.tariffs.sea')}</Badge> : '—'}</td>
      <td>
        {editable && m.zone ? (
          <div className="flex items-center gap-2">
            <input aria-label={`${m.name} ${t('admin.tariffs.surcharge')}`} className="input w-28" inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} aria-invalid={!valid} />
            <button
              type="button"
              className="btn btn-outline btn-sm"
              disabled={!dirty || action.busy}
              onClick={async () => {
                if (await action.run(() => contentApi.saveSurcharge(m.code, n.toFixed(2)))) onSaved();
              }}
            >
              {t('common.actions.save')}
            </button>
            {action.error && <span className="text-xs text-red-700">{action.error}</span>}
          </div>
        ) : (
          usd(m.surcharge)
        )}
      </td>
    </tr>
  );
}

/** The localized tariff matrix: zone rates and their 4-language names/ETAs, add-ons, municipality surcharges. */
export function TariffsScreen() {
  const t = useTranslations();
  const can = useCan();
  const res = useResource((s) => contentApi.tariffs(s), []);
  const [zone, setZone] = useState<ZoneDto | null>(null);
  const [addon, setAddon] = useState<AddonDto | null>(null);
  const manage = can('tariffs:manage');

  return (
    <Page title={t('admin.nav.tariffs')} subtitle={t('admin.tariffs.subtitle')}>
      <Await res={res}>
        {(d) => (
          <div className="space-y-8">
            <Section title={t('admin.tariffs.zonesTitle')}>
              <DataTable
                caption={t('admin.tariffs.zonesTitle')}
                head={
                  <>
                    <th>{t('admin.tariffs.zone')}</th>
                    {RATES.map((r) => (
                      <th key={r}>{t(`admin.tariffs.rate.${r}`)}</th>
                    ))}
                    <th>{t('admin.tariffs.names')}</th>
                    {manage && <th />}
                  </>
                }
              >
                {d.zones.map((z) => (
                  <tr key={z.code}>
                    <td className="font-bold">{z.code.replace('ZONE_', '')}</td>
                    {RATES.map((r) => (
                      <td key={r}>{usd(z[r])}</td>
                    ))}
                    <td className="max-w-72 text-xs">
                      {LOCALES.map((l) => (
                        <p key={l} lang={l}>
                          <span className="font-bold">{LOCALE_LABELS[l].short}</span> {z.names[l]} · {z.eta[l]}
                        </p>
                      ))}
                    </td>
                    {manage && (
                      <td>
                        <button type="button" className="btn btn-outline btn-sm" onClick={() => setZone(z)}>
                          {t('common.actions.edit')}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </DataTable>
            </Section>

            <Section title={t('admin.tariffs.addonsTitle')}>
              <DataTable
                caption={t('admin.tariffs.addonsTitle')}
                head={
                  <>
                    <th>{t('admin.tariffs.service')}</th>
                    <th>{t('admin.tariffs.addonFee')}</th>
                    <th>{t('admin.tariffs.split')}</th>
                    <th>{t('admin.tariffs.wholesale')}</th>
                    <th>{t('common.labels.status')}</th>
                    {manage && <th />}
                  </>
                }
              >
                {d.addons.map((a) => (
                  <tr key={a.serviceType}>
                    <td className="font-semibold">{t(`admin.tariffs.addon.${a.serviceType}`)}</td>
                    <td>{usd(a.fee)}</td>
                    <td>
                      {Number(a.courierSplitPct)}% / {Number(a.platformSplitPct)}%
                    </td>
                    <td>{t('admin.tariffs.wholesaleCell', { min: a.wholesaleMinParcels, free: a.wholesaleFreePickup ? t('common.labels.yes') : t('common.labels.no') })}</td>
                    <td>{a.isActive ? <Badge tone="green">{t('admin.state.ACTIVE')}</Badge> : <Badge tone="slate">{t('admin.partners.inactive')}</Badge>}</td>
                    {manage && (
                      <td>
                        <button type="button" className="btn btn-outline btn-sm" onClick={() => setAddon(a)}>
                          {t('common.actions.edit')}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </DataTable>
            </Section>

            <Section title={t('admin.tariffs.municipalitiesTitle')}>
              <p className="text-sm text-slate-600">{t('admin.tariffs.surchargeHint')}</p>
              <DataTable
                caption={t('admin.tariffs.municipalitiesTitle')}
                head={
                  <>
                    <th>{t('admin.partners.municipality')}</th>
                    <th>{t('admin.dashboard.corridor')}</th>
                    <th>{t('admin.tariffs.zone')}</th>
                    <th>{t('admin.tariffs.route')}</th>
                    <th>{t('admin.tariffs.surcharge')}</th>
                  </>
                }
              >
                {d.municipalities.map((m) => (
                  <SurchargeRow key={`${m.code}-${m.surcharge}`} m={m} editable={manage} onSaved={res.reload} />
                ))}
              </DataTable>
            </Section>
          </div>
        )}
      </Await>
      {zone && (
        <ZoneModal
          zone={zone}
          onClose={() => setZone(null)}
          onSaved={() => {
            setZone(null);
            res.reload();
          }}
        />
      )}
      {addon && (
        <AddonModal
          addon={addon}
          onClose={() => setAddon(null)}
          onSaved={() => {
            setAddon(null);
            res.reload();
          }}
        />
      )}
    </Page>
  );
}
