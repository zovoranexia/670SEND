import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'use-intl';
import { Await, Badge, DataTable, Empty, ErrorNote, Field, Loading, Modal, Section } from '@/components/ui';
import { useCan, useErrorText, useResource } from '@/hooks';
import { useLocaleState } from '@/i18n';
import { financeApi } from '@/lib/endpoints';
import { diliDayEndIso, diliDayStartIso, diliToday, formatDiliDateTime, usd } from '@/lib/format';
import type { AdminWallet, LedgerRow, StatementEntry } from '@/lib/types';

export const WALLET_TYPES = ['DEPOSIT', 'COMMISSION', 'FLEET_PAYABLE', 'COURIER_EARNINGS', 'PLATFORM_REVENUE', 'PLATFORM_HUB_OPS', 'CLAIM_ESCROW_RESERVE', 'INSURANCE_POOL', 'PENDING_SETTLEMENT', 'EXTERNAL_CLEARING'] as const;
export const OWNER_TYPES = ['AGENT', 'COURIER', 'FLEET_OWNER', 'SYSTEM', 'USER'] as const;
export const REFERENCE_TYPES = ['SHIPMENT_INTAKE', 'ORIGIN_COMMISSION', 'DEST_COMMISSION', 'FLEET_SHARE', 'COURIER_ADDON_SHARE', 'ESCROW_ALLOCATION', 'INSURANCE_PREMIUM', 'STORAGE_PENALTY', 'CLAIM_PAYOUT', 'FLEET_PAYOUT', 'DEPOSIT_TOPUP', 'ADJUSTMENT'] as const;

function Amount({ type, value }: { type: 'CREDIT' | 'DEBIT'; value: string }) {
  return <span className={type === 'CREDIT' ? 'font-semibold text-emerald-800' : 'font-semibold text-red-800'}>{`${type === 'CREDIT' ? '+' : '−'}${usd(value)}`}</span>;
}

/** One wallet's statement, newest first, loaded page by page. */
function StatementModal({ wallet, onClose }: { wallet: AdminWallet; onClose: () => void }) {
  const t = useTranslations();
  const { locale } = useLocaleState();
  const errorText = useErrorText();
  const [rows, setRows] = useState<StatementEntry[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(
    async (before?: string) => {
      setBusy(true);
      setError(null);
      try {
        const page = await financeApi.statement(wallet.id, { before, limit: 50 });
        setRows((r) => (before ? [...r, ...page.entries] : page.entries));
        setNext(page.nextBefore);
      } catch (e) {
        setError(e);
      } finally {
        setBusy(false);
      }
    },
    [wallet.id],
  );
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Modal title={`${wallet.owner} · ${t(`admin.finance.walletType.${wallet.type}` as 'admin.finance.walletType.DEPOSIT')}`} onClose={onClose} wide>
      <p className="text-sm">
        {t('admin.finance.balance')}: <span className="font-bold">{usd(wallet.balance)}</span> · {t('admin.finance.available')}: {usd(wallet.available)}
      </p>
      {error ? <ErrorNote onRetry={() => void load()}>{errorText(error)}</ErrorNote> : null}
      {rows.length === 0 && !busy ? (
        <Empty>{t('admin.common.empty')}</Empty>
      ) : (
        <DataTable
          caption={t('admin.finance.statement')}
          head={
            <>
              <th>{t('common.labels.date')}</th>
              <th>{t('admin.finance.reference')}</th>
              <th>{t('admin.finance.amount')}</th>
              <th>{t('admin.finance.balanceAfter')}</th>
            </>
          }
        >
          {rows.map((e) => (
            <tr key={e.id}>
              <td className="whitespace-nowrap">{formatDiliDateTime(e.at, locale)}</td>
              <td>
                {t(`admin.finance.ref.${e.reference}` as 'admin.finance.ref.ADJUSTMENT')}
                {e.description && <p className="max-w-72 truncate text-xs text-slate-600">{e.description}</p>}
              </td>
              <td className="text-right">
                <Amount type={e.type} value={e.amount} />
              </td>
              <td className="text-right">{usd(e.balanceAfter)}</td>
            </tr>
          ))}
        </DataTable>
      )}
      {busy && <Loading />}
      {next && !busy && (
        <button type="button" className="btn btn-outline" onClick={() => void load(next)}>
          {t('admin.common.loadMore')}
        </button>
      )}
    </Modal>
  );
}

