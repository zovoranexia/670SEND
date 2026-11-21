import { useTranslations } from 'use-intl';
import { HUBS, MUNICIPALITIES, type MunicipalityDef } from '@670send/types';
import { Field } from '@/components/ui';

/** Municipalities a hub serves (static reference data: the API has no hub endpoint). */
export const municipalitiesOf = (hubCode: string): MunicipalityDef[] => MUNICIPALITIES.filter((m) => m.hub === hubCode);

/** Pasted waybills arrive separated by lines, spaces or commas. */
export const parseWaybills = (text: string): string[] => [...new Set(text.split(/[\s,;]+/).map((w) => w.trim().toUpperCase()).filter(Boolean))];

export function HubSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const t = useTranslations();
  return (
    <Field label={t('admin.hubs.hub')}>
      {(p) => (
        <select {...p} className="input w-64" value={value} onChange={(e) => onChange(e.target.value)}>
          {HUBS.map((h) => (
            <option key={h.code} value={h.code}>
              {h.name}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

/** Translated reason for one failed item of a batch (`errors.<code>`), with a generic fallback. */
export function useReasonText() {
  const t = useTranslations();
  return (code: string) => (t.has(`errors.${code}` as 'errors.generic') ? t(`errors.${code}` as 'errors.generic') : t('errors.generic'));
}
