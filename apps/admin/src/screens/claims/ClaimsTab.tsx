import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { StateBadge } from '@/components/StatusBadge';
import { Await, Badge, DataTable, ErrorNote, Field, Loading, Modal, Notice, Section } from '@/components/ui';
import { useAction, useCan, useErrorText, useResource } from '@/hooks';
import { useLocaleState } from '@/i18n';
import { claimsApi } from '@/lib/endpoints';
import { formatDiliDateTime, toAmount, usd } from '@/lib/format';
import { withKey } from '@/lib/idempotency';
import type { ClaimDto, ClaimStatus, LiableParty } from '@/lib/types';
import { EvidenceDesk } from './Evidence';

const STATUSES: ClaimStatus[] = ['OPEN', 'INVESTIGATING', 'APPROVED', 'REJECTED', 'PAID'];
const PARTIES: LiableParty[] = ['FLEET_PARTNER', 'ORIGIN_AGENT', 'DEST_AGENT', 'COURIER', 'PLATFORM_ESCROW'];

function ClaimModal({ initial, onClose, onChanged }: { initial: ClaimDto; onClose: () => void; onChanged: () => void }) {
  const t = useTranslations();
  const can = useCan();
  const { locale } = useLocaleState();
  const errorText = useErrorText();
  const [claim, setClaim] = useState(initial);
  const action = useAction();
  const [mode, setMode] = useState<null | 'approve' | 'reject' | 'pay'>(null);
  const [amount, setAmount] = useState('');
  const [party, setParty] = useState<LiableParty | ''>('');
  const [notes, setNotes] = useState('');
  const [reason, setReason] = useState('');
  const [ref, setRef] = useState('');
  const [channel, setChannel] = useState('BNCTL');
  const liability = useResource((s) => claimsApi.liability(claim.waybill, s), [claim.waybill], { enabled: can('claims:read') });

  const apply = async (fn: () => Promise<ClaimDto>) => {
    let next: ClaimDto | null = null;
    if (
      await action.run(async () => {
        next = await fn();
      })
    ) {
      setClaim(next!);
      setMode(null);
      onChanged();
    }
  };

  const max = Math.min(Number(claim.requested), Number(claim.maxEligible));
  const amountOk = (() => {
    const a = toAmount(amount);
    return a !== null && Number(a) <= max;
  })();
  const open = claim.status === 'OPEN' || claim.status === 'INVESTIGATING';

  return (
    <Modal title={`${claim.claimNo} · ${claim.waybill}`} onClose={onClose} wide>
      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="min-w-0">{can('evidence:read') ? <EvidenceDesk claimId={claim.id} /> : <Notice tone="info">{t('admin.claims.noEvidenceRight')}</Notice>}</div>

        <aside className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <StateBadge state={claim.status} />
            <Badge tone="slate">{t(`admin.claims.type.${claim.type}`)}</Badge>
            {claim.isInsured && <Badge tone="brand">{t('admin.claims.insured')}</Badge>}
            {claim.needsFinanceApproval && <Badge tone="amber">{t('admin.claims.needsFinance')}</Badge>}
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="font-semibold">{t('admin.claims.claimant')}</dt>
            <dd>
              {claim.claimant.name ?? '—'} {claim.claimant.phone ? `· ${claim.claimant.phone}` : ''}
            </dd>
            <dt className="font-semibold">{t('admin.claims.requested')}</dt>
            <dd className="font-bold">{usd(claim.requested)}</dd>
            <dt className="font-semibold">{t('admin.claims.maxEligible')}</dt>
            <dd>{usd(claim.maxEligible)}</dd>
            {claim.approved && (
              <>
                <dt className="font-semibold">{t('admin.claims.approved')}</dt>
                <dd className="font-bold">{usd(claim.approved)}</dd>
              </>
            )}
            {claim.liableParty && (
              <>
                <dt className="font-semibold">{t('admin.claims.liable')}</dt>
                <dd>{t(`admin.claims.party.${claim.liableParty}`)}</dd>
              </>
            )}
            <dt className="font-semibold">{t('admin.claims.filedBy')}</dt>
            <dd>{claim.filedBy}</dd>
            {claim.reviewedBy && (
              <>
                <dt className="font-semibold">{t('admin.claims.decidedBy')}</dt>
                <dd>{claim.reviewedBy}</dd>
              </>
            )}
            {claim.financeApprovedBy && (
              <>
                <dt className="font-semibold">{t('admin.claims.financeBy')}</dt>
                <dd>{claim.financeApprovedBy}</dd>
              </>
            )}
            <dt className="font-semibold">{t('admin.shipments.created')}</dt>
            <dd>{formatDiliDateTime(claim.createdAt, locale)}</dd>
          </dl>
          {claim.description && <p className="rounded bg-slate-50 p-2 text-sm">{claim.description}</p>}
          {claim.lateFilingReason && (
            <Notice tone="warn">
              {t('admin.claims.late')}: {claim.lateFilingReason}
            </Notice>
          )}
          {claim.rejectionReason && (
            <Notice tone="warn">
              {t('admin.claims.rejectedBecause')}: {claim.rejectionReason}
            </Notice>
          )}
          {claim.paid && (
            <Notice tone="ok">
              {t('admin.claims.paidOn', { date: formatDiliDateTime(claim.paid.at, locale) })} · {claim.paid.reference}
              {claim.recovery && (
                <span className="block text-xs">
                  {t('admin.claims.recovery', { recovered: usd(claim.recovery.recovered), outstanding: usd(claim.recovery.outstanding) })}
                </span>
              )}
            </Notice>
          )}
          {liability.data && (
            <p className="text-xs text-slate-600">
              {t('admin.claims.remaining', { amount: usd(liability.data.remaining), claimed: usd(liability.data.alreadyClaimed) })}
            </p>
          )}
          {liability.loading && <Loading />}
          {liability.error ? <p className="text-xs text-red-700">{errorText(liability.error)}</p> : null}

          {action.error && !mode && <ErrorNote>{action.error}</ErrorNote>}
          <div className="flex flex-wrap gap-2">
            {can('claims:review') && claim.status === 'OPEN' && (
              <button type="button" className="btn btn-outline btn-sm" disabled={action.busy} onClick={() => void apply(() => claimsApi.review(claim.id))}>
                {t('admin.claims.startReview')}
              </button>
            )}
            {can('claims:approve') && open && (
              <>
                <button type="button" className="btn btn-primary btn-sm" onClick={() => { setAmount(String(max)); setMode('approve'); }}>
                  {t('admin.claims.approve')}
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMode('reject')}>
                  {t('admin.claims.reject')}
                </button>
              </>
            )}
            {can('claims:finance_approve') && claim.needsFinanceApproval && (
              <button type="button" className="btn btn-primary btn-sm" disabled={action.busy} onClick={() => void apply(() => claimsApi.financeApprove(claim.id))}>
                {t('admin.claims.financeApprove')}
              </button>
            )}
            {can('claims:pay') && claim.status === 'APPROVED' && (
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setMode('pay')}>
                {t('admin.claims.pay')}
              </button>
            )}
            {can('claims:pay') && claim.status === 'PAID' && claim.recovery && Number(claim.recovery.outstanding) > 0 && (
              <button type="button" className="btn btn-outline btn-sm" disabled={action.busy} onClick={() => void apply(() => claimsApi.recover(claim.id))}>
                {t('admin.claims.recover')}
              </button>
            )}
          </div>
        </aside>
      </div>

      {mode === 'approve' && (
        <Modal title={t('admin.claims.approve')} onClose={() => setMode(null)}>
          <p className="text-sm text-slate-600">{t('admin.claims.approveIntro', { max: usd(max) })}</p>
          <Field label={t('admin.claims.approvedAmount')} error={amount && !amountOk ? t('admin.claims.amountError', { max: usd(max) }) : undefined}>
            {(p) => <input {...p} className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />}
          </Field>
          <Field label={t('admin.claims.liable')} hint={t('admin.claims.liableHint')}>
            {(p) => (
              <select {...p} className="input" value={party} onChange={(e) => setParty(e.target.value as LiableParty)}>
                <option value="">—</option>
                {PARTIES.map((x) => (
                  <option key={x} value={x}>
                    {t(`admin.claims.party.${x}`)}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label={t('common.labels.notes')} optional>
            {(p) => <textarea {...p} className="input min-h-20" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />}
          </Field>
          {action.error && <ErrorNote>{action.error}</ErrorNote>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn btn-outline" onClick={() => setMode(null)}>
              {t('common.actions.cancel')}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={action.busy || !amountOk || !party}
              onClick={() => void apply(() => claimsApi.decide(claim.id, { decision: 'APPROVE', approvedAmountUsd: toAmount(amount)!, liableParty: party as LiableParty, ...(notes.trim() ? { notes: notes.trim() } : {}) }))}
            >
              {t('admin.claims.approve')}
            </button>
          </div>
        </Modal>
      )}
      {mode === 'reject' && (
        <Modal title={t('admin.claims.reject')} onClose={() => setMode(null)}>
          <Field label={t('admin.claims.rejectReason')} hint={t('admin.claims.rejectHint')}>
            {(p) => <textarea {...p} className="input min-h-24" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />}
          </Field>
          {action.error && <ErrorNote>{action.error}</ErrorNote>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn btn-outline" onClick={() => setMode(null)}>
              {t('common.actions.cancel')}
            </button>
            <button type="button" className="btn btn-danger" disabled={action.busy || reason.trim().length < 3} onClick={() => void apply(() => claimsApi.decide(claim.id, { decision: 'REJECT', reason: reason.trim() }))}>
              {t('admin.claims.reject')}
            </button>
          </div>
        </Modal>
      )}
      {mode === 'pay' && (
        <Modal title={t('admin.claims.pay')} onClose={() => setMode(null)}>
          <p>{t('admin.claims.payIntro', { amount: usd(claim.approved), claimant: claim.claimant.name ?? '—' })}</p>
          <Field label={t('admin.finance.channel')}>
            {(p) => (
              <select {...p} className="input" value={channel} onChange={(e) => setChannel(e.target.value)}>
                {['BNCTL', 'BNU', 'MANDIRI', 'BRI', 'MOSAN', 'TPAY', 'CASH'].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            )}
          </Field>
          <Field label={t('admin.finance.reference')} hint={t('admin.claims.payRefHint')}>
            {(p) => <input {...p} className="input font-mono" value={ref} onChange={(e) => setRef(e.target.value)} maxLength={80} />}
          </Field>
          {action.error && <ErrorNote>{action.error}</ErrorNote>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn btn-outline" onClick={() => setMode(null)}>
              {t('common.actions.cancel')}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={action.busy || ref.trim().length < 3}
              onClick={() => void apply(() => withKey(`claim-pay:${claim.id}`, { channel, ref: ref.trim() }, (key) => claimsApi.pay(claim.id, { channel, reference: ref.trim() }, key)))}
            >
              {t('admin.claims.pay')}
            </button>
          </div>
        </Modal>
      )}
    </Modal>
  );
}

/** Claims desk: investigate with the photos side by side, decide, co-approve above the limit, pay from the reserve. */
export function ClaimsTab() {
  const t = useTranslations();
  const { locale } = useLocaleState();
  const [status, setStatus] = useState<string>('');
  const [waybill, setWaybill] = useState('');
  const [open, setOpen] = useState<ClaimDto | null>(null);
  const list = useResource((s) => claimsApi.list({ status: status || undefined, waybill: waybill.trim().toUpperCase() || undefined, limit: 100 }, s), [status, waybill]);

  return (
    <Section title={t('admin.claims.claimsTitle')}>
      <div className="card flex flex-wrap items-end gap-3">
        <Field label={t('common.labels.status')}>
          {(p) => (
            <select {...p} className="input w-52" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">{t('admin.common.all')}</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`admin.state.${s}`)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t('admin.shipments.waybill')}>{(p) => <input {...p} className="input w-72 font-mono" value={waybill} onChange={(e) => setWaybill(e.target.value)} />}</Field>
      </div>
      <Await res={list} empty={(d) => d.length === 0}>
        {(rows) => (
          <DataTable
            caption={t('admin.claims.claimsTitle')}
            head={
              <>
                <th>{t('admin.claims.claimNo')}</th>
                <th>{t('admin.shipments.waybill')}</th>
                <th>{t('admin.claims.typeLabel')}</th>
                <th>{t('admin.claims.requested')}</th>
                <th>{t('admin.claims.approved')}</th>
                <th>{t('common.labels.status')}</th>
                <th>{t('admin.shipments.created')}</th>
              </>
            }
          >
            {rows.map((c) => (
              <tr key={c.id}>
                <td>
                  <button type="button" className="font-mono font-semibold text-brand-700 underline" onClick={() => setOpen(c)}>
                    {c.claimNo}
                  </button>
                </td>
                <td className="font-mono text-xs">{c.waybill}</td>
                <td>{t(`admin.claims.type.${c.type}`)}</td>
                <td>{usd(c.requested)}</td>
                <td>{usd(c.approved)}</td>
                <td>
                  <StateBadge state={c.status} /> {c.needsFinanceApproval && <Badge tone="amber">{t('admin.claims.needsFinance')}</Badge>}
                </td>
                <td>{formatDiliDateTime(c.createdAt, locale)}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Await>
      {open && <ClaimModal initial={open} onClose={() => setOpen(null)} onChanged={list.reload} />}
    </Section>
  );
}
