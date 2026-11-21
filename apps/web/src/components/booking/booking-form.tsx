'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { LOCALES, LOCALE_LABELS, type Locale } from '@670send/types';
import { IconCheck, IconPin } from '@/components/icons';
import { Link } from '@/i18n/navigation';
import { ApiRequestError, publicApi, type BookingResult } from '@/lib/api';
import { buildBookingRequest, emptyBooking, isInsideTL, type BookingError, type BookingField, type BookingForm } from '@/lib/booking';
import { formatCoord } from '@/lib/format';
import { MUNICIPALITY_OPTIONS } from '@/lib/municipalities';
import { PinMap } from './pin-map-loader';

const FIELD_FROM_API: Record<string, BookingField> = { senderName: 'name', senderPhone: 'phone', pickupAddress: 'address', parcelCount: 'count', estimatedWeightKg: 'weight', notes: 'notes' };

function Field({ id, label, hint, error, optional, children }: { id: string; label: string; hint?: string; error?: string; optional?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="field-label">
        {label}
        {optional && <span className="ml-2 text-sm font-normal text-slate-600">({optional})</span>}
      </label>
      {children}
      {error ? (
        <p id={`${id}-err`} className="field-error" role="alert">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-hint`} className="field-hint">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

export function BookingFormView() {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const uid = useId();
  const id = (n: string) => `${uid}-${n}`;

  const [form, setForm] = useState<BookingForm>(() => emptyBooking(locale));
  const [touched, setTouched] = useState<Set<BookingField>>(new Set());
  const [serverErrors, setServerErrors] = useState<Partial<Record<BookingField, string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState<BookingResult | null>(null);
  const [geo, setGeo] = useState<'idle' | 'locating' | 'denied'>('idle');
  const honeypot = useRef<HTMLInputElement>(null);

  const built = buildBookingRequest(form);
  const errors = built.ok ? {} : built.errors;

  const text = (e: BookingError): string => {
    switch (e.key) {
      case 'name':
        return t('errors.validation.name');
      case 'phone':
        return t('errors.validation.whatsapp_phone');
      case 'outsideTL':
        return t('web.booking.outsideTL');
      case 'minChars':
        return t('web.form.minChars', { min: e.params?.min ?? 0 });
      case 'max':
        return t('web.form.max', { max: e.params?.max ?? 0 });
      case 'number':
        return t('web.form.number');
      case 'positive':
        return t('web.form.positive');
      default:
        return t('web.form.required');
    }
  };
  const err = (f: BookingField): string | undefined => (touched.has(f) && errors[f] ? text(errors[f]!) : serverErrors[f]);
  const touch = (f: BookingField) => setTouched((s) => new Set(s).add(f));
  const set = <K extends keyof BookingForm>(k: K, v: BookingForm[K], f?: BookingField) => {
    setForm((s) => ({ ...s, [k]: v }));
    if (f) setServerErrors((s) => ({ ...s, [f]: undefined }));
  };
  const a11y = (f: BookingField, hint?: boolean) => ({ 'aria-invalid': err(f) ? true : undefined, 'aria-describedby': err(f) ? `${id(f)}-err` : hint ? `${id(f)}-hint` : undefined });

  function locate() {
    if (!('geolocation' in navigator)) return setGeo('denied');
    setGeo('locating');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        if (!isInsideTL(lat, lng)) {
          setGeo('idle');
          setTouched((s) => new Set(s).add('pin'));
        }
        set('pin', { lat, lng });
        setGeo('idle');
      },
      () => setGeo('denied'),
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 },
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!built.ok) {
      setTouched(new Set<BookingField>(['name', 'phone', 'count', 'weight', 'address', 'notes', 'pin']));
      const first = (['name', 'phone', 'address', 'count', 'weight', 'notes'] as const).find((f) => errors[f]);
      if (first) document.getElementById(id(first))?.focus();
      return;
    }
    // Bots fill every field: pretend it worked, send nothing.
    if (honeypot.current?.value) return setDone({ batchCode: '—', status: 'REQUESTED', parcelCount: built.request.parcelCount, phone: '' });

    setSubmitting(true);
    try {
      setDone(await publicApi.createBooking(built.request, locale));
    } catch (error) {
      const ex = error as ApiRequestError;
      if (ex.details?.length) {
        const next: Partial<Record<BookingField, string>> = {};
        for (const d of ex.details) {
          const f = d.path ? FIELD_FROM_API[d.path] : undefined;
          if (f && d.message) next[f] = d.message;
        }
        setServerErrors(next);
      }
      setFormError(ex.isNetwork ? t('web.booking.errorNetwork') : ex.message || t('web.booking.errorGeneric'));
    } finally {
      setSubmitting(false);
    }
  }

  /* --------------------------------------------------------------------------- success */
  if (done) {
    return (
      <section className="card mx-auto max-w-2xl text-center" aria-labelledby="done-title" role="status">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-brand-700 text-white">
          <IconCheck width={30} height={30} strokeWidth={3} />
        </span>
        <h2 id="done-title" className="mt-4 text-2xl font-bold text-brand-800">
          {t('web.booking.successTitle')}
        </h2>
        <p className="mt-2 text-lg text-slate-700">{t('web.booking.successBody')}</p>
        <p className="mt-6 text-sm font-semibold uppercase tracking-wide text-slate-600">{t('web.booking.reference')}</p>
        <p className="mt-1 font-mono text-3xl font-extrabold tracking-wider text-brand-700" data-testid="booking-ref">
          {done.batchCode}
        </p>
        <p className="mt-2 text-base text-slate-600">{t('web.booking.keepReference')}</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setDone(null);
              setForm(emptyBooking(locale));
              setTouched(new Set());
            }}
          >
            {t('web.booking.newRequest')}
          </button>
          <Link href="/calculator" className="btn btn-outline">
            {t('web.booking.seePrice')}
          </Link>
        </div>
      </section>
    );
  }

  /* ---------------------------------------------------------------------------- form */
  return (
    <form onSubmit={onSubmit} noValidate className="mx-auto grid max-w-5xl gap-8">
      {formError && (
        <p className="rounded-xl border border-red-300 bg-red-50 p-4 text-base font-medium text-red-900" role="alert">
          {formError}
        </p>
      )}

      <fieldset className="card">
        <legend className="px-1 text-lg font-bold text-brand-800">{t('web.booking.detailsTitle')}</legend>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <Field id={id('name')} label={t('web.booking.name')} error={err('name')}>
            <input id={id('name')} className="input" type="text" autoComplete="name" value={form.name} onChange={(e) => set('name', e.target.value, 'name')} onBlur={() => touch('name')} {...a11y('name')} />
          </Field>
          <Field id={id('phone')} label={t('web.booking.phone')} hint={t('web.booking.phoneHint')} error={err('phone')}>
            <input id={id('phone')} className="input" type="tel" inputMode="tel" autoComplete="tel" placeholder="+670 7712 3456" value={form.phone} onChange={(e) => set('phone', e.target.value, 'phone')} onBlur={() => touch('phone')} {...a11y('phone', true)} />
          </Field>
          <Field id={id('lang')} label={t('web.booking.waNotifyLang')}>
            <select id={id('lang')} className="input" value={form.lang} onChange={(e) => set('lang', e.target.value as Locale)}>
              {LOCALES.map((l) => (
                <option key={l} value={l} lang={l}>
                  {LOCALE_LABELS[l].native}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </fieldset>

      <fieldset className="card">
        <legend className="px-1 text-lg font-bold text-brand-800">{t('web.booking.parcelsTitle')}</legend>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <Field id={id('scheme')} label={t('web.booking.service')} hint={t(`web.home.schemeDesc.${form.scheme}`)}>
            <select id={id('scheme')} className="input" value={form.scheme} onChange={(e) => set('scheme', e.target.value as BookingForm['scheme'])} aria-describedby={`${id('scheme')}-hint`}>
              <option value="SCHEME_B">{t('web.schemes.SCHEME_B')}</option>
              <option value="SCHEME_D">{t('web.schemes.SCHEME_D')}</option>
            </select>
          </Field>
          <Field id={id('dest')} label={t('web.booking.destination')} optional={t('common.labels.optional')}>
            <select id={id('dest')} className="input" value={form.dest} onChange={(e) => set('dest', e.target.value)}>
              <option value="">{t('web.booking.destinationAny')}</option>
              {MUNICIPALITY_OPTIONS.map((m) => (
                <option key={m.code} value={m.code}>
                  {m.name}
                </option>
              ))}
            </select>
          </Field>
          <Field id={id('count')} label={t('web.booking.parcelCount')} hint={t('web.booking.wholesaleHint')} error={err('count')}>
            <input id={id('count')} className="input" type="text" inputMode="numeric" autoComplete="off" value={form.count} onChange={(e) => set('count', e.target.value, 'count')} onBlur={() => touch('count')} {...a11y('count', true)} />
          </Field>
          <Field id={id('weight')} label={t('web.booking.weight')} optional={t('common.labels.optional')} error={err('weight')}>
            <input id={id('weight')} className="input" type="text" inputMode="decimal" autoComplete="off" value={form.weight} onChange={(e) => set('weight', e.target.value, 'weight')} onBlur={() => touch('weight')} {...a11y('weight')} />
          </Field>
        </div>
      </fieldset>

      <fieldset className="card">
        <legend className="px-1 text-lg font-bold text-brand-800">{t('web.booking.locationTitle')}</legend>
        <div className="mt-3 grid gap-4">
          <Field id={id('address')} label={t('web.booking.address')} hint={t('web.booking.addressHint')} error={err('address')}>
            <input id={id('address')} className="input" type="text" autoComplete="street-address" value={form.address} onChange={(e) => set('address', e.target.value, 'address')} onBlur={() => touch('address')} {...a11y('address', true)} />
          </Field>

          <div>
            <p className="field-label">{t('web.booking.pickAddress')}</p>
            <p id={id('map-hint')} className="field-hint mb-3">
              {t('web.a11y.mapHint')}
            </p>
            <PinMap value={form.pin} onChange={(pin) => set('pin', pin, 'pin')} describedBy={id('map-hint')} />
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button type="button" className="btn btn-outline !min-h-10 !px-4 !py-1.5 text-sm" onClick={locate} disabled={geo === 'locating'}>
                <IconPin width={18} height={18} />
                {geo === 'locating' ? t('web.booking.locating') : t('web.booking.useLocation')}
              </button>
              {form.pin && (
                <button type="button" className="btn !min-h-10 !px-4 !py-1.5 text-sm text-slate-700 underline hover:bg-slate-100" onClick={() => set('pin', null)}>
                  {t('web.booking.clearPin')}
                </button>
              )}
              <p className="text-sm text-slate-700" aria-live="polite">
                {form.pin ? t('web.booking.pinSet', { lat: formatCoord(form.pin.lat), lng: formatCoord(form.pin.lng) }) : t('web.booking.noPin')}
              </p>
            </div>
            {geo === 'denied' && (
              <p className="field-error" role="alert">
                {t('web.booking.locationDenied')}
              </p>
            )}
            {err('pin') && (
              <p className="field-error" role="alert">
                {err('pin')}
              </p>
            )}
          </div>

          <Field id={id('notes')} label={t('web.booking.notes')} optional={t('common.labels.optional')} error={err('notes')}>
            <textarea id={id('notes')} className="input min-h-24" rows={3} value={form.notes} onChange={(e) => set('notes', e.target.value, 'notes')} onBlur={() => touch('notes')} {...a11y('notes')} />
          </Field>
        </div>
      </fieldset>

      {/* honeypot: invisible to people and assistive tech, irresistible to form-filling bots */}
      <div className="absolute -left-[9999px] h-0 w-0 overflow-hidden" aria-hidden="true">
        <label>
          Company
          <input ref={honeypot} type="text" name="company" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      <div>
        <p className="mb-4 max-w-2xl text-sm text-slate-700">{t('web.booking.consent')}</p>
        <button type="submit" className="btn btn-accent w-full sm:w-auto" disabled={submitting}>
          {submitting ? t('web.booking.submitting') : t('web.booking.submit')}
        </button>
      </div>
    </form>
  );
}
