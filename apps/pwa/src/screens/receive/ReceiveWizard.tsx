import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useTranslations } from 'use-intl';
import { LOCALES, LOCALE_LABELS, MUNICIPALITIES, ITEM_CATEGORIES, type Locale } from '@670send/types';
import { PROHIBITED_CHECKLIST_KEYS, normalizeTlPhone } from '@670send/validation';
import { Check, SelectInput, TextInput, UnitInput } from '@/components/forms';
import { IconBus, IconShip, IconTruck } from '@/components/icons';
import { PhotoField } from '@/components/PhotoField';
import { PrintActions } from '@/components/PrintActions';
import { ErrorNote, Empty, Loading, Notice, Page } from '@/components/ui';
import { useErrorText, useFieldErrorText, useResource } from '@/hooks';
import { useLocaleState } from '@/i18n';
import { api, ApiError } from '@/lib/api';
import { attemptKey, clearAttempt, hasPendingAttempt } from '@/lib/idempotency';
import { buildIntakeBody, buildQuoteRequest, clearDraft, emptyDraft, hasDoorDelivery, isPristine, loadDraft, pinValid, saveDraft, schemesFor, STEPS, validateStep, type Draft, type Step } from '@/lib/intake';
import { receiptLang, usePrintLang } from '@/lib/prefs';
import { useSession } from '@/lib/session';
import type { FieldProfile, Quote, Scheme, Shipment } from '@/lib/types';
import { useProfile } from '@/profile';

type PartyProfile = Extract<FieldProfile, { kind: 'AGENT' | 'COURIER' }>;
const SCOPE = 'intake';

/** The 5-step drop-off (kiosk) / on-site collection (courier) wizard. */
export function ReceiveScreen() {
  const { user } = useSession();
  const { profile, loading } = useProfile();
  const [params] = useSearchParams();
  const t = useTranslations('pwa.wizard');
  if (!user || loading) return <Loading />;
  if (!profile || (profile.kind !== 'AGENT' && profile.kind !== 'COURIER')) return <Page title={t('title')}><Empty>{t('noKiosk')}</Empty></Page>;
  return <Wizard key={user.id} userId={user.id} profile={profile} bookingId={params.get('booking') ?? ''} />;
}

