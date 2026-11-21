import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { useTranslations } from 'use-intl';
import { WAYBILL_REGEX } from '@670send/validation';
import { Check, SelectInput, TextInput } from '@/components/forms';
import { PhotoField } from '@/components/PhotoField';
import { ScanOrType } from '@/components/Scanner';
import { ErrorNote, Empty, Loading, Notice, Page } from '@/components/ui';
import { useErrorText, useFieldErrorText, useResource } from '@/hooks';
import { api } from '@/lib/api';
import { formatDiliDateTime, normalizeWaybill } from '@/lib/format';
import { useLocaleState } from '@/i18n';
import { useSession } from '@/lib/session';

/**
 * Proof of delivery. The recipient shows ID and reads the 6-digit OTP from WhatsApp; the agent photographs the
 * hand-over. Used at the kiosk (`/handover`) and by couriers for door deliveries (`/deliver/:waybill`).
 */
export function HandoverScreen() {
  const t = useTranslations();
  const [params, setParams] = useSearchParams();
  const route = useParams();
  const waybill = normalizeWaybill(route['waybill'] ?? params.get('no') ?? '');
  if (!WAYBILL_REGEX.test(waybill)) {
    return (
      <Page title={t('pwa.nav.pickup')}>
        <h2 className="h2">{t('pwa.pod.findParcel')}</h2>
        <p className="text-slate-700">{t('pwa.pod.findHint')}</p>
        <ScanOrType accept={['WAYBILL']} onResolve={(s) => setParams({ no: s.code })} />
      </Page>
    );
  }
  return <Deliver key={waybill} waybill={waybill} />;
}

type IdType = 'BI' | 'KARTAUN_ELEITORAL' | 'PASSPORT';

