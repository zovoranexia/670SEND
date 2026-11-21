import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { StateBadge } from '@/components/StatusBadge';
import { Await, ConfirmDialog, DataTable, ErrorNote, Field, Loading, Modal, Notice, Section } from '@/components/ui';
import { useAction, useCan, useErrorText, useResource } from '@/hooks';
import { useLocaleState } from '@/i18n';
import { financeApi, partnersApi } from '@/lib/endpoints';
import { formatDiliDate, formatDiliDateTime, saveBlob, usd } from '@/lib/format';
import { withKey } from '@/lib/idempotency';
import { useSession } from '@/lib/session';
import type { PayoutDto, PayoutStatus } from '@/lib/types';

const STATUSES: PayoutStatus[] = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PAID', 'FAILED', 'CANCELLED'];

function StatementModal({ payout, onClose }: { payout: PayoutDto; onClose: () => void }) {
  const t = useTranslations();
  const { locale } = useLocaleState();
  const errorText = useErrorText();
  const res = useResource((s) => financeApi.payoutStatement(payout.id, s), [payout.id]);
  const action = useAction();
  return (
    <Modal title={`${payout.payoutNo} · ${payout.fleetPartner.companyName}`} onClose={onClose} wide>
      {res.loading && !res.data && <Loading />}
      {res.error ? <ErrorNote onRetry={res.reload}>{errorText(res.error)}</ErrorNote> : null}
      {res.data && (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            {formatDiliDate(res.data.period.start, locale)} – {formatDiliDate(res.data.period.end, locale)}
          </p>
          <DataTable
            caption={t('admin.finance.statement')}
            head={
              <>
                <th>{t('admin.finance.line')}</th>
                <th>{t('admin.shipments.route')}</th>
                <th>kg</th>
                <th>{t('admin.finance.amount')}</th>
              </>
            }
          >
            {res.data.lines.map((l, i) => (
              <tr key={`${l.description}-${i}`} className={l.kind === 'CLAIM_DEDUCTION' ? 'bg-red-50' : ''}>
                <td className="font-mono">{l.description ?? l.waybill}</td>
                <td>{l.route ?? '—'}</td>
                <td>{l.chargeableKg ?? '—'}</td>
                <td className="text-right font-semibold">{usd(l.amount)}</td>
              </tr>
            ))}
          </DataTable>
          <dl className="ml-auto grid max-w-xs grid-cols-2 gap-x-4 text-sm">
            <dt>{t('admin.finance.gross')}</dt>
            <dd className="text-right">{usd(res.data.totals.gross)}</dd>
            <dt>{t('admin.finance.claimDeduction')}</dt>
            <dd className="text-right">{usd(res.data.totals.claimDeduction)}</dd>
            <dt className="font-bold">{t('admin.finance.net')}</dt>
            <dd className="text-right font-bold">{usd(res.data.totals.net)}</dd>
          </dl>
          {action.error && <ErrorNote>{action.error}</ErrorNote>}
          <button
            type="button"
            className="btn btn-outline"
            disabled={action.busy}
            onClick={() =>
              void action.run(async () => {
                const f = await financeApi.payoutStatementCsv(payout.id);
                saveBlob(f.blob, `${payout.payoutNo}.csv`);
              })
            }
          >
            {t('admin.finance.downloadCsv')}
          </button>
        </div>
      )}
    </Modal>
  );
}

