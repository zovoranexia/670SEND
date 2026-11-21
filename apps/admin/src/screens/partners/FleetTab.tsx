import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { StateBadge } from '@/components/StatusBadge';
import { apiPhone, emptyPerson, PersonFields, personProblems, type Person } from '@/components/PersonFields';
import { Await, Badge, ConfirmDialog, DataTable, ErrorNote, Field, Modal, Section } from '@/components/ui';
import { useAction, useCan, useResource } from '@/hooks';
import { useLocaleState } from '@/i18n';
import { partnersApi, type PartnerCreate } from '@/lib/endpoints';
import { formatDiliDate } from '@/lib/format';
import type { FleetPartnerRow, PartnerStatus } from '@/lib/types';

export const CHANNELS = ['BNCTL', 'BNU', 'MANDIRI', 'BRI', 'MOSAN', 'TPAY'] as const;
export const PARTNER_STATUSES: PartnerStatus[] = ['PENDING', 'ACTIVE', 'SUSPENDED', 'TERMINATED'];

function CreatePartner({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const t = useTranslations();
  const action = useAction();
  const [touched, setTouched] = useState(false);
  const [owner, setOwner] = useState<Person>(emptyPerson());
  const [f, setF] = useState({ companyName: '', serveRegNo: '', mouNumber: '', mouSignedAt: '', mouValidUntil: '', payoutCycle: 'WEEKLY' as 'DAILY' | 'WEEKLY', payoutChannel: 'BNCTL', bank: '', accountName: '', accountNo: '', password: '' });
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));
  const bankFilled = f.bank || f.accountName || f.accountNo;
  const valid = Object.keys(personProblems(owner, false, true)).length === 0 && f.companyName.trim().length >= 3 && (!bankFilled || (f.bank.trim().length >= 2 && f.accountName.trim().length >= 2 && f.accountNo.trim().length >= 4)) && (!f.password || (f.password.length >= 12 && /[A-Za-z]/.test(f.password) && /\d/.test(f.password)));

  async function submit() {
    setTouched(true);
    if (!valid) return;
    const body: PartnerCreate = {
      fullName: owner.fullName.trim(),
      phone: apiPhone(owner.phone),
      ...(owner.email.trim() ? { email: owner.email.trim() } : {}),
      pin: owner.pin,
      preferredLang: owner.preferredLang,
      ...(f.password ? { password: f.password } : {}),
      companyName: f.companyName.trim(),
      ...(f.serveRegNo.trim() ? { serveRegNo: f.serveRegNo.trim() } : {}),
      ...(f.mouNumber.trim() ? { mouNumber: f.mouNumber.trim() } : {}),
      ...(f.mouSignedAt ? { mouSignedAt: f.mouSignedAt } : {}),
      ...(f.mouValidUntil ? { mouValidUntil: f.mouValidUntil } : {}),
      payoutCycle: f.payoutCycle,
      payoutChannel: f.payoutChannel,
      ...(bankFilled ? { bank: { bank: f.bank.trim(), accountName: f.accountName.trim(), accountNo: f.accountNo.trim() } } : {}),
    };
    if (await action.run(() => partnersApi.createPartner(body))) onCreated();
  }

  return (
    <Modal title={t('admin.partners.newFleet')} onClose={onClose} wide>
      <h3 className="h2">{t('admin.partners.company')}</h3>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label={t('admin.partners.companyName')} error={touched && f.companyName.trim().length < 3 ? t('web.form.minChars', { min: 3 }) : undefined}>
          {(p) => <input {...p} className="input" value={f.companyName} onChange={(e) => set('companyName', e.target.value)} />}
        </Field>
        <Field label={t('admin.partners.serveRegNo')} optional>
          {(p) => <input {...p} className="input" value={f.serveRegNo} onChange={(e) => set('serveRegNo', e.target.value)} />}
        </Field>
        <Field label={t('admin.partners.mouNumber')} optional>
          {(p) => <input {...p} className="input" value={f.mouNumber} onChange={(e) => set('mouNumber', e.target.value)} />}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('admin.partners.mouSigned')} optional>
            {(p) => <input {...p} className="input" type="date" value={f.mouSignedAt} onChange={(e) => set('mouSignedAt', e.target.value)} />}
          </Field>
          <Field label={t('admin.partners.mouValidUntil')} optional>
            {(p) => <input {...p} className="input" type="date" value={f.mouValidUntil} onChange={(e) => set('mouValidUntil', e.target.value)} />}
          </Field>
        </div>
        <Field label={t('admin.partners.payoutCycle')}>
          {(p) => (
            <select {...p} className="input" value={f.payoutCycle} onChange={(e) => set('payoutCycle', e.target.value)}>
              <option value="WEEKLY">{t('admin.partners.cycle.WEEKLY')}</option>
              <option value="DAILY">{t('admin.partners.cycle.DAILY')}</option>
            </select>
          )}
        </Field>
        <Field label={t('admin.partners.payoutChannel')}>
          {(p) => (
            <select {...p} className="input" value={f.payoutChannel} onChange={(e) => set('payoutChannel', e.target.value)}>
              {CHANNELS.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <h3 className="h2">{t('admin.partners.bankTitle')}</h3>
      <p className="text-sm text-slate-600">{t('admin.partners.bankIntro')}</p>
      <div className="grid gap-3 md:grid-cols-3">
        <Field label={t('admin.partners.bank')} optional>
          {(p) => <input {...p} className="input" value={f.bank} onChange={(e) => set('bank', e.target.value)} />}
        </Field>
        <Field label={t('admin.partners.accountName')} optional>
          {(p) => <input {...p} className="input" value={f.accountName} onChange={(e) => set('accountName', e.target.value)} />}
        </Field>
        <Field label={t('admin.partners.accountNo')} optional>
          {(p) => <input {...p} className="input" inputMode="numeric" value={f.accountNo} onChange={(e) => set('accountNo', e.target.value)} autoComplete="off" />}
        </Field>
      </div>
      <h3 className="h2">{t('admin.partners.ownerTitle')}</h3>
      <PersonFields value={owner} onChange={setOwner} touched={touched} />
      <Field label={t('admin.partners.ownerPassword')} hint={t('admin.partners.ownerPasswordHint')} optional error={touched && f.password && !(f.password.length >= 12 && /[A-Za-z]/.test(f.password) && /\d/.test(f.password)) ? t('errors.validation.password') : undefined}>
        {(p) => <input {...p} className="input" type="password" autoComplete="new-password" value={f.password} onChange={(e) => set('password', e.target.value)} />}
      </Field>
      {action.error && <ErrorNote>{action.error}</ErrorNote>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-outline" onClick={onClose}>
          {t('common.actions.cancel')}
        </button>
        <button type="button" className="btn btn-primary" disabled={action.busy} onClick={() => void submit()}>
          {t('admin.partners.createFleet')}
        </button>
      </div>
    </Modal>
  );
}

function MouDialog({ partner, onClose, onDone }: { partner: FleetPartnerRow; onClose: () => void; onDone: () => void }) {
  const t = useTranslations();
  const action = useAction();
  const [number, setNumber] = useState(partner.mou.number ?? '');
  const [signed, setSigned] = useState(partner.mou.signedAt ?? '');
  const [until, setUntil] = useState('');
  return (
    <Modal title={`${t('admin.partners.renewMou')} · ${partner.companyName}`} onClose={onClose}>
      <Field label={t('admin.partners.mouNumber')} optional>
        {(p) => <input {...p} className="input" value={number} onChange={(e) => setNumber(e.target.value)} />}
      </Field>
      <Field label={t('admin.partners.mouSigned')} optional>
        {(p) => <input {...p} className="input" type="date" value={signed} onChange={(e) => setSigned(e.target.value)} />}
      </Field>
      <Field label={t('admin.partners.mouValidUntil')}>{(p) => <input {...p} className="input" type="date" value={until} onChange={(e) => setUntil(e.target.value)} />}</Field>
      {action.error && <ErrorNote>{action.error}</ErrorNote>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-outline" onClick={onClose}>
          {t('common.actions.cancel')}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={action.busy || !until}
          onClick={async () => {
            if (await action.run(() => partnersApi.renewMou(partner.id, { ...(number.trim() ? { mouNumber: number.trim() } : {}), ...(signed ? { mouSignedAt: signed } : {}), mouValidUntil: until }))) onDone();
          }}
        >
          {t('admin.partners.renewMou')}
        </button>
      </div>
    </Modal>
  );
}

function BankDialog({ partner, onClose, onDone }: { partner: FleetPartnerRow; onClose: () => void; onDone: () => void }) {
  const t = useTranslations();
  const action = useAction();
  const [bank, setBank] = useState('');
  const [name, setName] = useState('');
  const [no, setNo] = useState('');
  const ok = bank.trim().length >= 2 && name.trim().length >= 2 && no.trim().length >= 4;
  return (
    <Modal title={`${t('admin.partners.bankTitle')} · ${partner.companyName}`} onClose={onClose}>
      <p className="text-sm text-slate-600">{partner.bank ? t('admin.partners.bankCurrent', { bank: partner.bank.bank, last4: partner.bank.accountNoLast4 }) : t('admin.partners.bankNone')}</p>
      <p className="text-sm text-slate-600">{t('admin.partners.bankEncrypted')}</p>
      <Field label={t('admin.partners.bank')}>{(p) => <input {...p} className="input" value={bank} onChange={(e) => setBank(e.target.value)} />}</Field>
      <Field label={t('admin.partners.accountName')}>{(p) => <input {...p} className="input" value={name} onChange={(e) => setName(e.target.value)} />}</Field>
      <Field label={t('admin.partners.accountNo')}>{(p) => <input {...p} className="input" inputMode="numeric" autoComplete="off" value={no} onChange={(e) => setNo(e.target.value)} />}</Field>
      {action.error && <ErrorNote>{action.error}</ErrorNote>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-outline" onClick={onClose}>
          {t('common.actions.cancel')}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={action.busy || !ok}
          onClick={async () => {
            if (await action.run(() => partnersApi.setBank(partner.id, { bank: bank.trim(), accountName: name.trim(), accountNo: no.trim() }))) onDone();
          }}
        >
          {t('common.actions.save')}
        </button>
      </div>
    </Modal>
  );
}

/** Fleet partners under MoU: contract validity, payout set-up, status. */
export function FleetTab() {
  const t = useTranslations();
  const can = useCan();
  const { locale } = useLocaleState();
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const [mou, setMou] = useState<FleetPartnerRow | null>(null);
  const [bank, setBank] = useState<FleetPartnerRow | null>(null);
  const [change, setChange] = useState<{ p: FleetPartnerRow; to: PartnerStatus } | null>(null);
  const action = useAction();
  const list = useResource((s) => partnersApi.fleetPartners({ status: status || undefined, limit: 200 }, s), [status]);
  const manage = can('fleet_partners:manage');

  return (
    <Section
      title={t('admin.partners.fleetTitle')}
      actions={
        manage && (
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
            {t('admin.partners.newFleet')}
          </button>
        )
      }
    >
      <div className="card">
        <Field label={t('common.labels.status')}>
          {(p) => (
            <select {...p} className="input w-56" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">{t('admin.common.all')}</option>
              {PARTNER_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`admin.state.${s}`)}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <Await res={list} empty={(d) => d.length === 0}>
        {(rows) => (
          <DataTable
            caption={t('admin.partners.fleetTitle')}
            head={
              <>
                <th>{t('admin.partners.companyName')}</th>
                <th>{t('common.labels.status')}</th>
                <th>{t('admin.partners.mou')}</th>
                <th>{t('admin.partners.payout')}</th>
                <th>{t('admin.partners.assets')}</th>
                <th>{t('admin.partners.owner')}</th>
                {manage && <th />}
              </>
            }
          >
            {rows.map((p) => (
              <tr key={p.id}>
                <td className="font-semibold">{p.companyName}</td>
                <td>
                  <StateBadge state={p.status} />
                  {p.statusReason && <p className="text-xs text-slate-600">{p.statusReason}</p>}
                </td>
                <td>
                  {p.mou.number ?? '—'}
                  <br />
                  {p.mou.expired ? <Badge tone="red">{t('admin.partners.mouExpired')}</Badge> : <span className="text-xs text-slate-600">{t('admin.partners.until', { date: formatDiliDate(p.mou.validUntil, locale) })}</span>}
                </td>
                <td>
                  {t(`admin.partners.cycle.${p.payoutCycle}`)} · {p.payoutChannel}
                  <br />
                  <span className="text-xs text-slate-600">{p.bank ? `${p.bank.bank} ••••${p.bank.accountNoLast4}` : t('admin.partners.bankNone')}</span>
                </td>
                <td>{t('admin.partners.assetCount', { vehicles: p.vehicleCount, drivers: p.driverCount })}</td>
                <td>
                  {p.owner.fullName}
                  <br />
                  <span className="text-xs text-slate-600">{p.owner.phone}</span>
                </td>
                {manage && (
                  <td className="space-x-1 whitespace-nowrap">
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => setMou(p)}>
                      {t('admin.partners.renewMou')}
                    </button>
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => setBank(p)}>
                      {t('admin.partners.bankTitle')}
                    </button>
                    {p.status !== 'ACTIVE' && p.status !== 'TERMINATED' && (
                      <button type="button" className="btn btn-primary btn-sm" onClick={() => setChange({ p, to: 'ACTIVE' })}>
                        {t('admin.partners.activate')}
                      </button>
                    )}
                    {p.status === 'ACTIVE' && (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setChange({ p, to: 'SUSPENDED' })}>
                        {t('admin.partners.suspend')}
                      </button>
                    )}
                    {p.status !== 'TERMINATED' && (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setChange({ p, to: 'TERMINATED' })}>
                        {t('admin.partners.terminate')}
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </DataTable>
        )}
      </Await>
      {creating && (
        <CreatePartner
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            list.reload();
          }}
        />
      )}
      {mou && (
        <MouDialog
          partner={mou}
          onClose={() => setMou(null)}
          onDone={() => {
            setMou(null);
            list.reload();
          }}
        />
      )}
      {bank && (
        <BankDialog
          partner={bank}
          onClose={() => setBank(null)}
          onDone={() => {
            setBank(null);
            list.reload();
          }}
        />
      )}
      {change && (
        <ConfirmDialog
          title={`${t(`admin.state.${change.to}`)} · ${change.p.companyName}`}
          message={change.to === 'TERMINATED' ? t('admin.partners.terminateWarning') : undefined}
          confirmLabel={t(`admin.state.${change.to}`)}
          danger={change.to !== 'ACTIVE'}
          reasonLabel={change.to === 'ACTIVE' ? undefined : t('admin.partners.statusReason')}
          busy={action.busy}
          error={action.error}
          onClose={() => setChange(null)}
          onConfirm={async (reason) => {
            if (await action.run(() => partnersApi.setPartnerStatus(change.p.id, change.to, reason || undefined))) {
              setChange(null);
              list.reload();
            }
          }}
        />
      )}
    </Section>
  );
}
