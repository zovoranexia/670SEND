import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { Page, TabPanel, Tabs } from '@/components/ui';
import { useCan } from '@/hooks';
import { ClaimsTab } from './ClaimsTab';
import { IncidentsTab } from './IncidentsTab';
import { RtsTab } from './RtsTab';

type Tab = 'claims' | 'incidents' | 'rts';

/** CS & claims desk: claims with side-by-side photo evidence, arrival incidents, return-to-sender. */
export function ClaimsScreen() {
  const t = useTranslations();
  const can = useCan();
  const tabs = (
    [
      { key: 'claims', label: t('admin.claims.tabClaims'), show: can('claims:read') },
      { key: 'incidents', label: t('admin.claims.tabIncidents'), show: can('incidents:read') },
      { key: 'rts', label: t('admin.claims.tabRts'), show: can('rts:manage') },
    ] as Array<{ key: Tab; label: string; show: boolean }>
  ).filter((x) => x.show);
  const [tab, setTab] = useState<Tab>(tabs[0]?.key ?? 'claims');
  const active = (tabs.some((x) => x.key === tab) ? tab : tabs[0]?.key) as Tab;

  return (
    <Page title={t('admin.nav.claims')} subtitle={t('admin.claims.subtitle')}>
      <Tabs tabs={tabs} active={active} onChange={setTab} label={t('admin.nav.claims')} />
      <TabPanel k={active}>
        {active === 'claims' && <ClaimsTab />}
        {active === 'incidents' && <IncidentsTab />}
        {active === 'rts' && <RtsTab />}
      </TabPanel>
    </Page>
  );
}
