import { Suspense, useEffect, useState, type ComponentType, type SVGProps } from 'react';
import { NavLink, Outlet } from 'react-router';
import { useTranslations } from 'use-intl';
import { useOnline } from '@/hooks';
import { useSession } from '@/lib/session';
import { usePwaUpdate } from '@/pwa';
import { IconWifiOff } from './icons';
import { Loading } from './ui';

export interface Tab {
  to: string;
  label: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  end?: boolean;
}

/** Offline notice, and a short "back online" confirmation. */
function ConnectionBanner() {
  const t = useTranslations('pwa.app');
  const online = useOnline();
  const [justBack, setJustBack] = useState(false);
  const [wasOffline, setWasOffline] = useState(false);
  useEffect(() => {
    if (!online) return setWasOffline(true);
    if (!wasOffline) return;
    setJustBack(true);
    const id = setTimeout(() => (setJustBack(false), setWasOffline(false)), 3000);
    return () => clearTimeout(id);
  }, [online, wasOffline]);

  if (online && !justBack) return null;
  return (
    <div className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold ${online ? 'bg-emerald-700 text-white' : 'bg-amber-200 text-amber-950'}`} role="status">
      {!online && <IconWifiOff width={18} height={18} />}
      {online ? t('online') : t('offline')}
    </div>
  );
}

function UpdateBanner() {
  const t = useTranslations('pwa.app');
  const { needRefresh, applyUpdate } = usePwaUpdate();
  if (!needRefresh) return null;
  return (
    <div className="flex items-center justify-between gap-3 bg-brand-100 px-4 py-2 text-brand-900" role="status">
      <span className="text-sm font-semibold">{t('updateReady')}</span>
      <button type="button" onClick={applyUpdate} className="min-h-11 rounded-lg bg-brand-700 px-4 text-sm font-bold text-white">
        {t('updateNow')}
      </button>
    </div>
  );
}

/** Header, connection / update banners, the screen, and the bottom tab bar of the signed-in role. */
export function Shell({ tabs, subtitle }: { tabs: Tab[]; subtitle: string }) {
  const t = useTranslations('pwa');
  const { user } = useSession();
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 bg-brand-700 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] text-white">
        <div className="mx-auto flex max-w-xl items-center justify-between gap-3">
          <img src="/favicon.svg" alt="" width={36} height={36} className="h-9 w-9 shrink-0 rounded-lg" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-bold leading-tight">{user?.fullName}</p>
            <p className="truncate text-sm leading-tight text-brand-100">{subtitle}</p>
          </div>
        </div>
      </header>
      <ConnectionBanner />
      <UpdateBanner />
      <main id="main" className="flex-1" tabIndex={-1}>
        <Suspense fallback={<Loading />}>
          <Outlet />
        </Suspense>
      </main>
      <nav aria-label={t('app.name')} className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-300 bg-white pb-[env(safe-area-inset-bottom)]">
        <ul className="mx-auto flex max-w-xl">
          {tabs.map(({ to, label, Icon, end }) => (
            <li key={to} className="flex-1">
              <NavLink
                to={to}
                {...(end ? { end: true } : {})}
                className={({ isActive }) => `flex min-h-16 flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-center text-xs font-semibold ${isActive ? 'text-brand-700' : 'text-slate-600'}`}
              >
                {({ isActive }) => (
                  <>
                    <span className={`flex h-8 w-14 items-center justify-center rounded-full ${isActive ? 'bg-brand-100' : ''}`}>
                      <Icon width={22} height={22} />
                    </span>
                    <span className="max-w-full truncate">{label}</span>
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