function Deliver({ waybill }: { waybill: string }) {
  const t = useTranslations();
  const errorText = useErrorText();
  const fieldText = useFieldErrorText();
  const navigate = useNavigate();
  const { locale } = useLocaleState();
  const { user } = useSession();
  const isCourier = Boolean(user?.scope.courierId);

  const parcel = useResource((s) => api.shipment(waybill, s), [waybill]);
  // The storage fee only exists for a parcel waiting at a kiosk.
  const fee = useResource(async () => (isCourier ? null : api.storageFee(waybill)), [waybill, isCourier]);

  const [otp, setOtp] = useState('');
  const [name, setName] = useState('');
  const [idType, setIdType] = useState<IdType>('BI');
  const [idNumber, setIdNumber] = useState('');
  const [rep, setRep] = useState(false);
  const [photo, setPhoto] = useState<string | undefined>();
  const [feeCollected, setFeeCollected] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resent, setResent] = useState(false);
  const [done, setDone] = useState<{ deliveredAt: string } | null>(null);

  const due = Number(fee.data?.penalty.usd ?? 0);
  // Pre-fill the collector with the recipient's name ONCE: the agent must be able to clear it for someone else.
  const prefilled = useRef(false);
  useEffect(() => {
    if (parcel.data && !prefilled.current) {
      prefilled.current = true;
      setName(parcel.data.recipient.name);
    }
  }, [parcel.data]);

  const problems = {
    otp: !/^\d{6}$/.test(otp),
    name: name.trim().length < 2,
    idNumber: idNumber.trim().length < 4,
    photo: !photo,
    fee: due > 0 && !feeCollected,
  };

  async function submit() {
    setAttempted(true);
    if (Object.values(problems).some(Boolean)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.podVerify({ waybill, otp, collector: { name: name.trim(), idType, idNumber: idNumber.trim(), isRepresentative: rep }, photoUploadId: photo!, storagePenaltyCollected: feeCollected });
      setDone({ deliveredAt: res.deliveredAt });
    } catch (e) {
      setError(errorText(e));
      setOtp('');
    } finally {
      setBusy(false);
    }
  }
  async function resend() {
    setError(null);
    try {
      await api.resendOtp(waybill);
      setResent(true);
    } catch (e) {
      setError(errorText(e));
    }
  }

  if (parcel.loading) return <Loading />;
  if (parcel.error || !parcel.data) return <Page title={t('pwa.nav.pickup')}><ErrorNote onRetry={parcel.reload}>{parcel.error ? errorText(parcel.error) : t('pwa.pod.notHere')}</ErrorNote></Page>;
  const p = parcel.data;

  if (done) {
    return (
      <Page title={t('pwa.pod.delivered')}>
        <div className="card space-y-2 text-center" role="status">
          <p className="text-2xl font-extrabold text-emerald-800">{t('pwa.pod.delivered')}</p>
          <p className="font-mono font-bold text-brand-700">{p.waybillNumber}</p>
          <p className="text-slate-700">{t('pwa.pod.deliveredBody')}</p>
          <p className="text-sm text-slate-600">{formatDiliDateTime(done.deliveredAt, locale)}</p>
        </div>
        <button type="button" className="btn btn-accent w-full" onClick={() => navigate(isCourier ? '/' : '/handover', { replace: true })}>
          {t('pwa.pod.next')}
        </button>
      </Page>
    );
  }

  const waiting = isCourier ? p.status === 'OUT_FOR_DELIVERY' : p.status === 'ARRIVED_AT_DEST_AGENT';
  return (
    <Page title={t('pwa.nav.pickup')}>
      <div className="card space-y-1">
        <p className="break-all font-mono text-lg font-bold text-brand-700">{p.waybillNumber}</p>
        <p>
          <span className="text-slate-600">{t('pwa.pod.recipient')}:</span> <span className="font-semibold">{p.recipient.name}</span>
        </p>
        <p>
          <span className="text-slate-600">{t('pwa.pod.destination')}:</span> {p.destination.name}
        </p>
        <p className="text-sm font-semibold text-brand-700">{t(`status.${p.status as 'DELIVERED'}.label`)}</p>
      </div>
      {!waiting && <Notice tone="warn">{t('pwa.pod.notHere')}</Notice>}

      {waiting && (
        <>
          {!isCourier && fee.data && (due > 0 ? <Notice tone="warn">{t('pwa.pod.storageDue', { amount: `$${due.toFixed(2)}` })}</Notice> : <Notice>{t('pwa.pod.storageFree')}</Notice>)}

          <section className="card space-y-3">
            <p className="text-base text-slate-700">{t('pwa.pod.otpHint')}</p>
            <TextInput label={t('pwa.pod.enterOtp')} value={otp} onChange={(v) => setOtp(v.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" error={attempted && problems.otp ? t('errors.validation.otp') : undefined} className="tracking-[0.4em]" />
            <button type="button" className="min-h-11 font-semibold text-brand-700 underline" onClick={() => void resend()}>
              {t('pwa.pod.resendOtp')}
            </button>
            {resent && <Notice tone="ok">{t('pwa.pod.otpResent')}</Notice>}
          </section>

          <section className="card space-y-3">
            <Check checked={rep} onChange={setRep}>
              {t('pwa.pod.representative')}
            </Check>
            <TextInput label={t('pwa.pod.collectorName')} value={name} onChange={setName} error={attempted && problems.name ? t('errors.validation.name') : undefined} autoComplete="off" />
            <SelectInput label={t('pwa.pod.idType')} value={idType} onChange={(v) => setIdType(v as IdType)} options={(['BI', 'KARTAUN_ELEITORAL', 'PASSPORT'] as const).map((k) => ({ value: k, label: t(`pwa.wizard.idTypes.${k}`) }))} />
            <TextInput label={t('pwa.pod.collectorId')} value={idNumber} onChange={setIdNumber} error={attempted && problems.idNumber ? fieldText({ key: 'minChars', params: { min: 4 } }) : undefined} autoCapitalize="characters" autoComplete="off" />
          </section>

          <PhotoField label={t('pwa.pod.photoPod')} hint={t('pwa.pod.photoHint')} photoType="PROOF_OF_DELIVERY" value={photo} onChange={(v) => setPhoto(v?.id)} error={attempted && problems.photo ? t('pwa.inbound.photosRequired') : undefined} />

          {due > 0 && (
            <Check checked={feeCollected} onChange={setFeeCollected}>
              {t('pwa.pod.storageCollected')}
              {attempted && problems.fee && <span className="field-error block">{t('web.form.required')}</span>}
            </Check>
          )}

          {error && <ErrorNote>{error}</ErrorNote>}
          <button type="button" className="btn btn-primary w-full" onClick={() => void submit()} disabled={busy}>
            {t('pwa.pod.complete')}
          </button>
        </>
      )}
      {!waiting && (
        <Empty>
          <button type="button" className="btn btn-outline" onClick={() => navigate(isCourier ? '/' : '/handover', { replace: true })}>
            {t('common.actions.back')}
          </button>
        </Empty>
      )}
    </Page>
  );
}