/** Bank details are decrypted and AUDITED on every view: shown only after an explicit click. */
function BankReveal({ payout, onClose }: { payout: PayoutDto; onClose: () => void }) {
  const t = useTranslations();
  const action = useAction();
  const [data, setData] = useState<{ bank: string; accountName: string; accountNo: string } | null>(null);
  return (
    <Modal title={`${t('admin.finance.bankDetails')} · ${payout.fleetPartner.companyName}`} onClose={onClose}>
      <Notice tone="warn">{t('admin.finance.revealWarning')}</Notice>
      {action.error && <ErrorNote>{action.error}</ErrorNote>}
      {data ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt className="font-semibold">{t('admin.partners.bank')}</dt>
          <dd>{data.bank}</dd>
          <dt className="font-semibold">{t('admin.partners.accountName')}</dt>
          <dd>{data.accountName}</dd>
          <dt className="font-semibold">{t('admin.partners.accountNo')}</dt>
          <dd className="font-mono text-lg font-bold">{data.accountNo}</dd>
        </dl>
      ) : (
        <button
          type="button"
          className="btn btn-primary"
          disabled={action.busy}
          onClick={() =>
            void action.run(async () => {
              setData(await financeApi.bankDetails(payout.fleetPartner.id));
            })
          }
        >
          {t('admin.finance.reveal')}
        </button>
      )}
    </Modal>
  );
}

function GenerateDialog({ onClose, onDone }: { onClose: () => void; onDone: (n: number) => void }) {
  const t = useTranslations();
  const action = useAction();
  const partners = useResource((s) => partnersApi.fleetPartners({ status: 'ACTIVE', limit: 200 }, s), []);
  const [mode, setMode] = useState<'cycle' | 'partner'>('cycle');
  const [cycle, setCycle] = useState<'DAILY' | 'WEEKLY'>('WEEKLY');
  const [partnerId, setPartnerId] = useState('');
  const body = mode === 'cycle' ? { cycle } : { fleetPartnerId: partnerId };
  return (
    <Modal title={t('admin.finance.generate')} onClose={onClose}>
      <p className="text-sm text-slate-600">{t('admin.finance.generateIntro')}</p>
      <fieldset className="space-y-2">
        <label className="flex items-center gap-2">
          <input type="radio" name="mode" checked={mode === 'cycle'} onChange={() => setMode('cycle')} />
          {t('admin.finance.byCycle')}
        </label>
        {mode === 'cycle' && (
          <select aria-label={t('admin.partners.payoutCycle')} className="input w-56" value={cycle} onChange={(e) => setCycle(e.target.value as 'DAILY' | 'WEEKLY')}>
            <option value="WEEKLY">{t('admin.partners.cycle.WEEKLY')}</option>
            <option value="DAILY">{t('admin.partners.cycle.DAILY')}</option>
          </select>
        )}
        <label className="flex items-center gap-2">
          <input type="radio" name="mode" checked={mode === 'partner'} onChange={() => setMode('partner')} />
          {t('admin.finance.byPartner')}
        </label>
        {mode === 'partner' && (
          <select aria-label={t('admin.hubs.fleet')} className="input" value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
            <option value="">—</option>
            {(partners.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.companyName}
              </option>
            ))}
          </select>
        )}
      </fieldset>
      {action.error && <ErrorNote>{action.error}</ErrorNote>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-outline" onClick={onClose}>
          {t('common.actions.cancel')}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={action.busy || (mode === 'partner' && !partnerId)}
          onClick={async () => {
            let n = 0;
            if (await action.run(async () => (n = (await withKey('payout-generate', body, (key) => financeApi.generatePayouts(body, key))).length))) onDone(n);
          }}
        >
          {t('admin.finance.generate')}
        </button>
      </div>
    </Modal>
  );
}

type Flow = { kind: 'pay' | 'fail' | 'cancel' | 'approve' | 'submit'; p: PayoutDto };

