import { useEffect, useState } from 'react';
import { useTranslations } from 'use-intl';
import { Await, Badge, ConfirmDialog, ErrorNote, Field, Modal, Notice, Section } from '@/components/ui';
import { useAction, useResource } from '@/hooks';
import { accessApi } from '@/lib/endpoints';
import type { PermissionGroup, RoleDto } from '@/lib/types';

/** Permission matrix editor for one role. The API refuses `*:*` and any change to SUPER_ADMIN; the UI does not offer them. */
function Matrix({ role, groups, onSaved, onDeleted }: { role: RoleDto; groups: PermissionGroup[]; onSaved: () => void; onDeleted: () => void }) {
  const t = useTranslations();
  const action = useAction();
  const [picked, setPicked] = useState<Set<string>>(new Set(role.permissions));
  const [name, setName] = useState(role.name);
  const [description, setDescription] = useState(role.description ?? '');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setPicked(new Set(role.permissions));
    setName(role.name);
    setDescription(role.description ?? '');
    setSaved(false);
  }, [role]);

  const locked = role.locked;
  const dirtyPerms = role.permissions.length !== picked.size || role.permissions.some((p) => !picked.has(p));
  const dirtyMeta = name !== role.name || description !== (role.description ?? '');
  const toggle = (key: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  const toggleModule = (g: PermissionGroup, on: boolean) =>
    setPicked((s) => {
      const n = new Set(s);
      for (const p of g.permissions) on ? n.add(p.key) : n.delete(p.key);
      return n;
    });

  return (
    <div className="space-y-4">
      {locked ? <Notice tone="info">{t('admin.access.superLocked')}</Notice> : role.isSystem ? <Notice tone="warn">{t('admin.access.systemRole')}</Notice> : null}
      {!locked && (
        <div className="grid gap-3 md:grid-cols-2">
          <Field label={t('common.labels.name')}>{(p) => <input {...p} className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />}</Field>
          <Field label={t('admin.access.description')} optional>
            {(p) => <input {...p} className="input" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} />}
          </Field>
        </div>
      )}
      <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
        {groups.map((g) => {
          const all = g.permissions.every((p) => picked.has(p.key) || locked);
          return (
            <fieldset key={g.module} className="card space-y-1" disabled={locked}>
              <legend className="sr-only">{g.module}</legend>
              <div className="flex items-center justify-between">
                <h3 className="h2 capitalize">{g.module.replace(/_/g, ' ')}</h3>
                {!locked && (
                  <button type="button" className="text-xs font-semibold text-brand-700 underline" onClick={() => toggleModule(g, !all)}>
                    {all ? t('admin.access.clearModule') : t('admin.access.selectModule')}
                  </button>
                )}
              </div>
              {g.permissions.map((p) => (
                <label key={p.key} className="flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-1" checked={locked || picked.has(p.key)} onChange={() => toggle(p.key)} />
                  <span>
                    <span className="font-mono text-xs">{p.key}</span>
                    {p.description && <span className="block text-slate-600">{p.description}</span>}
                  </span>
                </label>
              ))}
            </fieldset>
          );
        })}
      </div>
      {saved && <Notice tone="ok">{t('admin.access.saved')}</Notice>}
      {action.error && !confirmDelete && <ErrorNote>{action.error}</ErrorNote>}
      {!locked && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn btn-primary"
            disabled={action.busy || (!dirtyPerms && !dirtyMeta) || name.trim().length < 2}
            onClick={async () => {
              const ok = await action.run(async () => {
                if (dirtyMeta) await accessApi.updateRole(role.id, { name: name.trim(), description: description.trim() });
                if (dirtyPerms) await accessApi.setRolePermissions(role.id, [...picked].sort());
              });
              if (ok) {
                setSaved(true);
                onSaved();
              }
            }}
          >
            {t('common.actions.save')}
          </button>
          {!role.isSystem && (
            <button type="button" className="btn btn-ghost" onClick={() => setConfirmDelete(true)} disabled={role.userCount > 0} title={role.userCount > 0 ? t('admin.access.roleInUse') : undefined}>
              {t('admin.access.deleteRole')}
            </button>
          )}
        </div>
      )}
      {confirmDelete && (
        <ConfirmDialog
          title={t('admin.access.deleteRole')}
          message={t('admin.access.deleteIntro', { name: role.name })}
          confirmLabel={t('admin.access.deleteRole')}
          danger
          busy={action.busy}
          error={action.error}
          onClose={() => setConfirmDelete(false)}
          onConfirm={async () => {
            if (await action.run(() => accessApi.deleteRole(role.id))) {
              setConfirmDelete(false);
              onDeleted();
            }
          }}
        />
      )}
    </div>
  );
}