function WalletsSection() {
  const t = useTranslations();
  const [ownerType, setOwnerType] = useState('');
  const [walletType, setWalletType] = useState('');
  const [open, setOpen] = useState<AdminWallet | null>(null);
  const res = useResource((s) => financeApi.wallets({ ownerType: ownerType || undefined, walletType: walletType || undefined, limit: 200 }, s), [ownerType, walletType]);
  return (
    <Section title={t('admin.finance.walletsTitle')}>
      <div className="card flex flex-wrap items-end gap-3">
        <Field label={t('admin.finance.ownerType')}>
          {(p) => (
            <select {...p} className="input w-48" value={ownerType} onChange={(e) => setOwnerType(e.target.value)}>
              <option value="">{t('admin.common.all')}</option>
              {OWNER_TYPES.map((o) => (
                <option key={o} value={o}>
                  {t(`admin.finance.ownerKind.${o}`)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t('admin.finance.walletKind')}>
          {(p) => (
            <select {...p} className="input w-64" value={walletType} onChange={(e) => setWalletType(e.target.value)}>
              <option value="">{t('admin.common.all')}</option>
              {WALLET_TYPES.map((w) => (
                <option key={w} value={w}>
                  {t(`admin.finance.walletType.${w}`)}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <Await res={res} empty={(d) => d.length === 0}>
        {(rows) => (
          <DataTable
            caption={t('admin.finance.walletsTitle')}
            head={
              <>
                <th>{t('admin.finance.owner')}</th>
                <th>{t('admin.finance.walletKind')}</th>
                <th>{t('admin.finance.balance')}</th>
                <th>{t('admin.finance.locked')}</th>
                <th>{t('admin.finance.available')}</th>
              </>
            }
          >
            {rows.map((w) => (
              <tr key={w.id}>
                <td>
                  <button type="button" className="font-semibold text-brand-700 underline" onClick={() => setOpen(w)}>
                    {w.owner}
                  </button>
                </td>
                <td>{t(`admin.finance.walletType.${w.type}` as 'admin.finance.walletType.DEPOSIT')}</td>
                <td className="font-bold">{usd(w.balance)}</td>
                <td>{usd(w.locked)}</td>
                <td>{usd(w.available)}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Await>
      {res.data && res.data.length >= 200 && <p className="text-sm text-amber-800">{t('admin.finance.walletsCapped')}</p>}
      {open && <StatementModal wallet={open} onClose={() => setOpen(null)} />}
    </Section>
  );
}

function LedgerSection() {
  const t = useTranslations();
  const { locale } = useLocaleState();
  const errorText = useErrorText();
  const [from, setFrom] = useState(() => diliToday(-6));
  const [to, setTo] = useState(() => diliToday());
  const [referenceType, setReferenceType] = useState('');
  const [referenceId, setReferenceId] = useState('');
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(
    async (before?: string) => {
      setBusy(true);
      setError(null);
      try {
        const page = await financeApi.ledger({
          from: diliDayStartIso(from),
          to: diliDayEndIso(to),
          referenceType: referenceType || undefined,
          referenceId: referenceId.trim() || undefined,
          before,
          limit: 100,
        });
        setRows((r) => (before ? [...r, ...page] : page));
        setMore(page.length === 100);
      } catch (e) {
        setError(e);
      } finally {
        setBusy(false);
      }
    },
    [from, to, referenceType, referenceId],
  );
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Section title={t('admin.finance.ledgerTitle')}>
      <div className="card flex flex-wrap items-end gap-3">
        <Field label={t('common.labels.from')}>{(p) => <input {...p} className="input w-44" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />}</Field>
        <Field label={t('common.labels.to')}>{(p) => <input {...p} className="input w-44" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />}</Field>
        <Field label={t('admin.finance.reference')}>
          {(p) => (
            <select {...p} className="input w-60" value={referenceType} onChange={(e) => setReferenceType(e.target.value)}>
              <option value="">{t('admin.common.all')}</option>
              {REFERENCE_TYPES.map((r) => (
                <option key={r} value={r}>
                  {t(`admin.finance.ref.${r}`)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t('admin.finance.referenceId')} hint={t('admin.finance.referenceIdHint')}>
          {(p) => <input {...p} className="input w-60" value={referenceId} onChange={(e) => setReferenceId(e.target.value)} maxLength={80} />}
        </Field>
      </div>
      {error ? <ErrorNote onRetry={() => void load()}>{errorText(error)}</ErrorNote> : null}
      {rows.length === 0 && !busy && !error ? (
        <Empty>{t('admin.common.empty')}</Empty>
      ) : (
        <DataTable
          caption={t('admin.finance.ledgerTitle')}
          head={
            <>
              <th>{t('common.labels.date')}</th>
              <th>{t('admin.finance.walletKind')}</th>
              <th>{t('admin.finance.reference')}</th>
              <th>{t('admin.finance.amount')}</th>
              <th>{t('admin.finance.balanceAfter')}</th>
            </>
          }
        >
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="whitespace-nowrap">{formatDiliDateTime(r.at, locale)}</td>
              <td className="font-mono text-xs">{r.wallet}</td>
              <td>
                {t(`admin.finance.ref.${r.reference}` as 'admin.finance.ref.ADJUSTMENT')}
                {r.referenceId && <p className="font-mono text-xs text-slate-600">{r.referenceId}</p>}
              </td>
              <td className="text-right">
                <Amount type={r.type} value={r.amount} />
              </td>
              <td className="text-right">{usd(r.balanceAfter)}</td>
            </tr>
          ))}
        </DataTable>
      )}
      {busy && <Loading />}
      {more && !busy && rows.length > 0 && (
        <button type="button" className="btn btn-outline" onClick={() => void load(rows[rows.length - 1]!.at)}>
          {t('admin.common.loadMore')}
        </button>
      )}
      <Badge tone="slate">{t('admin.finance.immutable')}</Badge>
    </Section>
  );
}

/** Wallets and the immutable double-entry ledger (read only). */
export function LedgerTab() {
  const can = useCan();
  return (
    <div className="space-y-8">
      {can('wallets:read_all') && <WalletsSection />}
      {can('ledger:read') && <LedgerSection />}
    </div>
  );
}
