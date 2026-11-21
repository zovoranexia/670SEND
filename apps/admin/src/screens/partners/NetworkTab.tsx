import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { HUBS, MUNICIPALITIES } from '@670send/types';
import { StateBadge } from '@/components/StatusBadge';
import { apiPhone, emptyPerson, PersonFields, personProblems, type Person } from '@/components/PersonFields';
import { Await, Badge, ConfirmDialog, DataTable, ErrorNote, Field, Modal, Section } from '@/components/ui';
import { useAction, useCan, useResource } from '@/hooks';
import { useLocaleState } from '@/i18n';
import { partnersApi } from '@/lib/endpoints';
import { formatDiliDate, usd } from '@/lib/format';
import type { AgentRow, CourierRow, PartnerStatus } from '@/lib/types';
import { PARTNER_STATUSES } from './FleetTab';

function MunicipalitySelect({ value, onChange, all }: { value: string; onChange: (v: string) => void; all?: boolean }) {
  const t = useTranslations();
  return (
    <Field label={t('admin.partners.municipality')}>
      {(p) => (
        <select {...p} className="input w-56" value={value} onChange={(e) => onChange(e.target.value)}>
          {all && <option value="">{t('admin.common.all')}</option>}
          {MUNICIPALITIES.map((m) => (
            <option key={m.code} value={m.code}>
              {m.name}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

function CreateAgent({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const t = useTranslations();
  const action = useAction();
  const [touched, setTouched] = useState(false);
  const [person, setPerson] = useState<Person>(emptyPerson());
  const [f, setF] = useState({ municipalityCode: 'DIL', kioskName: '', address: '', openingHours: '', hasDigitalScale: false, hasSecureStorage: false, external: '' });
  const valid = Object.keys(personProblems(person)).length === 0 && f.kioskName.trim().length >= 3 && f.address.trim().length >= 3;
  async function submit() {
    setTouched(true);
    if (!valid) return;
    const body = {
      fullName: person.fullName.trim(),
      phone: apiPhone(person.phone),
      ...(person.email.trim() ? { email: person.email.trim() } : {}),
      pin: person.pin,
      preferredLang: person.preferredLang,
      municipalityCode: f.municipalityCode,
      kioskName: f.kioskName.trim(),
      address: f.address.trim(),
      ...(f.openingHours.trim() ? { openingHours: f.openingHours.trim() } : {}),
      hasDigitalScale: f.hasDigitalScale,
      hasSecureStorage: f.hasSecureStorage,
      ...(f.external.trim() ? { external670LinkAgentId: f.external.trim() } : {}),
    };
    if (await action.run(() => partnersApi.createAgent(body))) onCreated();
  }
  return (
    <Modal title={t('admin.partners.newAgent')} onClose={onClose} wide>
      <h3 className="h2">{t('admin.partners.kiosk')}</h3>
      <div className="grid gap-3 md:grid-cols-2">
        <MunicipalitySelect value={f.municipalityCode} onChange={(v) => setF({ ...f, municipalityCode: v })} />
        <Field label={t('admin.partners.kioskName')} error={touched && f.kioskName.trim().length < 3 ? t('web.form.minChars', { min: 3 }) : undefined}>
          {(p) => <input {...p} className="input" value={f.kioskName} onChange={(e) => setF({ ...f, kioskName: e.target.value })} />}
        </Field>
        <Field label={t('common.labels.address')} error={touched && f.address.trim().length < 3 ? t('web.form.minChars', { min: 3 }) : undefined}>
          {(p) => <input {...p} className="input" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} />}
        </Field>
        <Field label={t('admin.partners.openingHours')} optional>
          {(p) => <input {...p} className="input" value={f.openingHours} placeholder="08:00-18:00" onChange={(e) => setF({ ...f, openingHours: e.target.value })} />}
        </Field>
        <Field label={t('admin.partners.link670')} hint={t('admin.partners.link670Hint')} optional>
          {(p) => <input {...p} className="input" value={f.external} onChange={(e) => setF({ ...f, external: e.target.value })} />}
        </Field>
        <div className="space-y-1 pt-6">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.hasDigitalScale} onChange={(e) => setF({ ...f, hasDigitalScale: e.target.checked })} />
            {t('admin.partners.hasScale')}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.hasSecureStorage} onChange={(e) => setF({ ...f, hasSecureStorage: e.target.checked })} />
            {t('admin.partners.hasStorage')}
          </label>
        </div>
      </div>
      <h3 className="h2">{t('admin.partners.operator')}</h3>
      <PersonFields value={person} onChange={setPerson} touched={touched} />
      {action.error && <ErrorNote>{action.error}</ErrorNote>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-outline" onClick={onClose}>
          {t('common.actions.cancel')}
        </button>
        <button type="button" className="btn btn-primary" disabled={action.busy} onClick={() => void submit()}>
          {t('admin.partners.createAgent')}
        </button>
      </div>
    </Modal>
  );
}

function CreateCourier({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const t = useTranslations();
  const action = useAction();
  const [touched, setTouched] = useState(false);
  const [person, setPerson] = useState<Person>(emptyPerson());
  const [f, setF] = useState({ municipalityCode: 'DIL', hubCode: '', vehicleType: 'MOTORBIKE' as 'MOTORBIKE' | 'PICKUP', plateNumber: '' });
  const valid = Object.keys(personProblems(person)).length === 0;
  async function submit() {
    setTouched(true);
    if (!valid) return;
    const body = {
      fullName: person.fullName.trim(),
      phone: apiPhone(person.phone),
      ...(person.email.trim() ? { email: person.email.trim() } : {}),
      pin: person.pin,
      preferredLang: person.preferredLang,
      municipalityCode: f.municipalityCode,
      ...(f.hubCode ? { hubCode: f.hubCode } : {}),
      vehicleType: f.vehicleType,
      ...(f.plateNumber.trim() ? { plateNumber: f.plateNumber.trim() } : {}),
    };
    if (await action.run(() => partnersApi.createCourier(body))) onCreated();
  }
  return (
    <Modal title={t('admin.partners.newCourier')} onClose={onClose} wide>
      <div className="grid gap-3 md:grid-cols-2">
        <MunicipalitySelect value={f.municipalityCode} onChange={(v) => setF({ ...f, municipalityCode: v })} />
        <Field label={t('admin.hubs.hub')} optional>
          {(p) => (
            <select {...p} className="input" value={f.hubCode} onChange={(e) => setF({ ...f, hubCode: e.target.value })}>
              <option value="">—</option>
              {HUBS.map((h) => (
                <option key={h.code} value={h.code}>
                  {h.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t('admin.partners.courierVehicle')}>
          {(p) => (
            <select {...p} className="input" value={f.vehicleType} onChange={(e) => setF({ ...f, vehicleType: e.target.value as 'MOTORBIKE' | 'PICKUP' })}>
              <option value="MOTORBIKE">{t('admin.partners.cv.MOTORBIKE')}</option>
              <option value="PICKUP">{t('admin.partners.cv.PICKUP')}</option>
            </select>
          )}
        </Field>
        <Field label={t('admin.partners.plate')} optional>
          {(p) => <input {...p} className="input" value={f.plateNumber} onChange={(e) => setF({ ...f, plateNumber: e.target.value })} />}
        </Field>
      </div>
      <PersonFields value={person} onChange={setPerson} touched={touched} />
      {action.error && <ErrorNote>{action.error}</ErrorNote>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-outline" onClick={onClose}>
          {t('common.actions.cancel')}
        </button>
        <button type="button" className="btn btn-primary" disabled={action.busy} onClick={() => void submit()}>
          {t('admin.partners.createCourier')}
        </button>
      </div>
    </Modal>
  );
}

function AgentsSection() {
  const t = useTranslations();
  const can = useCan();
  const { locale } = useLocaleState();
  const [status, setStatus] = useState('');
  const [muni, setMuni] = useState('');
  const [creating, setCreating] = useState(false);
  const [change, setChange] = useState<{ a: AgentRow; to: PartnerStatus } | null>(null);
  const action = useAction();
  const list = useResource((s) => partnersApi.agents({ status: status || undefined, municipalityCode: muni || undefined, limit: 200 }, s), [status, muni]);
  const manage = can('agents:manage');
  return (
    <Section
      title={t('admin.partners.agentsTitle')}
      actions={
        manage && (
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
            {t('admin.partners.newAgent')}
          </button>
        )
      }
    >
      <div className="card flex flex-wrap items-end gap-3">
        <MunicipalitySelect value={muni} onChange={setMuni} all />
        <Field label={t('common.labels.status')}>
          {(p) => (
            <select {...p} className="input w-48" value={status} onChange={(e) => setStatus(e.target.value)}>
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
      {action.error && <ErrorNote>{action.error}</ErrorNote>}
      <Await res={list} empty={(d) => d.length === 0}>
        {(rows) => (
          <DataTable
            caption={t('admin.partners.agentsTitle')}
            head={
              <>
                <th>{t('admin.partners.code')}</th>
                <th>{t('admin.partners.kioskName')}</th>
                <th>{t('admin.partners.municipality')}</th>
                <th>{t('common.labels.status')}</th>
                <th>{t('admin.partners.addendum')}</th>
                <th>{t('admin.partners.deposit')}</th>
                <th>{t('admin.partners.operator')}</th>
                {manage && <th />}
              </>
            }
          >
            {rows.map((a) => (
              <tr key={a.id}>
                <td className="font-mono">{a.agentCode}</td>
                <td className="font-semibold">{a.kioskName}</td>
                <td>{a.municipality.name}</td>
                <td>
                  <StateBadge state={a.status} />
                </td>
                <td>{a.adendumSignedAt ? formatDiliDate(a.adendumSignedAt, locale) : <Badge tone="amber">{t('admin.partners.missing')}</Badge>}</td>
                <td className={Number(a.depositBalance) < 10 ? 'font-bold text-red-700' : ''}>{usd(a.depositBalance)}</td>
                <td>
                  {a.operator.fullName}
                  <br />
                  <span className="text-xs text-slate-600">{a.operator.phone}</span>
                </td>
                {manage && (
                  <td className="space-x-1 whitespace-nowrap">
                    {!a.adendumSignedAt && (
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        disabled={action.busy}
                        onClick={async () => {
                          if (await action.run(() => partnersApi.signAdendum(a.id))) list.reload();
                        }}
                      >
                        {t('admin.partners.signAddendum')}
                      </button>
                    )}
                    {a.status !== 'ACTIVE' && a.status !== 'TERMINATED' && (
                      <button type="button" className="btn btn-primary btn-sm" onClick={() => setChange({ a, to: 'ACTIVE' })}>
                        {t('admin.partners.activate')}
                      </button>
                    )}
                    {a.status === 'ACTIVE' && (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setChange({ a, to: 'SUSPENDED' })}>
                        {t('admin.partners.suspend')}
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
        <CreateAgent
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            list.reload();
          }}
        />
      )}
      {change && (
        <ConfirmDialog
          title={`${t(`admin.state.${change.to}`)} · ${change.a.kioskName}`}
          confirmLabel={t(`admin.state.${change.to}`)}
          danger={change.to !== 'ACTIVE'}
          reasonLabel={change.to === 'ACTIVE' ? undefined : t('admin.partners.statusReason')}
          busy={action.busy}
          error={action.error}
          onClose={() => setChange(null)}
          onConfirm={async (reason) => {
            if (await action.run(() => partnersApi.setAgentStatus(change.a.id, change.to, reason || undefined))) {
              setChange(null);
              list.reload();
            }
          }}
        />
      )}
    </Section>
  );
}

function CouriersSection() {
  const t = useTranslations();
  const can = useCan();
  const [muni, setMuni] = useState('');
  const [creating, setCreating] = useState(false);
  const action = useAction();
  const list = useResource((s) => partnersApi.couriers({ municipalityCode: muni || undefined, limit: 200 }, s), [muni]);
  const manage = can('couriers:manage');
  return (
    <Section
      title={t('admin.partners.couriersTitle')}
      actions={
        manage && (
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
            {t('admin.partners.newCourier')}
          </button>
        )
      }
    >
      <div className="card">
        <MunicipalitySelect value={muni} onChange={setMuni} all />
      </div>
      {action.error && <ErrorNote>{action.error}</ErrorNote>}
      <Await res={list} empty={(d) => d.length === 0}>
        {(rows: CourierRow[]) => (
          <DataTable
            caption={t('admin.partners.couriersTitle')}
            head={
              <>
                <th>{t('common.labels.name')}</th>
                <th>{t('common.labels.phone')}</th>
                <th>{t('admin.partners.municipality')}</th>
                <th>{t('admin.partners.courierVehicle')}</th>
                <th>{t('common.labels.status')}</th>
                <th>{t('admin.partners.deposit')}</th>
                <th>{t('admin.partners.earnings')}</th>
                {manage && <th />}
              </>
            }
          >
            {rows.map((c) => (
              <tr key={c.id}>
                <td className="font-semibold">{c.name}</td>
                <td>{c.phone}</td>
                <td>{c.municipality.name}</td>
                <td>
                  {t(`admin.partners.cv.${c.vehicleType}` as 'admin.partners.cv.MOTORBIKE')} {c.plateNumber ?? ''}
                </td>
                <td>
                  <StateBadge state={c.status} /> {c.status === 'ACTIVE' && (c.isAvailable ? <Badge tone="green">{t('admin.partners.available')}</Badge> : <Badge tone="slate">{t('admin.partners.unavailable')}</Badge>)}
                </td>
                <td>{usd(c.depositBalance)}</td>
                <td>{usd(c.earningsBalance)}</td>
                {manage && (
                  <td className="space-x-1 whitespace-nowrap">
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      disabled={action.busy}
                      onClick={async () => {
                        if (await action.run(() => partnersApi.updateCourier(c.id, { status: c.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE' }))) list.reload();
                      }}
                    >
                      {c.status === 'ACTIVE' ? t('admin.partners.suspend') : t('admin.partners.activate')}
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </DataTable>
        )}
      </Await>
      {creating && (
        <CreateCourier
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            list.reload();
          }}
        />
      )}
    </Section>
  );
}

export function NetworkTab() {
  const can = useCan();
  return (
    <div className="space-y-8">
      {can('agents:read') && <AgentsSection />}
      {can('couriers:read') && <CouriersSection />}
    </div>
  );
}
