import { Link } from 'react-router';
import { useTranslations } from 'use-intl';
import { IconHandover, IconInbound, IconList, IconPackage, IconWallet } from '@/components/icons';
import { ErrorNote, Notice, Page } from '@/components/ui';
import { useErrorText, useResource } from '@/hooks';
import { api } from '@/lib/api';
import { usd } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useProfile } from '@/profile';

const LOW_DEPOSIT = 10;

/** Kiosk agent home: float at a glance and the five things an agent does all day. */
export function AgentHome() {
  const t = useTranslations();
  const errorText = useErrorText();
  const { user } = useSession();
  const { profile } = useProfile();
  const wallets = useResource(() => api.wallets(), []);
  const deposit = wallets.data?.find((w) => w.type === 'DEPOSIT');
  const commission = wallets.data?.find((w) => w.type === 'COMMISSION');
  const low = deposit && Number(deposit.available) < LOW_DEPOSIT;

  const tiles = [
    { to: '/receive', label: t('pwa.nav.dropoff'), Icon: IconPackage, primary: true },
    { to: '/inbound', label: t('pwa.nav.inbound'), Icon: IconInbound },
    { to: '/handover', label: t('pwa.nav.pickup'), Icon: IconHandover },
    { to: '/parcels', label: t('pwa.parcels.title'), Icon: IconList },
    { to: '/wallet', label: t('pwa.wallet.title'), Icon: IconWallet },
  ];

  return (
    <Page title={t('pwa.home.hello', { name: user?.fullName.split(' ')[0] ?? '' })}>
      {profile?.kind === 'AGENT' && (
        <p className="-mt-2 text-slate-600">
          {profile.kioskName}
          {profile.openingHours ? ` · ${profile.openingHours}` : ''}
        </p>
      )}
      {wallets.error ? <ErrorNote onRetry={wallets.reload}>{errorText(wallets.error)}</ErrorNote> : null}
      <div className="grid grid-cols-2 gap-3">
        <div className="card">
          <p className="text-sm font-semibold text-slate-600">{t('pwa.home.deposit')}</p>
          <p className={`text-2xl font-extrabold ${low ? 'text-accent-700' : 'text-brand-800'}`} data-testid="deposit">
            {deposit ? usd(deposit.balance) : '—'}
          </p>
        </div>
        <div className="card">
          <p className="text-sm font-semibold text-slate-600">{t('pwa.home.commission')}</p>
          <p className="text-2xl font-extrabold text-brand-800">{commission ? usd(commission.balance) : '—'}</p>
        </div>
      </div>
      {low && (
        <Notice tone="warn">
          {t('pwa.home.lowDeposit')}{' '}
          <Link to="/wallet" className="font-bold underline">
            {t('pwa.wallet.topUp')}
          </Link>
        </Notice>
      )}
      <h2 className="h2 pt-2">{t('pwa.home.actions')}</h2>
      <div className="grid grid-cols-2 gap-3">
        {tiles.map(({ to, label, Icon, primary }) => (
          <Link key={to} to={to} className={`flex min-h-28 flex-col items-center justify-center gap-2 rounded-2xl p-3 text-center font-bold ${primary ? 'col-span-2 bg-accent-600 text-white' : 'border border-slate-200 bg-white text-brand-800 shadow-sm'}`}>
            <Icon width={primary ? 34 : 30} height={primary ? 34 : 30} />
            {label}
          </Link>
        ))}
      </div>
    </Page>
  );
}
