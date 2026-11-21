import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { Await, Badge, ErrorNote, Field, Modal, Notice, Section } from '@/components/ui';
import { useAction, useResource } from '@/hooks';
import { useLocaleState } from '@/i18n';
import { contentApi } from '@/lib/endpoints';
import { formatDiliDateTime } from '@/lib/format';
import type { SettingRow } from '@/lib/types';

const int = (v: string) => (/^\d+$/.test(v.trim()) ? Number(v) : NaN);

/** The five settings that may be edited, each with its own typed form (the API validates again and refuses any other key). */
function EditDialog({ row, onClose, onSaved }: { row: SettingRow; onClose: () => void; onSaved: () => void }) {
  const t = useTranslations();
  const action = useAction();
  const v = row.value as Record<string, unknown> | string | number;
  const [a, setA] = useState<Record<string, string>>((): Record<string, string> => {
    switch (row.key) {
      case 'bus_capacity':
        return { maxSmallParcels: String((v as Record<string, unknown>).maxSmallParcels ?? ''), maxMasterBags: String((v as Record<string, unknown>).maxMasterBags ?? '') };
      case 'otp':
        return { ttlDays: String((v as Record<string, unknown>).ttlDays ?? ''), maxAttempts: String((v as Record<string, unknown>).maxAttempts ?? ''), lockMinutes: String((v as Record<string, unknown>).lockMinutes ?? '') };
      default:
        return { value: String(v) };
    }
  });
  const set = (k: string, val: string) => setA((s) => ({ ...s, [k]: val }));
  const x = a;

  const build = (): { ok: boolean; value?: unknown } => {
    switch (row.key) {
      case 'bus_capacity': {
        const p = int(x.maxSmallParcels!);
        const b = int(x.maxMasterBags!);
        return { ok: p >= 1 && p <= 100 && b >= 0 && b <= 10, value: { maxSmallParcels: p, maxMasterBags: b } };
      }
      case 'otp': {
        const d = int(x.ttlDays!);
        const m = int(x.maxAttempts!);
        const l = int(x.lockMinutes!);
        return { ok: d >= 1 && d <= 60 && m >= 3 && m <= 10 && l >= 1 && l <= 1440, value: { length: 6, ttlDays: d, maxAttempts: m, lockMinutes: l } };
      }
      case 'claim_cs_approval_limit_usd':
        return { ok: /^\d{1,5}([.]\d{1,2})?$/.test(x.value!.trim()), value: x.value!.trim() };
      case 'claim_handover_window_minutes': {
        const n = int(x.value!);
        return { ok: n >= 5 && n <= 1440, value: n };
      }
      default:
        return { ok: x.value === 'COMMISSION' || x.value === 'DEPOSIT', value: x.value };
    }
  };
  const built = build();

  const num = (k: string, label: string) => (
    <Field key={k} label={label} error={Number.isNaN(int(x[k]!)) ? t('web.form.number') : undefined}>
      {(p) => <input {...p} className="input" inputMode="numeric" value={x[k]} onChange={(e) => set(k, e.target.value)} />}
    </Field>
  );

  return (
    <Modal title={t(`admin.settings.keys.${row.key}` as 'admin.settings.keys.bus_capacity')} onClose={onClose}>
      {row.description && <p className="text-sm text-slate-600">{row.description}</p>}
      {row.key === 'bus_capacity' && (
        <>
          {num('maxSmallParcels', t('admin.settings.maxSmallParcels'))}
          {num('maxMasterBags', t('admin.settings.maxMasterBags'))}
          <Notice tone="info">{t('admin.settings.busNote')}</Notice>
        </>
      )}
      {row.key === 'otp' && (
        <>
          {num('ttlDays', t('admin.settings.otpTtl'))}
          {num('maxAttempts', t('admin.settings.otpAttempts'))}
          {num('lockMinutes', t('admin.settings.otpLock'))}
          <Notice tone="warn">{t('admin.settings.otpNote')}</Notice>
        </>
      )}
      {row.key === 'claim_cs_approval_limit_usd' && (
        <Field label={t('admin.settings.csLimit')} hint={t('admin.settings.csLimitHint')} error={built.ok ? undefined : t('web.form.number')}>
          {(p) => <input {...p} className="input" inputMode="decimal" value={x.value} onChange={(e) => set('value', e.target.value)} />}
        </Field>
      )}
      {row.key === 'claim_handover_window_minutes' && num('value', t('admin.settings.handoverWindow'))}
      {row.key === 'dest_commission_wallet' && (
        <Field label={t('admin.settings.commissionWallet')} hint={t('admin.settings.commissionWalletHint')}>
          {(p) => (
            <select {...p} className="input" value={x.value} onChange={(e) => set('value', e.target.value)}>
              <option value="COMMISSION">{t('admin.finance.walletType.COMMISSION')}</option>
              <option value="DEPOSIT">{t('admin.finance.walletType.DEPOSIT')}</option>
            </select>
          )}
        </Field>
      )}
      {action.error && <ErrorNote>{action.error}</ErrorNote>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-outline" onClick={onClose}>
          {t('common.actions.cancel')}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={action.busy || !built.ok}
          onClick={async () => {
            if (await action.run(() => contentApi.saveSetting(row.key, built.value))) onSaved();
          }}
        >
          {t('common.actions.save')}
        </button>
      </div>
    </Modal>
  );
}

/** System settings: five are editable (and audited); the rest are shown read-only so nobody wonders what the platform is set to. */
export function SettingsTab() {
  const t = useTranslations();
  const { locale } = useLocaleState();
  const res = useResource((s) => contentApi.settings(s), []);
  const [edit, setEdit] = useState<SettingRow | null>(null);
  return (
    <Section title={t('admin.settings.title')}>
      <Notice tone="info">{t('admin.settings.intro')}</Notice>
      <Await res={res}>
        {(rows) => (
          <ul className="grid gap-3 lg:grid-cols-2">
            {rows.map((r) => (
              <li key={r.key} className="card space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="font-mono text-sm font-bold">{r.key}</h3>
                    {r.description && <p className="text-sm text-slate-600">{r.description}</p>}
                  </div>
                  {r.editable ? (
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => setEdit(r)}>
                      {t('common.actions.edit')}
                    </button>
                  ) : (
                    <Badge tone="slate">{t('admin.settings.readOnly')}</Badge>
                  )}
                </div>
                <pre className="overflow-x-auto rounded bg-slate-50 p-2 text-xs">{JSON.stringify(r.value, null, 2)}</pre>
                <p className="text-xs text-slate-600">{formatDiliDateTime(r.updatedAt, locale)}</p>
              </li>
            ))}
          </ul>
        )}
      </Await>
      {edit && (
        <EditDialog
          row={edit}
          onClose={() => setEdit(null)}
          onSaved={() => {
            setEdit(null);
            res.reload();
          }}
        />
      )}
    </Section>
  );
}
