import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { Page, TabPanel, Tabs } from '@/components/ui';
import { useCan } from '@/hooks';
import { DepositsTab } from './DepositsTab';
import { LedgerTab } from './LedgerTab';
import { PayoutsTab } from './PayoutsTab';
import { ReconTab } from './ReconTab';

type Tab = 'deposits' | 'payouts' | 'ledger' | 'recon';

/** Finance / deposit / fleet-payout centre. Every money action is permission-gated, audited and idempotent. */
export function FinanceScreen() {
  const t = useTranslations();
  const can = useCan();
  const tabs = (
    [
      { key: 'deposits', label: t('admin.finance.tabDeposits'), show: can('deposits:read') },
      { key: 'payouts', label: t('admin.finance.tabPayouts'), show: can('payouts:read') },
      { key: 'ledger', label: t('admin.finance.tabLedger'), show: can('wallets:read_all') || can('ledger:read') },
      { key: 'recon', label: t('admin.finance.tabRecon'), show: can('reconciliation:run') || can('refunds:issue') },
    ] as Array<{ key: Tab; label: string; show: boolean }>
  ).filter((x) => x.show);
  const [tab, setTab] = useState<Tab>(tabs[0]?.key ?? 'deposits');
  const active = (tabs.some((x) => x.key === tab) ? tab : tabs[0]?.key) as Tab;

  return (
    <Page title={t('admin.nav.finance')} subtitle={t('admin.finance.subtitle')}>
      <Tabs tabs={tabs} active={active} onChange={setTab} label={t('admin.nav.finance')} />
      <TabPanel k={active}>
        {active === 'deposits' && <DepositsTab />}
        {active === 'payouts' && <PayoutsTab />}
        {active === 'ledger' && <LedgerTab />}
        {active === 'recon' && <ReconTab />}
      </TabPanel>
    </Page>
  );
}