/** Fleet payouts: DRAFT → submitted → approved by a DIFFERENT person → paid. Failed ones can be paid again. */
export function PayoutsTab() {
  const t = useTranslations();
  const can = useCan();
  const { user } = useSession();
  const { locale } = useLocaleState();
  const [status, setStatus] = useState<string>('');
  const [statement, setStatement] = useState<PayoutDto | null>(null);
  const [bank, setBank] = useState<PayoutDto | null>(null);
  const [generating, setGenerating] = useState(false);
  const [flow, setFlow] = useState<Flow | null>(null);
  const [ref, setRef] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const action = useAction();
  const list = useResource((s) => financeApi.payouts({ status: status || undefined, limit: 100 }, s), [status]);
  const create = can('payouts:create');
  const approve = can('payouts:approve');

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    if (await action.run(fn)) {
      setFlow(null);
      setRef('');
      setMsg(ok);
      list.reload();
    }
  };

  return (
    <Section
      title={t('admin.finance.payoutsTitle')}
      actions={
        create && (
          <button type="button" className="btn btn-primary" onClick={() => setGenerating(true)}>
            {t('admin.finance.generate')}
          </button>
        )
      }
    >
      <div className="card flex flex-wrap items-end gap-3">
        <Field label={t('common.labels.status')}>
          {(p) => (
            <select {...p} className="input w-60" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">{t('admin.common.all')}</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`admin.state.${s}`)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <p className="max-w-xl pb-2 text-sm text-slate-600">{t('admin.finance.payoutFlow')}</p>
      </div>
      {msg && <Notice tone="ok">{msg}</Notice>}
      <Await res={list} empty={(d) => d.length === 0}>
        {(rows) => (
          <DataTable
            caption={t('admin.finance.payoutsTitle')}
            head={
              <>
                <th>{t('admin.finance.payoutNo')}</th>
                <th>{t('admin.hubs.fleet')}</th>
                <th>{t('admin.finance.period')}</th>
                <th>{t('admin.finance.gross')}</th>
                <th>{t('admin.finance.claimDeduction')}</th>
                <th>{t('admin.finance.net')}</th>
                <th>{t('common.labels.status')}</th>
                <th />
              </>
            }
          >
            {rows.map((p) => {
              const mine = p.createdBy === user?.fullName;
              return (
                <tr key={p.id}>
                  <td className="font-mono">
                    <button type="button" className="font-semibold text-brand-700 underline" onClick={() => setStatement(p)}>
                      {p.payoutNo}
                    </button>
                    {p.autoGenerated && <span className="ml-1 text-xs text-slate-600">{t('admin.finance.auto')}</span>}
                  </td>
                  <td>{p.fleetPartner.companyName}</td>
                  <td className="whitespace-nowrap text-xs">
                    {formatDiliDate(p.period.start, locale)} – {formatDiliDate(p.period.end, locale)}
                  </td>
                  <td>{usd(p.gross)}</td>
                  <td>{Number(p.claimDeduction) > 0 ? `-${usd(p.claimDeduction)}` : '—'}</td>
                  <td className="font-bold">{usd(p.net)}</td>
                  <td>
                    <StateBadge state={p.status} />
                    <p className="text-xs text-slate-600">
                      {p.createdBy}
                      {p.approvedBy ? ` → ${p.approvedBy}` : ''}
                    </p>
                    {p.paidAt && (
                      <p className="text-xs text-slate-600">
                        {formatDiliDateTime(p.paidAt, locale)} · {p.bankReference}
                      </p>
                    )}
                    {p.failureReason && <p className="max-w-48 text-xs text-red-700">{p.failureReason}</p>}
                  </td>
                  <td className="space-x-1 whitespace-nowrap">
                    {create && p.status === 'DRAFT' && (
                      <button type="button" className="btn btn-primary btn-sm" onClick={() => setFlow({ kind: 'submit', p })}>
                        {t('admin.finance.submit')}
                      </button>
                    )}
                    {approve && p.status === 'PENDING_APPROVAL' && (
                      <button type="button" className="btn btn-primary btn-sm" onClick={() => setFlow({ kind: 'approve', p })} disabled={mine} title={mine ? t('admin.finance.ownPayout') : undefined}>
                        {t('admin.finance.approve')}
                      </button>
                    )}
                    {approve && (p.status === 'APPROVED' || p.status === 'FAILED') && (
                      <>
                        <button type="button" className="btn btn-outline btn-sm" onClick={() => setBank(p)}>
                          {t('admin.finance.bankDetails')}
                        </button>
                        <button type="button" className="btn btn-primary btn-sm" onClick={() => setFlow({ kind: 'pay', p })}>
                          {t('admin.finance.markPaid')}
                        </button>
                      </>
                    )}
                    {approve && p.status === 'APPROVED' && (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFlow({ kind: 'fail', p })}>
                        {t('admin.finance.markFailed')}
                      </button>
                    )}
                    {create && p.status !== 'PAID' && p.status !== 'CANCELLED' && (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFlow({ kind: 'cancel', p })}>
                        {t('common.actions.cancel')}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </DataTable>
        )}
      </Await>

      {statement && <StatementModal payout={statement} onClose={() => setStatement(null)} />}
      {bank && <BankReveal payout={bank} onClose={() => setBank(null)} />}
      {generating && (
        <GenerateDialog
          onClose={() => setGenerating(false)}
          onDone={(n) => {
            setGenerating(false);
            setMsg(t('admin.finance.generated', { count: n }));
            list.reload();
          }}
        />
      )}

      {flow?.kind === 'submit' && (
        <ConfirmDialog title={t('admin.finance.submit')} message={t('admin.finance.submitIntro', { no: flow.p.payoutNo })} confirmLabel={t('admin.finance.submit')} busy={action.busy} error={action.error} onClose={() => setFlow(null)} onConfirm={() => void run(() => financeApi.submitPayout(flow.p.id), t('admin.finance.submitted'))} />
      )}
      {flow?.kind === 'approve' && (
        <ConfirmDialog
          title={t('admin.finance.approve')}
          message={
            <div className="space-y-2">
              <p>{t('admin.finance.approveIntro2', { no: flow.p.payoutNo, amount: usd(flow.p.net), partner: flow.p.fleetPartner.companyName })}</p>
              <Notice tone="info">{t('admin.finance.fourEyes')}</Notice>
            </div>
          }
          confirmLabel={t('admin.finance.approve')}
          busy={action.busy}
          error={action.error}
          onClose={() => setFlow(null)}
          onConfirm={() => void run(() => financeApi.approvePayout(flow.p.id), t('admin.finance.approved'))}
        />
      )}
      {flow?.kind === 'pay' && (
        <Modal title={t('admin.finance.markPaid')} onClose={() => setFlow(null)}>
          <p>{t('admin.finance.payIntro', { no: flow.p.payoutNo, amount: usd(flow.p.net), partner: flow.p.fleetPartner.companyName })}</p>
          <Field label={t('admin.finance.bankReference')} hint={t('admin.finance.bankReferenceHint')}>
            {(p) => <input {...p} className="input font-mono" value={ref} onChange={(e) => setRef(e.target.value)} maxLength={80} />}
          </Field>
          {action.error && <ErrorNote>{action.error}</ErrorNote>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn btn-outline" onClick={() => setFlow(null)}>
              {t('common.actions.cancel')}
            </button>
            <button type="button" className="btn btn-primary" disabled={action.busy || ref.trim().length < 3} onClick={() => void run(() => withKey(`payout-pay:${flow.p.id}`, { ref: ref.trim() }, (key) => financeApi.payPayout(flow.p.id, ref.trim(), key)), t('admin.finance.paid'))}>
              {t('admin.finance.markPaid')}
            </button>
          </div>
        </Modal>
      )}
      {flow?.kind === 'fail' && (
        <ConfirmDialog title={t('admin.finance.markFailed')} message={t('admin.finance.failIntro')} confirmLabel={t('admin.finance.markFailed')} danger reasonLabel={t('admin.finance.failReason')} busy={action.busy} error={action.error} onClose={() => setFlow(null)} onConfirm={(reason) => void run(() => financeApi.failPayout(flow.p.id, reason), t('admin.finance.failed'))} />
      )}
      {flow?.kind === 'cancel' && (
        <ConfirmDialog title={t('admin.finance.cancelPayout')} message={t('admin.finance.cancelIntro')} confirmLabel={t('admin.finance.cancelPayout')} danger busy={action.busy} error={action.error} onClose={() => setFlow(null)} onConfirm={() => void run(() => financeApi.cancelPayout(flow.p.id), t('admin.finance.cancelled'))} />
      )}
    </Section>
  );
}
