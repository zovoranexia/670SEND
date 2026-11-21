import { lazy, Suspense, type ComponentType } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { useTranslations } from 'use-intl';
import { Shell } from '@/components/Shell';
import { Loading, Page } from '@/components/ui';
import { LocaleProvider } from '@/i18n';
import { signOut } from '@/lib/auth';
import { useSession } from '@/lib/session';
import { canOpen, navFor, NAV, type NavKey } from '@/nav';
import { ChangePasswordScreen } from '@/screens/ChangePassword';
import { LoginScreen } from '@/screens/Login';

/** Every area is its own chunk: opening the console downloads the shell and one screen, not the whole back office. */
function named<K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) {
  return lazy(() => load().then((m) => ({ default: m[name] })));
}
const SCREENS: Record<NavKey, ReturnType<typeof lazy>> = {
  dashboard: named(() => import('@/screens/Dashboard'), 'DashboardScreen'),
  shipments: named(() => import('@/screens/Shipments'), 'ShipmentsScreen'),
  hubs: named(() => import('@/screens/hubs/Hubs'), 'HubsScreen'),
  partners: named(() => import('@/screens/partners/Partners'), 'PartnersScreen'),
  finance: named(() => import('@/screens/finance/Finance'), 'FinanceScreen'),
  claims: named(() => import('@/screens/claims/Claims'), 'ClaimsScreen'),
  tariffs: named(() => import('@/screens/Tariffs'), 'TariffsScreen'),
  templates: named(() => import('@/screens/Templates'), 'TemplatesScreen'),
  rbac: named(() => import('@/screens/access/Access'), 'AccessScreen'),
  audit: named(() => import('@/screens/Audit'), 'AuditScreen'),
};

export function AppRoutes() {
  const { user } = useSession();
  if (!user) {
    return (
      <Routes>
        <Route path="*" element={<LoginScreen />} />
      </Routes>
    );
  }
  // The API blocks everything else until the temporary password is replaced: do not even render the console.
  if (user.mustChangePassword) return <ChangePasswordScreen />;

  const allowed = navFor(user.permissions);
  if (allowed.length === 0) return <NoAccess />;
  const home = allowed[0]!.to;

  return (
    <Routes>
      <Route element={<Shell />}>
        {NAV.map((item) => {
          const Screen = SCREENS[item.key];
          return (
            <Route
              key={item.key}
              path={item.to === '/' ? undefined : `${item.to.slice(1)}/*`}
              index={item.to === '/'}
              element={
                canOpen(user.permissions, item) ? (
                  <Suspense fallback={<Loading />}>
                    <Screen />
                  </Suspense>
                ) : (
                  <Navigate to={home} replace />
                )
              }
            />
          );
        })}
        <Route path="*" element={<Navigate to={home} replace />} />
      </Route>
    </Routes>
  );
}

/** Field accounts (agents, couriers, drivers) and fleet owners sign in elsewhere; this console is for staff. */
function NoAccess() {
  const t = useTranslations();
  const { refreshToken } = useSession();
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5">
      <Page title={t('admin.app.name')}>
        <p className="card text-lg" role="alert">
          {t('admin.app.noAccess')}
        </p>
        <button type="button" className="btn btn-outline w-full" onClick={() => signOut(refreshToken)}>
          {t('admin.nav.signOut')}
        </button>
      </Page>
    </main>
  );
}

/** Providers + routes. The router itself is supplied by the caller (BrowserRouter in the browser, MemoryRouter in tests). */
export function App() {
  return (
    <LocaleProvider>
      <AppRoutes />
    </LocaleProvider>
  );
}