function Wizard({ userId, profile, bookingId }: { userId: string; profile: PartyProfile; bookingId: string }) {
  const t = useTranslations();
  const { locale } = useLocaleState();
  const errorText = useErrorText();
  const fieldText = useFieldErrorText();
  const printLang = usePrintLang();
  const originCode = profile.municipality.code;
  const schemes = schemesFor(profile.kind);

  const [draft, setDraft] = useState<Draft>(() => loadDraft(userId) ?? emptyDraft({ scheme: schemes[0]!, lang: locale }));
  const restored = useRef(!isPristine(draft));
  const [attempted, setAttempted] = useState(false);
  const [pin, setPin] = useState('');
  const [pinTouched, setPinTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ambiguous, setAmbiguous] = useState(() => hasPendingAttempt(SCOPE));
  const [done, setDone] = useState<Shipment | null>(null);
  const [showRestored, setShowRestored] = useState(restored.current);
  const heading = useRef<HTMLHeadingElement>(null);

  const up = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));
  const upSender = (p: Partial<Draft['sender']>) => setDraft((d) => ({ ...d, sender: { ...d.sender, ...p } }));
  const upRecipient = (p: Partial<Draft['recipient']>) => setDraft((d) => ({ ...d, recipient: { ...d.recipient, ...p } }));
  const upItem = (p: Partial<Draft['item']>) => setDraft((d) => ({ ...d, item: { ...d.item, ...p } }));
  const upParcel = (p: Partial<Draft['parcel']>) => setDraft((d) => ({ ...d, parcel: { ...d.parcel, ...p } }));

  // Keep the work in progress; an untouched form is not worth storing (and "start over" leaves nothing behind).
  useEffect(() => {
    if (done) return;
    if (isPristine(draft)) clearDraft(userId);
    else saveDraft(userId, draft);
  }, [draft, done, userId]);

  /* ------------------------------------------------------- courier: prefill from the assigned pick-up booking */
  useEffect(() => {
    if (!bookingId || draft.pickupBookingId === bookingId) return;
    const ctl = new AbortController();
    api
      .courierJobs(ctl.signal)
      .then((jobs) => {
        const b = jobs.pickups.find((p) => p.id === bookingId);
        if (!b) return;
        setDraft((d) => ({
          ...d,
          pickupBookingId: b.id,
          scheme: b.scheme,
          sender: { ...d.sender, name: d.sender.name || b.senderName, phone: d.sender.phone || b.senderPhone, address: d.sender.address || b.pickupAddress },
        }));
      })
      .catch(() => undefined);
    return () => ctl.abort();
  }, [bookingId, draft.pickupBookingId]);

  /* -------------------------------------------------------------------------- destination kiosks (step 1) */
  const kiosks = useResource((signal) => (draft.destCode ? api.kiosks(draft.destCode, signal) : Promise.resolve([])), [draft.destCode]);
  const kioskCount = draft.destCode ? (kiosks.data ? kiosks.data.length : null) : null;
  useEffect(() => {
    if (kiosks.data && draft.destAgentId && !kiosks.data.some((k) => k.id === draft.destAgentId)) up({ destAgentId: '' });
  }, [kiosks.data, draft.destAgentId]);
  // Outside Díli the only destination is Díli.
  useEffect(() => {
    if (originCode !== 'DIL' && draft.destCode !== 'DIL') up({ destCode: 'DIL' });
  }, [originCode, draft.destCode]);

  const ctx = { kioskCount };
  const errors = attempted ? validateStep(draft.step, draft, ctx) : {};
  const err = (k: string) => fieldText(errors[k]);

  function go(step: Step) {
    setAttempted(false);
    up({ step });
    requestAnimationFrame(() => {
      window.scrollTo({ top: 0 });
      heading.current?.focus();
    });
  }
  function next() {
    if (draft.step < 4) {
      const e = validateStep(draft.step, draft, ctx);
      if (Object.keys(e).length > 0) {
        setAttempted(true);
        requestAnimationFrame(() => document.querySelector<HTMLElement>('[aria-invalid="true"], [data-invalid="true"]')?.focus());
        return;
      }
    }
    go((draft.step + 1) as Step);
  }

  /* ----------------------------------------------------------------------------------- price (step 4) */
  const quoteReq = useMemo(() => (draft.step === 4 ? buildQuoteRequest(draft, originCode) : null), [draft, originCode]);
  const quoteKey = JSON.stringify(quoteReq);
  const [quote, setQuote] = useState<{ state: 'loading' | 'ok' | 'error'; data?: Quote; message?: string }>({ state: 'loading' });
  useEffect(() => {
    if (draft.step !== 4) return;
    if (!quoteReq) return setQuote({ state: 'error', message: t('pwa.wizard.priceFailed') });
    const ctl = new AbortController();
    setQuote((q) => ({ state: 'loading', ...(q.data ? { data: q.data } : {}) }));
    const timer = setTimeout(() => {
      api
        .quote(quoteReq, ctl.signal)
        .then((data) => setQuote({ state: 'ok', data }))
        .catch((e: unknown) => {
          if ((e as { name?: string }).name === 'AbortError') return;
          setQuote({ state: 'error', message: errorText(e) });
        });
    }, 350);
    return () => (clearTimeout(timer), ctl.abort());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- quoteKey captures quoteReq
  }, [draft.step, quoteKey]);

  /* ----------------------------------------------------------------------------------------- submit */
  async function submit() {
    setPinTouched(true);
    if (!pinValid(pin)) return;
    setSubmitting(true);
    setError(null);
    try {
      const body = buildIntakeBody(draft, pin, locale);
      // The key identifies the payload (not the PIN): a retry after a dropped connection replays, never duplicates.
      const key = await attemptKey(SCOPE, { ...body, pin: '' });
      const res = await api.createShipment(body, key);
      finish(res.shipment);
    } catch (e) {
      if (e instanceof ApiError && !e.isNetwork && e.status < 500) {
        clearAttempt(SCOPE); // the server refused it: nothing was created, the next try is a new request
        setAmbiguous(false);
      } else setAmbiguous(true);
      setError(errorText(e));
    } finally {
      setSubmitting(false);
    }
  }
  function finish(s: Shipment) {
    clearAttempt(SCOPE);
    clearDraft(userId);
    setAmbiguous(false);
    setError(null);
    setPin('');
    setDone(s);
  }

  /** Before editing after a lost connection: did the earlier attempt actually register the parcel? */
  async function reconcileThenEdit() {
    setSubmitting(true);
    setError(null);
    try {
      const page = await api.listShipments({ limit: 10 });
      const phone = (p: string) => normalizeTlPhone(p);
      const hit = page.items.find((s) => phone(s.recipient.phone) === phone(draft.recipient.phone) && phone(s.sender.phone) === phone(draft.sender.phone) && Date.now() - new Date(s.createdAt).getTime() < 30 * 60_000);
      if (hit) return finish(hit);
      clearAttempt(SCOPE);
      setAmbiguous(false);
      go(3);
    } catch (e) {
      setError(errorText(e)); // still offline: stay put, nothing is lost
    } finally {
      setSubmitting(false);
    }
  }

  function another() {
    const keep = draft.pickupBookingId ? { pickupBookingId: draft.pickupBookingId, scheme: draft.scheme, sender: draft.sender } : {};
    setDraft({ ...emptyDraft({ scheme: draft.scheme, lang: locale }), ...keep });
    setDone(null);
    setPin('');
    setShowRestored(false);
    window.scrollTo({ top: 0 });
  }

  /* ------------------------------------------------------------------------------------------ views */
  if (done) {
    return (
      <Page title={t('pwa.wizard.successTitle')}>
        <div className="card text-center" role="status">
          <p className="text-sm font-semibold uppercase tracking-wide text-slate-600">{t('receipt.waybill')}</p>
          <p className="mt-1 break-all font-mono text-xl font-extrabold text-brand-700" data-testid="waybill">
            {done.waybillNumber}
          </p>
          <p className="mt-2 text-slate-700">
            {done.origin.name} → {done.destination.name}
          </p>
          <p className="mt-3 text-3xl font-extrabold text-brand-800">{done.fees.total.display}</p>
          <p className="text-sm text-slate-600">{t('pwa.wizard.collectCash')}</p>
        </div>
        <PrintActions load={() => api.receipt(done.id, receiptLang(printLang, done.sender.lang))} deps={[done.id, printLang]} />
        <button type="button" className="btn btn-accent w-full" onClick={another}>
          {t('pwa.wizard.newParcel')}
        </button>
        {profile.kind === 'COURIER' && (
          <Link to="/" className="btn btn-outline w-full">
            {t('pwa.nav.jobs')}
          </Link>
        )}
      </Page>
    );
  }

  const stepTitle = t(`pwa.wizard.step${draft.step}` as 'pwa.wizard.step1');
  const destOptions = MUNICIPALITIES.filter((m) => (originCode === 'DIL' ? m.code !== 'DIL' : m.code === 'DIL')).map((m) => ({ value: m.code, label: m.name }));
  const langOptions = LOCALES.map((l) => ({ value: l, label: LOCALE_LABELS[l].native }));

  return (
    <Page title={t('pwa.wizard.title')}>
      <div>
        <p className="text-sm font-semibold text-slate-600">{t('pwa.wizard.stepOf', { current: draft.step, total: STEPS })}</p>
        <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuemin={1} aria-valuemax={STEPS} aria-valuenow={draft.step}>
          <div className="h-full bg-brand-700 transition-all" style={{ width: `${(draft.step / STEPS) * 100}%` }} />
        </div>
        <h2 ref={heading} tabIndex={-1} className="mt-3 text-lg font-bold text-brand-800 outline-none">
          {stepTitle}
        </h2>
      </div>

      {showRestored && (
        <Notice>
          <div className="flex items-center justify-between gap-3">
            <span>{t('pwa.wizard.draftRestored')}</span>
            <button type="button" className="min-h-11 shrink-0 font-bold underline" onClick={() => (clearDraft(userId), clearAttempt(SCOPE), setAmbiguous(false), setDraft(emptyDraft({ scheme: schemes[0]!, lang: locale })), setShowRestored(false))}>
              {t('pwa.wizard.discardDraft')}
            </button>
          </div>
        </Notice>
      )}
      {draft.pickupBookingId && <Notice>{t('pwa.wizard.pickupBooking', { code: bookingId || draft.pickupBookingId.slice(0, 8) })}</Notice>}

      {/* ================================================= step 1: route, sender, recipient ================================================= */}
      {draft.step === 1 && (
        <div className="space-y-4">
          <section className="card space-y-3" aria-label={t('pwa.wizard.route')}>
            <SelectInput label={t('pwa.wizard.service')} value={draft.scheme} onChange={(v) => up({ scheme: v as Scheme })} options={schemes.map((s) => ({ value: s, label: t(`web.schemes.${s}`) }))} hint={t(`web.home.schemeDesc.${draft.scheme}`)} />
            <SelectInput label={t('pwa.wizard.destination')} value={draft.destCode} onChange={(v) => up({ destCode: v, destAgentId: '' })} options={destOptions} placeholder="—" error={err('destCode')} />
            {draft.destCode && kiosks.loading && <p className="text-slate-600">{t('common.labels.loading')}</p>}
            {draft.destCode && kiosks.data && kiosks.data.length > 1 && (
              <SelectInput label={t('pwa.wizard.destKiosk')} value={draft.destAgentId} onChange={(v) => up({ destAgentId: v })} options={kiosks.data.map((k) => ({ value: k.id, label: `${k.kioskName} — ${k.address}` }))} placeholder={t('pwa.wizard.chooseKiosk')} error={err('destAgentId')} />
            )}
            {draft.destCode && kiosks.data?.length === 1 && (
              <p className="text-base">
                <span className="font-semibold">{t('pwa.wizard.destKiosk')}:</span> {kiosks.data[0]!.kioskName}
              </p>
            )}
            {draft.destCode && kiosks.data?.length === 0 && <ErrorNote>{t('pwa.wizard.noKiosk')}</ErrorNote>}
            {kiosks.error ? <ErrorNote onRetry={kiosks.reload}>{errorText(kiosks.error)}</ErrorNote> : null}
          </section>

          <section className="card space-y-3" aria-labelledby="sender-h">
            <h3 id="sender-h" className="h2">
              {t('pwa.wizard.sender')}
            </h3>
            <TextInput label={t('pwa.wizard.name')} value={draft.sender.name} onChange={(v) => upSender({ name: v })} error={err('sender.name')} autoComplete="off" />
            <SelectInput label={t('pwa.wizard.idType')} value={draft.sender.idType} onChange={(v) => upSender({ idType: v as Draft['sender']['idType'] })} options={(['BI', 'KARTAUN_ELEITORAL', 'PASSPORT'] as const).map((k) => ({ value: k, label: t(`pwa.wizard.idTypes.${k}`) }))} />
            <TextInput label={t('pwa.wizard.idNumber')} value={draft.sender.idNumber} onChange={(v) => upSender({ idNumber: v })} error={err('sender.idNumber')} autoCapitalize="characters" autoComplete="off" />
            <TextInput label={t('pwa.wizard.phone')} value={draft.sender.phone} onChange={(v) => upSender({ phone: v })} error={err('sender.phone')} type="tel" inputMode="tel" placeholder="+670 7712 3456" />
            <SelectInput label={t('pwa.wizard.lang')} value={draft.sender.lang} onChange={(v) => upSender({ lang: v as Locale })} options={langOptions} />
            <TextInput label={t('pwa.wizard.address')} value={draft.sender.address} onChange={(v) => upSender({ address: v })} optional />
          </section>

          <section className="card space-y-3" aria-labelledby="recipient-h">
            <h3 id="recipient-h" className="h2">
              {t('pwa.wizard.recipient')}
            </h3>
            <TextInput label={t('pwa.wizard.name')} value={draft.recipient.name} onChange={(v) => upRecipient({ name: v })} error={err('recipient.name')} autoComplete="off" />
            <TextInput label={t('pwa.wizard.phone')} value={draft.recipient.phone} onChange={(v) => upRecipient({ phone: v })} error={err('recipient.phone')} type="tel" inputMode="tel" placeholder="+670 7712 3456" />
            <SelectInput label={t('pwa.wizard.lang')} value={draft.recipient.lang} onChange={(v) => upRecipient({ lang: v as Locale })} options={langOptions} />
            {hasDoorDelivery(draft.scheme) && <TextInput label={t('pwa.wizard.deliveryAddress')} value={draft.recipient.address} onChange={(v) => upRecipient({ address: v })} error={err('recipient.address')} />}
          </section>
        </div>
      )}

      {/* ================================================= step 2: prohibited items + photos ================================================= */}
      {draft.step === 2 && (
        <div className="space-y-4">
          <section className="space-y-2" aria-labelledby="chk-h">
            <h3 id="chk-h" className="h2">
              {t('prohibited.confirmHeading')}
            </h3>
            <p className="field-hint !mt-0">{t('pwa.wizard.checklistIntro')}</p>
            {PROHIBITED_CHECKLIST_KEYS.map((k) => (
              <Check key={k} checked={draft.checklist[k]} onChange={(v) => up({ checklist: { ...draft.checklist, [k]: v } })}>
                {t(`prohibited.items.${k}`)}
              </Check>
            ))}
            {errors['checklist'] && (
              <p className="field-error" role="alert" data-invalid="true" tabIndex={-1}>
                {err('checklist')}
              </p>
            )}
          </section>
          <section className="space-y-3" aria-labelledby="photo-h">
            <h3 id="photo-h" className="h2">
              {t('pwa.wizard.photosIntro')}
            </h3>
            <PhotoField label={t('pwa.wizard.photoOpenBox')} photoType="OPEN_BOX_CONTENT" value={draft.photos.open} onChange={(v) => setDraft((d) => ({ ...d, photos: { ...d.photos, ...(v ? { open: v.id } : { open: undefined }) } }))} error={errors['photos'] && !draft.photos.open ? err('photos') : undefined} />
            <PhotoField label={t('pwa.wizard.photoSealed')} photoType="SEALED_PARCEL" value={draft.photos.sealed} onChange={(v) => setDraft((d) => ({ ...d, photos: { ...d.photos, ...(v ? { sealed: v.id } : { sealed: undefined }) } }))} error={errors['photos'] && !draft.photos.sealed ? err('photos') : undefined} />
          </section>
        </div>
      )}

      {/* ================================================= step 3: weight, dimensions, contents ================================================= */}
      {draft.step === 3 && (
        <div className="space-y-4">
          <section className="card space-y-3" aria-labelledby="item-h">
            <h3 id="item-h" className="h2">
              {t('pwa.wizard.contents')}
            </h3>
            <TextInput label={t('pwa.wizard.description')} value={draft.item.description} onChange={(v) => upItem({ description: v })} error={err('item.description')} autoComplete="off" />
            <SelectInput label={t('web.calculator.category')} value={draft.item.category} onChange={(v) => upItem({ category: v })} options={ITEM_CATEGORIES.map((c) => ({ value: c, label: t(`web.calculator.categories.${c}`) }))} />
            <div className="grid gap-2">
              <Check checked={draft.item.fragile} onChange={(v) => upItem({ fragile: v })}>
                {t('web.calculator.fragile')}
              </Check>
              <Check checked={draft.item.heavy} onChange={(v) => upItem({ heavy: v })}>
                {t('web.calculator.heavyBulk')}
              </Check>
            </div>
          </section>
          <section className="card space-y-3" aria-labelledby="size-h">
            <h3 id="size-h" className="h2">
              {t('pwa.wizard.parcelHeading')}
            </h3>
            <UnitInput label={t('web.calculator.weight')} unit={t('web.calculator.kg')} value={draft.parcel.weight} onChange={(v) => upParcel({ weight: v })} error={err('parcel.weight')} />
            <div className="grid grid-cols-3 gap-2">
              <UnitInput label={t('web.calculator.length')} unit={t('web.calculator.cm')} value={draft.parcel.length} onChange={(v) => upParcel({ length: v })} error={err('parcel.length')} />
              <UnitInput label={t('web.calculator.width')} unit={t('web.calculator.cm')} value={draft.parcel.width} onChange={(v) => upParcel({ width: v })} error={err('parcel.width')} />
              <UnitInput label={t('web.calculator.height')} unit={t('web.calculator.cm')} value={draft.parcel.height} onChange={(v) => upParcel({ height: v })} error={err('parcel.height')} />
            </div>
          </section>
        </div>
      )}

      {/* ================================================= step 4: fee, insurance, canal ================================================= */}
      {draft.step === 4 && (
        <div className="space-y-4">
          <section className="card space-y-3">
            <Check checked={draft.insure} onChange={(v) => up({ insure: v })}>
              {t('web.calculator.insure')}
            </Check>
            {draft.insure && <UnitInput label={t('web.calculator.declaredValue')} unit="USD" value={draft.item.declared} onChange={(v) => upItem({ declared: v })} error={validateStep(3, draft, ctx)['item.declared'] ? fieldText(validateStep(3, draft, ctx)['item.declared']) : undefined} />}
            {draft.insure && <p className="field-hint !mt-0">{t('web.calculator.insureHint')}</p>}
          </section>
          <QuoteCard quote={quote} locale={locale} />
        </div>
      )}

      {/* ================================================= step 5: PIN ================================================= */}
      {draft.step === 5 && (
        <div className="space-y-4">
          <section className="card space-y-1" aria-label={t('pwa.wizard.step5')}>
            <p className="text-lg font-bold text-brand-800">
              {profile.municipality.name} → {MUNICIPALITIES.find((m) => m.code === draft.destCode)?.name}
            </p>
            <p>
              {draft.sender.name} → {draft.recipient.name}
            </p>
            <p className="text-slate-600">
              {draft.item.description} · {draft.parcel.weight} {t('web.calculator.kg')}
            </p>
            {quote.data && <p className="pt-2 text-3xl font-extrabold text-brand-800">{quote.data.total.display}</p>}
            <p className="text-sm text-slate-600">{t('pwa.wizard.collectCash')}</p>
          </section>
          <section className="card space-y-3">
            <h3 className="h2">{t('pwa.wizard.pinHeading')}</h3>
            <TextInput label={t('pwa.wizard.pin')} value={pin} onChange={(v) => setPin(v.replace(/\D/g, '').slice(0, 6))} error={pinTouched && !pinValid(pin) ? t('errors.validation.pin') : undefined} type="password" inputMode="numeric" autoComplete="off" hint={t('pwa.wizard.pinHint')} />
          </section>
          {error && <ErrorNote>{error}</ErrorNote>}
          {ambiguous && <Notice tone="warn">{t('pwa.wizard.retryHint')}</Notice>}
        </div>
      )}

      {/* ---------------------------------------------------------------- navigation */}
      <div className="flex gap-3">
        {draft.step > 1 && (
          <button type="button" className="btn btn-outline flex-1" disabled={submitting} onClick={() => (draft.step === 5 && ambiguous ? void reconcileThenEdit() : go((draft.step - 1) as Step))}>
            {t('pwa.wizard.back')}
          </button>
        )}
        {draft.step < 5 ? (
          <button type="button" className="btn btn-primary flex-1" onClick={next} disabled={draft.step === 4 && quote.state !== 'ok'}>
            {t('pwa.wizard.next')}
          </button>
        ) : (
          <button type="button" className="btn btn-accent flex-1" onClick={() => void submit()} disabled={submitting}>
            {submitting ? t('pwa.wizard.submitting') : t('pwa.wizard.submit')}
          </button>
        )}
      </div>
    </Page>
  );
}

