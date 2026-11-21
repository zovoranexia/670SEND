import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { StateBadge } from '@/components/StatusBadge';
import { Await, ConfirmDialog, DataTable, ErrorNote, Field, Loading, Modal, Notice, Section } from '@/components/ui';
import { useAction, useCan, useErrorText, useResource } from '@/hooks';
import { useLocaleState } from '@/i18n';
import { financeApi } from '@/lib/endpoints';
import { formatDiliDateTime, usd } from '@/lib/format';
import { withKey } from '@/lib/idempotency';
import { useSession } from '@/lib/session';
import type { DepositDto, DepositStatus } from '@/lib/types';

const STATUSES: DepositStatus[] = ['PENDING', 'APPROVED', 'REJECTED'];

/** The transfer slip the agent or courier uploaded (a short-lived signed link, fetched only when asked for). */
function ProofModal({ deposit, onClose }: { deposit: DepositDto; onClose: () => void }) {
  const t = useTranslations();
  const errorText = useErrorText();
  const proof = useResource(() => financeApi.depositProof(deposit.id), [deposit.id]);
  return (
    <Modal title={`${deposit.owner.name} · ${usd(deposit.amount)}`} onClose={onClose} wide>
      {proof.loading && <Loading />}
      {proof.error ? <ErrorNote onRetry={proof.reload}>{errorText(proof.error)}</ErrorNote> : null}
      {proof.data && (
        <div className="space-y-2">
          <img src={proof.data.url} alt={t('admin.finance.proofAlt')} className="mx-auto max-h-[60vh] rounded border border-slate-300" referrerPolicy="no-referrer" />
          <p className="text-center text-sm text-slate-600">{t('admin.finance.proofExpires', { seconds: proof.data.expiresIn })}</p>
        </div>
      )}
    </Modal>
  );
}

/** Deposit top-ups waiting for approval. Maker-checker: whoever submitted a request cannot approve it. */
export function DepositsTab() {
  const t = useTranslations();
  const can = useCan();
  const { user } = useSession();
  const { locale } = useLocaleState();
  const [status, setStatus] = useState<string>('PENDING');
  const [proof, setProof] = useState<DepositDto | null>(null);
  const [reject, setReject] = useState<DepositDto | null>(null);
  const [approve, setApprove] = useState<DepositDto | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const action = useAction();
  const list = useResource((s) => financeApi.deposits({ status: status || undefined, limit: 100 }, s), [status]);
  const decide = can('deposits:approve');

  return (
    <Section title={t('admin.finance.depositsTitle')}>
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
        <p className="max-w-xl pb-2 text-sm text-slate-600">{t('admin.finance.makerChecker')}</p>
      </div>
      {done && <Notice tone="ok">{done}</Notice>}
      <Await res={list} empty={(d) => d.length === 0}>
        {(rows) => (
          <DataTable
            caption={t('admin.finance.depositsTitle')}
            head={
              <>
                <th>{t('admin.finance.owner')}</th>
                <th>{t('admin.finance.amount')}</th>
                <th>{t('admin.finance.channel')}</th>
                <th>{t('admin.finance.reference')}</th>
                <th>{t('admin.finance.requestedBy')}</th>
                <th>{t('common.labels.status')}</th>
                <th>{t('common.labels.date')}</th>
                <th />
              </>
            }
          >
            {rows.map((d) => {
              const mine = d.requestedBy === user?.fullName; // the server enforces it by person; this only hides a button that would be refused
              return (
                <tr key={d.id}>
                  <td className="font-semibold">{d.owner.name}</td>
                  <td className="font-bold">{usd(d.amount)}</td>
                  <td>{d.channel}</td>
                  <td className="font-mono">{d.referenceNo ?? '—'}</td>
                  <td>{d.requestedBy}</td>
                  <td>
                    <StateBadge state={d.status} />
                    {d.rejectReason && <p className="max-w-48 text-xs text-slate-600">{d.rejectReason}</p>}
                    {d.reviewedBy && <p className="text-xs text-slate-600">{d.reviewedBy}</p>}
                  </td>
                  <td>{formatDiliDateTime(d.createdAt, locale)}</td>
                  <td className="space-x-1 whitespace-nowrap">
                    {d.hasProof && (
                      <button type="button" className="btn btn-outline btn-sm" onClick={() => setProof(d)}>
                        {t('admin.finance.viewProof')}
                      </button>
                    )}
                    {decide && d.status === 'PENDING' && (
                      <>
                        <button type="button" className="btn btn-primary btn-sm" onClick={() => setApprove(d)} disabled={mine} title={mine ? t('admin.finance.ownRequest') : undefined}>
                          {t('admin.finance.approve')}
                        </button>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setReject(d)}>
                          {t('admin.finance.reject')}
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </DataTable>
        )}
      </Await>
      {proof && <ProofModal deposit={proof} onClose={() => setProof(null)} />}
      {approve && (
        <ConfirmDialog
          title={t('admin.finance.approveDeposit')}
          message={
            <div className="space-y-2">
              <p>{t('admin.finance.approveIntro', { amount: usd(approve.amount), owner: approve.owner.name })}</p>
              {!approve.hasProof && <Notice tone="warn">{t('admin.finance.noProof')}</Notice>}
            </div>
          }
          confirmLabel={t('admin.finance.approve')}
          busy={action.busy}
          error={action.error}
          onClose={() => setApprove(null)}
          onConfirm={async () => {
            if (await action.run(() => withKey(`dep-approve:${approve.id}`, {}, (key) => financeApi.approveDeposit(approve.id, key)))) {
              setApprove(null);
              setDone(t('admin.finance.depositApproved'));
              list.reload();
            }
          }}
        />
      )}
      {reject && (
        <ConfirmDialog
          title={t('admin.finance.rejectDeposit')}
          message={t('admin.finance.rejectIntro', { amount: usd(reject.amount), owner: reject.owner.name })}
          confirmLabel={t('admin.finance.reject')}
          danger
          reasonLabel={t('admin.finance.rejectReason')}
          busy={action.busy}
          error={action.error}
          onClose={() => setReject(null)}
          onConfirm={async (reason) => {
            if (await action.run(() => financeApi.rejectDeposit(reject.id, reason))) {
              setReject(null);
              setDone(t('admin.finance.depositRejected'));
              list.reload();
            }
          }}
        />
      )}
    </Section>
  );
}
