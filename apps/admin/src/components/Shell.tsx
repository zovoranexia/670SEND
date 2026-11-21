import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { useTranslations } from 'use-intl';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { IconClose, IconLogout, IconMenu } from '@/components/icons';
import { signOut } from '@/lib/auth';
import { useSession } from '@/lib/session';
import { navFor } from '@/nav';

/** Sidebar (desktop) / drawer (phone and tablet) around the screens. Only the areas the user may open are listed. */
export function Shell() {
  const t = useTranslations();
  const { user, refreshToken } = useSession();
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const items = navFor(user?.permissions ?? []);

  // The drawer closes when a screen is chosen.
  useEffect(() => setOpen(false), [pathname]);

  const nav = (
    <nav aria-label={t('admin.app.navLabel')} className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
      {items.map(({ key, to, Icon }) => (
        <NavLink key={key} to={to} end={to === '/'} className={({ isActive }) => `flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm font-semibold ${isActive ? 'bg-white text-brand-800' : 'text-brand-50 hover:bg-brand-700'}`}>
          <Icon />
          {t(`admin.nav.${key}`)}
        </NavLink>
      ))}
    </nav>
  );

  const account = (
    <div className="space-y-3 border-t border-brand-700 p-3">
      <LanguageSwitcher tone="dark" />
      <div className="text-sm text-brand-50">
        <p className="truncate font-semibold">{user?.fullName}</p>
        <p className="truncate text-xs text-brand-200">{(user?.roles ?? []).map((r) => (t.has(`admin.roles.${r}` as 'admin.roles.SUPER_ADMIN') ? t(`admin.roles.${r}` as 'admin.roles.SUPER_ADMIN') : r)).join(' · ')}</p>
      </div>
      <button type="button" className="btn btn-sm w-full bg-brand-900 text-white hover:bg-black" onClick={() => signOut(refreshToken)}>
        <IconLogout width={16} height={16} />
        {t('admin.nav.signOut')}
      </button>
    </div>
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[16rem_1fr]">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-white focus:p-3">
        {t('admin.app.skipToContent')}
      </a>

      <aside className="hidden flex-col bg-brand-800 lg:sticky lg:top-0 lg:flex lg:h-dvh">
        <div className="flex items-center gap-2 px-5 py-4 text-white">
          <img src="/logo-reversed.svg" alt="670Send" className="h-8" />
          <span className="rounded bg-accent-600 px-1.5 text-xs font-bold">ADMIN</span>
        </div>
        {nav}
        {account}
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="flex items-center justify-between bg-brand-800 px-4 py-2 text-white lg:hidden">
          <button type="button" className="btn btn-sm bg-brand-700 text-white" aria-expanded={open} aria-controls="drawer" onClick={() => setOpen(true)}>
            <IconMenu />
            {t('admin.app.menu')}
          </button>
          <span className="font-bold">{t('admin.app.name')}</span>
        </header>

        {open && (
          <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label={t('admin.app.menu')}>
            <button type="button" className="absolute inset-0 bg-slate-900/50" aria-label={t('common.actions.close')} onClick={() => setOpen(false)} />
            <div id="drawer" className="relative flex h-full w-72 max-w-[85vw] flex-col bg-brand-800">
              <div className="flex items-center justify-between px-5 py-4 text-white">
                <img src="/logo-reversed.svg" alt="670Send" className="h-8" />
                <button type="button" className="btn btn-sm bg-brand-700 text-white" onClick={() => setOpen(false)} aria-label={t('common.actions.close')}>
                  <IconClose />
                </button>
              </div>
              {nav}
              {account}
            </div>
          </div>
        )}

        <main id="main" className="mx-auto w-full max-w-[96rem] flex-1 px-4 py-6 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