const CANAL_ICON = { BUS_BAGGAGE: IconBus, CARGO_TRUCK_PICKUP: IconTruck, SEA_FERRY_CARGO: IconShip } as const;

function QuoteCard({ quote, locale }: { quote: { state: 'loading' | 'ok' | 'error'; data?: Quote; message?: string }; locale: Locale }) {
  const t = useTranslations();
  if (quote.state === 'error') return <ErrorNote>{quote.message ?? t('pwa.wizard.priceFailed')}</ErrorNote>;
  const q = quote.data;
  if (!q) return <Loading />;
  const Icon = CANAL_ICON[q.canal];
  return (
    <section className={`card space-y-3 ${quote.state === 'loading' ? 'opacity-60' : ''}`} aria-busy={quote.state === 'loading'} aria-label={t('pwa.wizard.feeHeading')}>
      <h3 className="h2">{t('pwa.wizard.feeHeading')}</h3>
      <div className="flex items-start gap-3 rounded-xl bg-brand-50 p-3">
        <Icon width={28} height={28} className="mt-0.5 shrink-0 text-brand-700" />
        <div>
          <p className="text-sm font-semibold text-slate-600">{t('web.calculator.canal.label')}</p>
          <p className="text-lg font-bold text-brand-800" data-testid="canal">
            {t(`web.calculator.canal.${q.canal}`)}
          </p>
          <p className="text-sm text-slate-700">
            {t('web.calculator.eta')}: {q.eta[locale] || q.eta.tet}
          </p>
        </div>
      </div>
      {q.isSeaRoute && <Notice>{t('web.calculator.seaNotice')}</Notice>}
      <dl className="divide-y divide-slate-200 border-y border-slate-200">
        <Row label={t('web.calculator.baseFee')} value={q.baseShippingFee.display} />
        {q.pickupAddon && <Row label={t('web.calculator.pickupFee')} value={q.pickupAddon.fee.display} />}
        {q.deliveryAddon && <Row label={t('web.calculator.deliveryFee')} value={q.deliveryAddon.fee.display} />}
        {q.insurance && <Row label={t('web.calculator.insuranceFee')} value={q.insurance.premium.display} />}
        <Row label={t('common.labels.total')} value={q.total.display} strong testId="total" />
      </dl>
      <p className="text-sm text-slate-600">
        {t('web.calculator.chargeableWeight')}: {q.chargeableWeightKg} {t('web.calculator.kg')}
      </p>
    </section>
  );
}

function Row({ label, value, strong, testId }: { label: string; value: string; strong?: boolean; testId?: string }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 py-2 ${strong ? 'text-lg font-bold text-brand-800' : 'text-slate-700'}`}>
      <dt>{label}</dt>
      <dd className="tabular-nums" {...(testId ? { 'data-testid': testId } : {})}>
        {value}
      </dd>
    </div>
  );
}
