import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import type { FieldProfile } from '@/lib/types';

/**
 * Where the signed-in user works (kiosk + municipality, courier + hub, driver + fleet). It is cached on the
 * phone so the app can open its screens offline; it is refreshed whenever the app starts online.
 */
const KEY = '670send.profile.';
interface Ctx {
  profile: FieldProfile | null;
  /** True while there is nothing cached and the first load has not finished. */
  loading: boolean;
  /** The user is signed in but has no field profile (back-office account): this app is not for them. */
  notFieldUser: boolean;
}
const ProfileCtx = createContext<Ctx>({ profile: null, loading: false, notFieldUser: false });

function cached(userId: string): FieldProfile | null {
  try {
    const raw = localStorage.getItem(KEY + userId);
    return raw ? (JSON.parse(raw) as FieldProfile) : null;
  } catch {
    return null;
  }
}

export function ProfileProvider({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const userId = user?.id;
  const [profile, setProfile] = useState<FieldProfile | null>(() => (userId ? cached(userId) : null));
  const [loading, setLoading] = useState(Boolean(userId) && !profile);
  const [notFieldUser, setNotField] = useState(false);

  useEffect(() => {
    if (!userId) {
      setProfile(null);
      setLoading(false);
      setNotField(false);
      return;
    }
    const known = cached(userId);
    setProfile(known);
    setLoading(!known);
    setNotField(false);
    const ctl = new AbortController();
    api
      .fieldProfile()
      .then((p) => {
        if (ctl.signal.aborted) return;
        setProfile(p);
        try {
          localStorage.setItem(KEY + userId, JSON.stringify(p));
        } catch {
          /* ignore */
        }
      })
      .catch((e: { status?: number }) => {
        if (!ctl.signal.aborted && e?.status === 403) setNotField(true);
      })
      .finally(() => !ctl.signal.aborted && setLoading(false));
    return () => ctl.abort();
  }, [userId]);

  const value = useMemo(() => ({ profile, loading, notFieldUser }), [profile, loading, notFieldUser]);
  return <ProfileCtx.Provider value={value}>{children}</ProfileCtx.Provider>;
}

export const useProfile = () => useContext(ProfileCtx);
