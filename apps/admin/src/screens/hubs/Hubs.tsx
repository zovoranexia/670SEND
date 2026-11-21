import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { Page, TabPanel, Tabs } from '@/components/ui';
import { useCan } from '@/hooks';
import { BagsTab } from './BagsTab';
import { ManifestsTab } from './ManifestsTab';
import { PickupsTab } from './PickupsTab';
import { ReceiveTab } from './ReceiveTab';

type Tab = 'receive' | 'bags' | 'manifests' | 'pickups';

/** Hub consolidation & manifest dispatch console: receive → master bags → manifests, plus pick-up dispatch. */
export function HubsScreen() {
  const t = useTranslations();
  const can = useCan();
  const tabs = (
    [
      { key: 'receive', label: t('admin.hubs.tabReceive'), show: can('master_bags:manage') },
      { key: 'bags', label: t('admin.hubs.tabBags'), show: can('master_bags:read') },
      { key: 'manifests', label: t('admin.hubs.tabManifests'), show: can('manifests:read') },
      { key: 'pickups', label: t('admin.hubs.tabPickups'), show: can('pickups:read') },
    ] as Array<{ key: Tab; label: string; show: boolean }>
  ).filter((x) => x.show);
  const [tab, setTab] = useState<Tab>(tabs[0]?.key ?? 'bags');
  const active = tabs.some((x) => x.key === tab) ? tab : tabs[0]?.key;

  return (
    <Page title={t('admin.nav.hubs')} subtitle={t('admin.hubs.subtitle')}>
      <Tabs tabs={tabs} active={active as Tab} onChange={setTab} label={t('admin.nav.hubs')} />
      <TabPanel k={active ?? 'bags'}>
        {active === 'receive' && <ReceiveTab />}
        {active === 'bags' && <BagsTab />}
        {active === 'manifests' && <ManifestsTab />}
        {active === 'pickups' && <PickupsTab />}
      </TabPanel>
    </Page>
  );
}
