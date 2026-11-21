import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { normalizeWaybill } from '@/lib/format';
import { ConfirmDialog, ErrorNote, Field, Notice, Section, StatCard, Await } from '@/components/ui';
import { useAction, useCan, useResource } from '@/hooks';
import { financeApi } from '@/lib/endpoints';
import { usd } from '@/lib/format';
import { withKey } from '@/lib/idempotency';

function Reconciliation() {
  const t = useTranslations();
  const res = useResource((s) => financeApi.reconciliation(s), []);
  return (
    <Section
      title={t('admin.finance.reconTitle')}
      actions={
        <button type="button" className="btn btn-outline btn-sm" onClick={res.reload} disabled={res.loading}>
          {t('admin.finance.reconRun')}
        </button>
      }
    >
      <Await res={res}>
        {(r) => (
          <div className="space-y-4">
            <Notice tone={r.ok ? 'ok' : 'warn'}>{r.ok ? t('admin.finance.reconOk') : t('admin.finance.reconProblem')}</Notice>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard label={t('admin.finance.globalNet')} value={usd(r.ledger.globalNet)} hint={r.ledger.ok ? t('admin.finance.balanced') : t('admin.finance.notBalanced')} tone={r.ledger.ok ? undefined : 'bad'} />
              <StatCard label={t('admin.finance.pendingSettlement')} value={usd(r.pendingSettlement.wallet)} hint={t('admin.finance.expected', { amount: usd(r.pendingSettlement.expectedFromSettlements) })} tone={r.pendingSettlement.ok ? undefined : 'bad'} />
              <StatCard label={t('admin.finance.claimReserve')} value={usd(r.escrow.claimReserve)} hint={t('admin.finance.approvedUnpaid', { amount: usd(r.escrow.approvedUnpaidClaims) })} tone={Number(r.escrow.claimReserve) < Number(r.escrow.approvedUnpaidClaims) ? 'warn' : undefined} />
              <StatCard label={t('admin.finance.insurancePool')} value={usd(r.escrow.insurancePool)} />
            </div>
            {r.ledger.mismatchedWallets.length > 0 && (
              <Notice tone="warn">
                <p className="font-semibold">{t('admin.finance.mismatched')}</p>
                <ul className="mt-1 list-disc pl-5">
                  {r.ledger.mismatchedWallets.map((w) => (
                    <li key={w.walletId} className="font-mono text-xs">
                      {w.walletId}: {usd(w.balance)} ≠ {usd(w.ledger)}
                    </li>
                  ))}
                </ul>
              </Notice>
            )}
            {r.ledger.unbalancedTransactions.length > 0 && (
              <Notice tone="warn">
                <p className="font-semibold">{t('admin.finance.unbalanced')}</p>
                <ul className="mt-1 list-disc pl-5">
                  {r.ledger.unbalancedTransactions.map((x) => (
                    <li key={x.transactionId} className="font-mono text-xs">
                      {x.transactionId}: {usd(x.net)}
                    </li>
                  ))}
                </ul>
              </Notice>
            )}
            {r.lowFloatAgents.length > 0 && (
              <div className="card">
                <h3 className="h2 mb-2">{t('admin.finance.lowFloat')}</h3>
                <ul className="text-sm">
                  {r.lowFloatAgents.map((a) => (
                    <li key={a.agentId} className="flex justify-between border-b border-slate-100 py-1">
                      <span className="font-mono text-xs">{a.agentId}</span>
                      <span className="font-semibold text-red-700">{usd(a.balance)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Await>
    </Section>
  );
}

/** Give back the unused door-delivery add-on of a parcel that never needed it. The server checks eligibility. */
function Refund() {
  const t = useTranslations();
  const [waybill, setWaybill] = useState('');
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const action = useAction();
  const w = normalizeWaybill(waybill);
  const ok = w.length >= 10 && reason.trim().length >= 5;
  return (
    <Section title={t('admin.finance.refundTitle')}>
      <div className="card max-w-2xl space-y-3">
        <p className="text-sm text-slate-600">{t('admin.finance.refundIntro')}</p>
        {done && <Notice tone="ok">{done}</Notice>}
        <Field label={t('admin.shipments.waybill')}>{(p) => <input {...p} className="input font-mono" value={waybill} onChange={(e) => setWaybill(e.target.value)} />}</Field>
        <Field label={t('admin.finance.refundReason')}>{(p) => <input {...p} className="input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />}</Field>
        <Field label={t('admin.finance.refundReference')} optional>
          {(p) => <input {...p} className="input" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={80} />}
        </Field>
        {action.error && !confirm && <ErrorNote>{action.error}</ErrorNote>}
        <button type="button" className="btn btn-primary" disabled={!ok} onClick={() => setConfirm(true)}>
          {t('admin.finance.refundSubmit')}
        </button>
      </div>
      {confirm && (
        <ConfirmDialog
          title={t('admin.finance.refundSubmit')}
          message={t('admin.finance.refundConfirm', { waybill: w })}
          confirmLabel={t('admin.finance.refundSubmit')}
          danger
          busy={action.busy}
          error={action.error}
          onClose={() => setConfirm(false)}
          onConfirm={async () => {
            const body = { waybill: w, reason: reason.trim(), ...(reference.trim() ? { reference: reference.trim() } : {}) };
            let amount = '';
            if (await action.run(async () => (amount = (await withKey(`refund:${w}`, body, (key) => financeApi.refund(body, key))).refunded.usd))) {
              setConfirm(false);
              setDone(t('admin.finance.refunded', { amount: usd(amount), waybill: w }));
              setWaybill('');
              setReason('');
              setReference('');
            }
          }}
        />
      )}
    </Section>
  );
}

export function ReconTab() {
  const can = useCan();
  return (
    <div className="space-y-8">
      {can('reconciliation:run') && <Reconciliation />}
      {can('refunds:issue') && <Refund />}
    </div>
  );
}
