import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { LOCALES, LOCALE_LABELS, type Locale } from '@670send/types';
import { pinSchema, tlPhoneSchema } from '@670send/validation';
import { Await, Badge, ConfirmDialog, DataTable, ErrorNote, Field, Modal, Notice, Section } from '@/components/ui';
import { useAction, useCan, useDebounced, useResource } from '@/hooks';
import { useLocaleState } from '@/i18n';
import { accessApi } from '@/lib/endpoints';
import { formatDiliDateTime } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { RoleDto, UserDto } from '@/lib/types';

/** Field roles are created through the partner directory (they carry a kiosk / vehicle / fleet): never from here. */
const FIELD_ROLES = new Set(['AGENT', 'COURIER', 'FLEET_OWNER', 'DRIVER']);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_OK = (v: string) => v.length >= 12 && /[A-Za-z]/.test(v) && /\d/.test(v);

function RoleChecks({ roles, value, onChange, disabled }: { roles: RoleDto[]; value: string[]; onChange: (v: string[]) => void; disabled?: boolean }) {
  const t = useTranslations();
  const { user } = useSession();
  const mineSuper = user?.roles.includes('SUPER_ADMIN');
  return (
    <fieldset className="space-y-1" disabled={disabled}>
      <legend className="field-label">{t('admin.access.roles')}</legend>
      {roles
        .filter((r) => !FIELD_ROLES.has(r.key))
        .map((r) => {
          const locked = r.key === 'SUPER_ADMIN' && !mineSuper; // only a Super Admin may grant it
          return (
            <label key={r.key} className="flex min-h-9 items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" disabled={locked} checked={value.includes(r.key)} onChange={(e) => onChange(e.target.checked ? [...value, r.key] : value.filter((x) => x !== r.key))} />
              <span>
                <span className="font-semibold">{t.has(`admin.roles.${r.key}` as 'admin.roles.SUPER_ADMIN') ? t(`admin.roles.${r.key}` as 'admin.roles.SUPER_ADMIN') : r.name}</span>
                {r.description && <span className="block text-xs text-slate-600">{r.description}</span>}
              </span>
            </label>
          );
        })}
    </fieldset>
  );
}

