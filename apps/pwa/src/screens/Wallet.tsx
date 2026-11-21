import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { PAYMENT_CHANNELS } from '@670send/types';
import { SelectInput, TextInput } from '@/components/forms';
import { PhotoField } from '@/components/PhotoField';
import { ErrorNote, Loading, Notice, Page } from '@/components/ui';
import { useErrorText, useResource } from '@/hooks';
import { api, ApiError } from '@/lib/api';
import { usd } from '@/lib/format';
import { attemptKey, clearAttempt } from '@/lib/idempotency';

const SCOPE = 'deposit';
const money = /^\d{1,7}(\.\d{1,2})?$/;

export function WalletScreen() {
  const t = useTranslations();
  const errorText = useErrorText();
  const wallets = useResource((s) => api.wallets().then((w) => (s.aborted ? [] : w)), []);
  const deposits = useResource(() => api.deposits(), []);

  const [amount, setAmount] = useState('');
  const [channel, setChannel] = useState<string>('CASH');
  const [reference, setReference] = useState('');
  const [proof, setProof] = useState<string | undefined>();
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const amountText = amount.trim().replace(',', '.');
  const bad = { amount: !money.test(amountText) || Number(amountText) <= 0, reference: reference.trim().length < 3, proof: channel !== 'CASH' && !proof };

  async function submit() {
    setAttempted(true);
    if (Object.values(bad).some(Boolean)) return;
    setBusy(true);
    setError(null);
    setSent(false);
    const body = { amountUsd: Number(amountText).toFixed(2), channel, referenceNo: reference.trim(), ...(proof ? { proofUploadId: proof } : {}) };
    try {
      await api.requestDeposit(body, await attemptKey(SCOPE, body));
      clearAttempt(SCOPE);
      setSent(true);
      setAmount('');
      setReference('');
      setProof(undefined);
      setAttempted(false);
      deposits.reload();
    } catch (e) {
      if (e instanceof ApiError && !e.isNetwork && e.status < 500) clearAttempt(SCOPE);
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page title={t('pwa.wallet.title')}>
      {wallets.loading && <Loading />}
      {wallets.error ? <ErrorNote onRetry={wallets.reload}>{errorText(wallets.error)}</ErrorNote> : null}
      <div className="grid grid-cols-2 gap-3">
        {wallets.data?.map((w) => (
          <div key={w.id} className="card">
            <p className="text-sm font-semibold text-slate-600"><WalletName type={w.type} /></p>
            <p className={`text-2xl font-extrabold ${Number(w.balance) < 10 && w.type === 'DEPOSIT' ? 'text-accent-700' : 'text-brand-800'}`}>{usd(w.balance)}</p>
          </div>
        ))}
      </div>

      <section className="card space-y-3" aria-labelledby="topup-h">
        <h2 id="topup-h" className="h2">
          {t('pwa.wallet.topUp')}
        </h2>
        {sent && <Notice tone="ok">{t('pwa.wallet.sent')}</Notice>}
        {error && <ErrorNote>{error}</ErrorNote>}
        <TextInput label={t('pwa.wallet.amount')} value={amount} onChange={setAmount} inputMode="decimal" error={attempted && bad.amount ? t('web.form.number') : undefined} autoComplete="off" />
        <SelectInput label={t('pwa.wallet.channel')} value={channel} onChange={setChannel} options={PAYMENT_CHANNELS.map((c) => ({ value: c, label: t(`pwa.wallet.channels.${c}`) }))} />
        <TextInput label={t('pwa.wallet.reference')} value={reference} onChange={setReference} error={attempted && bad.reference ? t('web.form.minChars', { min: 3 }) : undefined} autoComplete="off" />
        {channel !== 'CASH' && <PhotoField label={t('pwa.wallet.proof')} photoType="DEPOSIT_PROOF" value={proof} onChange={(v) => setProof(v?.id)} error={attempted && bad.proof ? t('pwa.wallet.proofRequired') : undefined} />}
        <button type="button" className="btn btn-primary w-full" onClick={() => void submit()} disabled={busy}>
          {t('pwa.wallet.send')}
        </button>
      </section>

      {deposits.data && deposits.data.length > 0 && (
        <section aria-labelledby="recent-h" className="space-y-2">
          <h2 id="recent-h" className="h2">
            {t('pwa.wallet.recent')}
          </h2>
          <ul className="space-y-2">
            {deposits.data.map((d) => (
              <li key={d.id} className="card flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-bold">{usd(d.amount)}</p>
                  <p className="truncate text-sm text-slate-600">
                    {t(`pwa.wallet.channels.${d.channel as 'CASH'}`)} · {d.referenceNo}
                  </p>
                </div>
                <span className={`rounded-full px-3 py-1 text-sm font-bold ${d.status === 'APPROVED' ? 'bg-emerald-100 text-emerald-900' : d.status === 'REJECTED' ? 'bg-red-100 text-red-900' : 'bg-amber-100 text-amber-950'}`}>{t(`pwa.wallet.status.${d.status}`)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Page>
  );
}

function WalletName({ type }: { type: string }) {
  const t = useTranslations('pwa.home');
  if (type === 'DEPOSIT') return <>{t('deposit')}</>;
  if (type === 'COMMISSION') return <>{t('commission')}</>;
  if (type === 'COURIER_EARNINGS') return <>{t('earnings')}</>;
  return <>{type}</>;
}
