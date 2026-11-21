import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { Page, TabPanel, Tabs } from '@/components/ui';
import { useCan } from '@/hooks';
import { RolesTab } from './RolesTab';
import { SettingsTab } from './SettingsTab';
import { UsersTab } from './UsersTab';

type Tab = 'users' | 'roles' | 'settings';

/** RBAC console: user accounts, roles with the permission matrix, and the few editable system settings. */
export function AccessScreen() {
  const t = useTranslations();
  const can = useCan();
  const tabs = (
    [
      { key: 'users', label: t('admin.access.tabUsers'), show: can('users:manage') },
      { key: 'roles', label: t('admin.access.tabRoles'), show: can('rbac:manage') },
      { key: 'settings', label: t('admin.access.tabSettings'), show: can('settings:manage') },
    ] as Array<{ key: Tab; label: string; show: boolean }>
  ).filter((x) => x.show);
  const [tab, setTab] = useState<Tab>(tabs[0]?.key ?? 'users');
  const active = (tabs.some((x) => x.key === tab) ? tab : tabs[0]?.key) as Tab;

  return (
    <Page title={t('admin.nav.rbac')} subtitle={t('admin.access.subtitle')}>
      <Tabs tabs={tabs} active={active} onChange={setTab} label={t('admin.nav.rbac')} />
      <TabPanel k={active}>
        {active === 'users' && <UsersTab />}
        {active === 'roles' && <RolesTab />}
        {active === 'settings' && <SettingsTab />}
      </TabPanel>
    </Page>
  );
}