function CreateUser({ roles, onClose, onCreated }: { roles: RoleDto[]; onClose: () => void; onCreated: () => void }) {
  const t = useTranslations();
  const action = useAction();
  const [touched, setTouched] = useState(false);
  const [f, setF] = useState({ fullName: '', phone: '', email: '', preferredLang: 'tet' as Locale, password: '' });
  const [picked, setPicked] = useState<string[]>([]);
  const phoneOk = tlPhoneSchema.safeParse(f.phone).success;
  const valid = f.fullName.trim().length >= 3 && phoneOk && EMAIL.test(f.email.trim()) && PASSWORD_OK(f.password) && picked.length >= 1 && picked.length <= 5;
  return (
    <Modal title={t('admin.access.newUser')} onClose={onClose}>
      <Notice tone="info">{t('admin.access.newUserIntro')}</Notice>
      <Field label={t('admin.person.fullName')} error={touched && f.fullName.trim().length < 3 ? t('errors.validation.name') : undefined}>
        {(p) => <input {...p} className="input" value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} autoComplete="off" />}
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('admin.person.email')} error={touched && !EMAIL.test(f.email.trim()) ? t('admin.auth.emailInvalid') : undefined}>
          {(p) => <input {...p} className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} autoComplete="off" />}
        </Field>
        <Field label={t('common.labels.phone')} hint="+670 7712 3456" error={touched && !phoneOk ? t('errors.validation.phone') : undefined}>
          {(p) => <input {...p} className="input" type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} autoComplete="off" />}
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('admin.person.lang')}>
          {(p) => (
            <select {...p} className="input" value={f.preferredLang} onChange={(e) => setF({ ...f, preferredLang: e.target.value as Locale })}>
              {LOCALES.map((l) => (
                <option key={l} value={l}>
                  {LOCALE_LABELS[l].native}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t('admin.access.tempPassword')} hint={t('admin.access.tempPasswordHint')} error={touched && !PASSWORD_OK(f.password) ? t('errors.validation.password') : undefined}>
          {(p) => <input {...p} className="input" type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />}
        </Field>
      </div>
      <RoleChecks roles={roles} value={picked} onChange={setPicked} />
      {touched && picked.length === 0 && <p className="field-error">{t('admin.access.pickRole')}</p>}
      {action.error && <ErrorNote>{action.error}</ErrorNote>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-outline" onClick={onClose}>
          {t('common.actions.cancel')}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={action.busy}
          onClick={async () => {
            setTouched(true);
            if (!valid) return;
            if (await action.run(() => accessApi.createUser({ fullName: f.fullName.trim(), phone: tlPhoneSchema.parse(f.phone), email: f.email.trim().toLowerCase(), preferredLang: f.preferredLang, roles: picked, password: f.password }))) onCreated();
          }}
        >
          {t('admin.access.createUser')}
        </button>
      </div>
    </Modal>
  );
}

function EditRoles({ user, roles, onClose, onSaved }: { user: UserDto; roles: RoleDto[]; onClose: () => void; onSaved: () => void }) {
  const t = useTranslations();
  const action = useAction();
  const [picked, setPicked] = useState(user.roles);
  return (
    <Modal title={`${t('admin.access.editRoles')} · ${user.fullName}`} onClose={onClose}>
      <RoleChecks roles={roles} value={picked} onChange={setPicked} />
      {action.error && <ErrorNote>{action.error}</ErrorNote>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-outline" onClick={onClose}>
          {t('common.actions.cancel')}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={action.busy || picked.length === 0}
          onClick={async () => {
            if (await action.run(() => accessApi.setUserRoles(user.id, picked))) onSaved();
          }}
        >
          {t('common.actions.save')}
        </button>
      </div>
    </Modal>
  );
}

function ResetDialog({ user, onClose, onDone }: { user: UserDto; onClose: () => void; onDone: () => void }) {
  const t = useTranslations();
  const action = useAction();
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const pwOk = !password || PASSWORD_OK(password);
  const pinOk = !pin || pinSchema.safeParse(pin).success;
  const any = !!password || !!pin;
  return (
    <Modal title={`${t('admin.access.resetCreds')} · ${user.fullName}`} onClose={onClose}>
      <Notice tone="warn">{t('admin.access.resetWarning')}</Notice>
      <Field label={t('admin.access.tempPassword')} optional hint={t('admin.access.tempPasswordHint')} error={pwOk ? undefined : t('errors.validation.password')}>
        {(p) => <input {...p} className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
      </Field>
      {user.profile && (
        <Field label={t('admin.person.pin')} optional error={pinOk ? undefined : t('errors.validation.pin_weak')}>
          {(p) => <input {...p} className="input tracking-[0.4em]" inputMode="numeric" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} autoComplete="off" />}
        </Field>
      )}
      {action.error && <ErrorNote>{action.error}</ErrorNote>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-outline" onClick={onClose}>
          {t('common.actions.cancel')}
        </button>
        <button
          type="button"
          className="btn btn-danger"
          disabled={action.busy || !any || !pwOk || !pinOk}
          onClick={async () => {
            if (await action.run(() => accessApi.resetCredentials(user.id, { ...(password ? { password } : {}), ...(pin ? { pin } : {}) }))) onDone();
          }}
        >
          {t('admin.access.resetCreds')}
        </button>
      </div>
    </Modal>
  );
}

/** User accounts (staff and field): roles, activation, lock-outs, credential resets. Guard rails are enforced by the API. */
export function UsersTab() {
  const t = useTranslations();
  const { locale } = useLocaleState();
  const { user: me } = useSession();
  const can = useCan();
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [active, setActive] = useState<'' | 'true' | 'false'>('');
  const debounced = useDebounced(q);
  const [creating, setCreating] = useState(false);
  const [edit, setEdit] = useState<UserDto | null>(null);
  const [reset, setReset] = useState<UserDto | null>(null);
  const [deactivate, setDeactivate] = useState<UserDto | null>(null);
  const action = useAction();
  const roles = useResource((s) => accessApi.roles(s), [], { enabled: can('rbac:manage') });
  const list = useResource((s) => accessApi.users({ q: debounced.trim() || undefined, role: role || undefined, active: active || undefined, limit: 100 }, s), [debounced, role, active]);
  const roleList = roles.data ?? [];

  return (
    <Section
      title={t('admin.access.usersTitle')}
      actions={
        can('rbac:manage') && (
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
            {t('admin.access.newUser')}
          </button>
        )
      }
    >
      <div className="card flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1">
          <Field label={t('admin.shipments.search')} hint={t('admin.access.searchHint')}>
            {(p) => <input {...p} className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} />}
          </Field>
        </div>
        <Field label={t('admin.access.role')}>
          {(p) => (
            <select {...p} className="input w-56" value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="">{t('admin.common.all')}</option>
              {roleList.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.key}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t('common.labels.status')}>
          {(p) => (
            <select {...p} className="input w-44" value={active} onChange={(e) => setActive(e.target.value as '' | 'true' | 'false')}>
              <option value="">{t('admin.common.all')}</option>
              <option value="true">{t('admin.access.activeOnly')}</option>
              <option value="false">{t('admin.access.inactiveOnly')}</option>
            </select>
          )}
        </Field>
      </div>
      {action.error && <ErrorNote>{action.error}</ErrorNote>}
      <Await res={list} empty={(d) => d.length === 0}>
        {(rows) => (
          <DataTable
            caption={t('admin.access.usersTitle')}
            head={
              <>
                <th>{t('common.labels.name')}</th>
                <th>{t('admin.person.email')}</th>
                <th>{t('admin.access.roles')}</th>
                <th>{t('common.labels.status')}</th>
                <th>{t('admin.access.lastLogin')}</th>
                <th />
              </>
            }
          >
            {rows.map((u) => {
              const self = u.id === me?.id;
              return (
                <tr key={u.id}>
                  <td className="font-semibold">
                    {u.fullName}
                    <p className="text-xs font-normal text-slate-600">{u.phone}</p>
                  </td>
                  <td>{u.email ?? '—'}</td>
                  <td className="max-w-56 text-xs">{u.roles.join(', ')}</td>
                  <td className="space-x-1">
                    {u.isActive ? <Badge tone="green">{t('admin.state.ACTIVE')}</Badge> : <Badge tone="slate">{t('admin.partners.inactive')}</Badge>}
                    {u.locked && <Badge tone="red">{t('admin.access.locked')}</Badge>}
                    {u.mustChangePassword && <Badge tone="amber">{t('admin.access.mustChange')}</Badge>}
                    {self && <Badge tone="brand">{t('admin.access.you')}</Badge>}
                  </td>
                  <td>{formatDiliDateTime(u.lastLoginAt, locale) || '—'}</td>
                  <td className="space-x-1 whitespace-nowrap">
                    {can('rbac:manage') && !u.profile && !self && (
                      <button type="button" className="btn btn-outline btn-sm" onClick={() => setEdit(u)}>
                        {t('admin.access.editRoles')}
                      </button>
                    )}
                    {u.locked && (
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        disabled={action.busy}
                        onClick={async () => {
                          if (await action.run(() => accessApi.unlockUser(u.id))) list.reload();
                        }}
                      >
                        {t('admin.access.unlock')}
                      </button>
                    )}
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setReset(u)}>
                      {t('admin.access.resetCreds')}
                    </button>
                    {!self &&
                      (u.isActive ? (
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDeactivate(u)}>
                          {t('admin.access.deactivate')}
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          disabled={action.busy}
                          onClick={async () => {
                            if (await action.run(() => accessApi.activateUser(u.id))) list.reload();
                          }}
                        >
                          {t('admin.access.activate')}
                        </button>
                      ))}
                  </td>
                </tr>
              );
            })}
          </DataTable>
        )}
      </Await>
      {creating && (
        <CreateUser
          roles={roleList}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            list.reload();
          }}
        />
      )}
      {edit && (
        <EditRoles
          user={edit}
          roles={roleList}
          onClose={() => setEdit(null)}
          onSaved={() => {
            setEdit(null);
            list.reload();
          }}
        />
      )}
      {reset && (
        <ResetDialog
          user={reset}
          onClose={() => setReset(null)}
          onDone={() => {
            setReset(null);
            list.reload();
          }}
        />
      )}
      {deactivate && (
        <ConfirmDialog
          title={`${t('admin.access.deactivate')} · ${deactivate.fullName}`}
          message={t('admin.access.deactivateIntro')}
          confirmLabel={t('admin.access.deactivate')}
          danger
          reasonLabel={t('admin.partners.statusReason')}
          busy={action.busy}
          error={action.error}
          onClose={() => setDeactivate(null)}
          onConfirm={async (reason) => {
            if (await action.run(() => accessApi.deactivateUser(deactivate.id, reason))) {
              setDeactivate(null);
              list.reload();
            }
          }}
        />
      )}
    </Section>
  );
}