function CreateRole({ groups, onClose, onCreated }: { groups: PermissionGroup[]; onClose: () => void; onCreated: (key: string) => void }) {
  const t = useTranslations();
  const action = useAction();
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [copyFrom, setCopyFrom] = useState('');
  const roles = useResource((s) => accessApi.roles(s), []);
  const keyOk = /^[A-Z][A-Z0-9_]{2,40}$/.test(key);
  void groups;
  return (
    <Modal title={t('admin.access.newRole')} onClose={onClose}>
      <Field label={t('admin.access.roleKey')} hint={t('admin.access.roleKeyHint')} error={key && !keyOk ? t('admin.access.roleKeyHint') : undefined}>
        {(p) => <input {...p} className="input font-mono" value={key} onChange={(e) => setKey(e.target.value.toUpperCase())} maxLength={41} />}
      </Field>
      <Field label={t('common.labels.name')}>{(p) => <input {...p} className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />}</Field>
      <Field label={t('admin.access.description')} optional>
        {(p) => <input {...p} className="input" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} />}
      </Field>
      <Field label={t('admin.access.copyFrom')} hint={t('admin.access.copyFromHint')} optional>
        {(p) => (
          <select {...p} className="input" value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
            <option value="">{t('admin.access.emptyRole')}</option>
            {(roles.data ?? [])
              .filter((r) => !r.locked)
              .map((r) => (
                <option key={r.key} value={r.key}>
                  {r.key}
                </option>
              ))}
          </select>
        )}
      </Field>
      {action.error && <ErrorNote>{action.error}</ErrorNote>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-outline" onClick={onClose}>
          {t('common.actions.cancel')}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={action.busy || !keyOk || name.trim().length < 2}
          onClick={async () => {
            const permissions = roles.data?.find((r) => r.key === copyFrom)?.permissions ?? [];
            if (await action.run(() => accessApi.createRole({ key, name: name.trim(), ...(description.trim() ? { description: description.trim() } : {}), permissions }))) onCreated(key);
          }}
        >
          {t('admin.access.createRole')}
        </button>
      </div>
    </Modal>
  );
}

/** Roles and the permission matrix. */
export function RolesTab() {
  const t = useTranslations();
  const roles = useResource((s) => accessApi.roles(s), []);
  const perms = useResource((s) => accessApi.permissions(s), []);
  const [selected, setSelected] = useState('');
  const [creating, setCreating] = useState(false);
  const current = roles.data?.find((r) => r.key === selected) ?? roles.data?.[0];

  return (
    <Section
      title={t('admin.access.rolesTitle')}
      actions={
        <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
          {t('admin.access.newRole')}
        </button>
      }
    >
      <Await res={roles}>
        {(list) => (
          <Await res={perms}>
            {(groups) => (
              <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
                <nav aria-label={t('admin.access.rolesTitle')} className="card h-fit space-y-1 p-2">
                  {list.map((r) => (
                    <button key={r.key} type="button" aria-current={current?.key === r.key} onClick={() => setSelected(r.key)} className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm ${current?.key === r.key ? 'bg-brand-700 font-semibold text-white' : 'hover:bg-brand-50'}`}>
                      <span className="truncate">{r.key}</span>
                      <span className={`rounded-full px-1.5 text-xs ${current?.key === r.key ? 'bg-brand-900' : 'bg-slate-200'}`}>{r.userCount}</span>
                    </button>
                  ))}
                </nav>
                {current && (
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="h1 text-xl">{current.name}</h3>
                      {current.isSystem && <Badge tone="brand">{t('admin.access.system')}</Badge>}
                      {current.locked && <Badge tone="amber">{t('admin.access.lockedBadge')}</Badge>}
                    </div>
                    <Matrix role={current} groups={groups} onSaved={roles.reload} onDeleted={() => { setSelected(''); roles.reload(); }} />
                  </div>
                )}
              </div>
            )}
          </Await>
        )}
      </Await>
      {creating && (
        <CreateRole
          groups={perms.data ?? []}
          onClose={() => setCreating(false)}
          onCreated={(key) => {
            setCreating(false);
            setSelected(key);
            roles.reload();
          }}
        />
      )}
    </Section>
  );
}
