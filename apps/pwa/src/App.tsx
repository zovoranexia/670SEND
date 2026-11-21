import { lazy, type ComponentType } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { useTranslations } from 'use-intl';
import { Shell, type Tab } from '@/components/Shell';
import { IconBus, IconHandover, IconHome, IconInbound, IconPackage, IconTruck, IconUser } from '@/components/icons';
import { Loading, Page } from '@/components/ui';
import { LocaleProvider } from '@/i18n';
import { signOut } from '@/lib/auth';
import { useSession } from '@/lib/session';
import { ProfileProvider, useProfile } from '@/profile';
import { CourierJobs } from '@/screens/courier/Jobs';
import { TripsScreen } from '@/screens/driver/Trips';
import { AgentHome } from '@/screens/Home';
import { LoginScreen } from '@/screens/Login';

/** Screens used less often load on demand: the first start only downloads what the role's home screen needs. */
function named<K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) {
  return lazy(() => load().then((m) => ({ default: m[name] })));
}
const ReceiveScreen = named(() => import('@/screens/receive/ReceiveWizard'), 'ReceiveScreen');
const InboundScreen = named(() => import('@/screens/Inbound'), 'InboundScreen');
const HandoverScreen = named(() => import('@/screens/Handover'), 'HandoverScreen');
const ParcelsScreen = named(() => import('@/screens/Parcels'), 'ParcelsScreen');
const ParcelDetailScreen = named(() => import('@/screens/Parcels'), 'ParcelDetailScreen');
const WalletScreen = named(() => import('@/screens/Wallet'), 'WalletScreen');
const ProfileScreen = named(() => import('@/screens/Profile'), 'ProfileScreen');
const HubHandoverScreen = named(() => import('@/screens/courier/HubHandover'), 'HubHandoverScreen');
const TripScreen = named(() => import('@/screens/driver/Trips'), 'TripScreen');

type Kind = 'AGENT' | 'COURIER' | 'DRIVER' | null;

/** One app, three working modes: the screens and tabs follow the roles of the signed-in user. */
export function roleKind(roles: readonly string[]): Kind {
  if (roles.includes('AGENT')) return 'AGENT';
  if (roles.includes('COURIER')) return 'COURIER';
  if (roles.includes('DRIVER')) return 'DRIVER';
  return null;
}

export function AppRoutes() {
  const { user } = useSession();
  if (!user) {
    return (
      <Routes>
        <Route path="*" element={<LoginScreen />} />
      </Routes>
    );
  }
  const kind = roleKind(user.roles);
  if (!kind) return <Unsupported />;
  return <Signed kind={kind} />;
}

function Signed({ kind }: { kind: Exclude<Kind, null> }) {
  const t = useTranslations();
  const { profile, loading, notFieldUser } = useProfile();
  if (notFieldUser) return <Unsupported />;

  const subtitle =
    profile?.kind === 'AGENT' ? profile.kioskName : profile?.kind === 'COURIER' ? `${t('pwa.app.roles.COURIER')} · ${profile.municipality.name}` : profile?.kind === 'DRIVER' ? profile.fleetPartner.companyName : t(`pwa.app.roles.${kind}`);

  const profileTab: Tab = { to: '/profile', label: t('pwa.nav.profile'), Icon: IconUser };
  const tabs: Tab[] =
    kind === 'AGENT'
      ? [
          { to: '/', label: t('pwa.nav.home'), Icon: IconHome, end: true },
          { to: '/receive', label: t('pwa.nav.dropoff'), Icon: IconPackage },
          { to: '/inbound', label: t('pwa.nav.inbound'), Icon: IconInbound },
          { to: '/handover', label: t('pwa.nav.pickup'), Icon: IconHandover },
          profileTab,
        ]
      : kind === 'COURIER'
        ? [
            { to: '/', label: t('pwa.nav.jobs'), Icon: IconTruck, end: true },
            { to: '/receive', label: t('pwa.nav.dropoff'), Icon: IconPackage },
            { to: '/hub', label: t('pwa.nav.handover'), Icon: IconInbound },
            profileTab,
          ]
        : [{ to: '/', label: t('pwa.driver.trips'), Icon: IconBus, end: true }, profileTab];

  if (loading && !profile) return <Loading />;

  return (
    <Routes>
      <Route element={<Shell tabs={tabs} subtitle={subtitle} />}>
        {kind === 'AGENT' && (
          <>
            <Route index element={<AgentHome />} />
            <Route path="receive" element={<ReceiveScreen />} />
            <Route path="inbound" element={<InboundScreen />} />
            <Route path="handover" element={<HandoverScreen />} />
            <Route path="parcels" element={<ParcelsScreen />} />
            <Route path="parcels/:waybill" element={<ParcelDetailScreen />} />
            <Route path="wallet" element={<WalletScreen />} />
          </>
        )}
        {kind === 'COURIER' && (
          <>
            <Route index element={<CourierJobs />} />
            <Route path="receive" element={<ReceiveScreen />} />
            <Route path="deliver/:waybill" element={<HandoverScreen />} />
            <Route path="hub" element={<HubHandoverScreen />} />
            <Route path="parcels" element={<ParcelsScreen />} />
            <Route path="parcels/:waybill" element={<ParcelDetailScreen />} />
            <Route path="wallet" element={<WalletScreen />} />
          </>
        )}
        {kind === 'DRIVER' && (
          <>
            <Route index element={<TripsScreen />} />
            <Route path="trips/:code" element={<TripScreen />} />
          </>
        )}
        <Route path="profile" element={<ProfileScreen />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

/** Fleet owners and back-office staff can sign in with a PIN / password elsewhere; this app is for the field. */
function Unsupported() {
  const t = useTranslations();
  const { user, refreshToken } = useSession();
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5">
      <Page title={t('pwa.app.name')}>
        <p className="card text-lg" role="alert">
          {t('pwa.app.unsupportedRole')}
        </p>
        <button type="button" className="btn btn-outline w-full" onClick={() => signOut(refreshToken, user?.id)}>
          {t('pwa.auth.signOut')}
        </button>
      </Page>
    </main>
  );
}

/** Providers + routes. The router itself is supplied by the caller (BrowserRouter in the browser, MemoryRouter in tests). */
export function App() {
  return (
    <LocaleProvider>
      <ProfileProvider>
        <AppRoutes />
      </ProfileProvider>
    </LocaleProvider>
  );
}
