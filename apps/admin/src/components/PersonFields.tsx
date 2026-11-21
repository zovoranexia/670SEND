import { useTranslations } from 'use-intl';
import { LOCALES, LOCALE_LABELS, type Locale } from '@670send/types';
import { pinSchema, tlWhatsAppPhoneSchema } from '@670send/validation';
import { Field } from '@/components/ui';

export interface Person {
  fullName: string;
  phone: string;
  email: string;
  pin: string;
  preferredLang: Locale;
}
export const emptyPerson = (): Person => ({ fullName: '', phone: '', email: '', pin: '', preferredLang: 'tet' });

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Field-by-field problems of a person form (empty object = valid). `emailRequired` for staff, optional for field users. */
export function personProblems(p: Person, emailRequired = false, pinRequired = true): Partial<Record<keyof Person, 'name' | 'phone' | 'email' | 'pin' | 'pin_weak'>> {
  const out: Partial<Record<keyof Person, 'name' | 'phone' | 'email' | 'pin' | 'pin_weak'>> = {};
  if (p.fullName.trim().length < 3) out.fullName = 'name';
  if (!tlWhatsAppPhoneSchema.safeParse(p.phone).success) out.phone = 'phone';
  if ((emailRequired || p.email.trim()) && !EMAIL.test(p.email.trim())) out.email = 'email';
  if (pinRequired || p.pin) {
    const r = pinSchema.safeParse(p.pin);
    if (!r.success) out.pin = /^\d{6}$/.test(p.pin) ? 'pin_weak' : 'pin';
  }
  return out;
}

export function PersonFields({ value, onChange, touched, emailRequired, showPin = true }: { value: Person; onChange: (p: Person) => void; touched: boolean; emailRequired?: boolean; showPin?: boolean }) {
  const t = useTranslations();
  const problems = touched ? personProblems(value, emailRequired, showPin) : {};
  const set = <K extends keyof Person>(k: K, v: Person[K]) => onChange({ ...value, [k]: v });
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <Field label={t('admin.person.fullName')} error={problems.fullName ? t('errors.validation.name') : undefined}>
        {(p) => <input {...p} className="input" value={value.fullName} onChange={(e) => set('fullName', e.target.value)} autoComplete="off" />}
      </Field>
      <Field label={t('admin.person.phone')} hint="+670 7712 3456" error={problems.phone ? t('errors.validation.whatsapp_phone') : undefined}>
        {(p) => <input {...p} className="input" type="tel" inputMode="tel" value={value.phone} onChange={(e) => set('phone', e.target.value)} autoComplete="off" />}
      </Field>
      <Field label={t('admin.person.email')} optional={!emailRequired} error={problems.email ? t('admin.auth.emailInvalid') : undefined}>
        {(p) => <input {...p} className="input" type="email" value={value.email} onChange={(e) => set('email', e.target.value)} autoComplete="off" />}
      </Field>
      {showPin && (
        <Field label={t('admin.person.pin')} hint={t('admin.person.pinHint')} error={problems.pin ? t(problems.pin === 'pin_weak' ? 'errors.validation.pin_weak' : 'errors.validation.pin') : undefined}>
          {(p) => <input {...p} className="input tracking-[0.4em]" inputMode="numeric" maxLength={6} value={value.pin} onChange={(e) => set('pin', e.target.value.replace(/\D/g, ''))} autoComplete="off" />}
        </Field>
      )}
      <Field label={t('admin.person.lang')}>
        {(p) => (
          <select {...p} className="input" value={value.preferredLang} onChange={(e) => set('preferredLang', e.target.value as Locale)}>
            {LOCALES.map((l) => (
              <option key={l} value={l}>
                {LOCALE_LABELS[l].native}
              </option>
            ))}
          </select>
        )}
      </Field>
    </div>
  );
}

/** Normalised phone for the API (`+67077123456`). Only call when `personProblems` is empty. */
export const apiPhone = (raw: string) => tlWhatsAppPhoneSchema.parse(raw);
