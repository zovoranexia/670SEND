import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { Page, TabPanel, Tabs } from '@/components/ui';
import { useCan } from '@/hooks';
import { AlertsTab } from './AlertsTab';
import { AssetsTab } from './AssetsTab';
import { FleetTab } from './FleetTab';
import { NetworkTab } from './NetworkTab';

type Tab = 'fleet' | 'assets' | 'network' | 'alerts';

/** Partner & MoU management: fleet companies, their vehicles and drivers, 670Link agents, couriers, compliance alerts. */
export function PartnersScreen() {
  const t = useTranslations();
  const can = useCan();
  const tabs = (
    [
      { key: 'fleet', label: t('admin.partners.tabFleet'), show: can('fleet_partners:read') },
      { key: 'assets', label: t('admin.partners.tabAssets'), show: can('vehicles:read') || can('drivers:read') },
      { key: 'network', label: t('admin.partners.tabNetwork'), show: can('agents:read') || can('couriers:read') },
      { key: 'alerts', label: t('admin.partners.tabAlerts'), show: can('fleet_partners:read') || can('agents:read') },
    ] as Array<{ key: Tab; label: string; show: boolean }>
  ).filter((x) => x.show);
  const [tab, setTab] = useState<Tab>(tabs[0]?.key ?? 'fleet');
  const active = (tabs.some((x) => x.key === tab) ? tab : tabs[0]?.key) as Tab;

  return (
    <Page title={t('admin.nav.partners')} subtitle={t('admin.partners.subtitle')}>
      <Tabs tabs={tabs} active={active} onChange={setTab} label={t('admin.nav.partners')} />
      <TabPanel k={active}>
        {active === 'fleet' && <FleetTab />}
        {active === 'assets' && <AssetsTab />}
        {active === 'network' && <NetworkTab />}
        {active === 'alerts' && <AlertsTab />}
      </TabPanel>
    </Page>
  );
}
