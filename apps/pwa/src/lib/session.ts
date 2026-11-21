import { useSyncExternalStore } from 'react';
import type { PublicUser } from './types';

/**
 * The signed-in session. The access token (15 min) lives only in memory; the rotating refresh token and the
 * user profile live in localStorage so the app survives a restart without asking for the PIN again.
 * Trade-off (documented): anything in localStorage can be read by script running in this origin — the app
 * ships a strict CSP and no third-party scripts, and refresh tokens are single-use with reuse detection.
 */
const KEY = '670send.session';

export interface StoredSession {
  refreshToken: string;
  user: PublicUser;
}
interface State {
  user: PublicUser | null;
  refreshToken: string | null;
  accessToken: string | null;
  /** Why the session ended, shown once on the login screen. */
  endedBecause: EndReason | null;
}
export type EndReason = 'expired' | 'pin_changed';

function read(): StoredSession | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as StoredSession;
    return s?.refreshToken && s?.user?.id ? s : null;
  } catch {
    return null;
  }
}

const stored = read();
let state: State = { user: stored?.user ?? null, refreshToken: stored?.refreshToken ?? null, accessToken: null, endedBecause: null };
const listeners = new Set<() => void>();

function persist() {
  try {
    if (state.refreshToken && state.user) localStorage.setItem(KEY, JSON.stringify({ refreshToken: state.refreshToken, user: state.user } satisfies StoredSession));
    else localStorage.removeItem(KEY);
  } catch {
    /* private mode / storage full: the session simply will not survive a restart */
  }
}
function set(next: Partial<State>) {
  state = { ...state, ...next };
  persist();
  for (const l of listeners) l();
}

export const sessionStore = {
  get: () => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  signIn(user: PublicUser, tokens: { accessToken: string; refreshToken: string }) {
    set({ user, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, endedBecause: null });
  },
  setTokens(tokens: { accessToken: string; refreshToken: string }) {
    set({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken });
  },
  setUser(user: PublicUser) {
    set({ user });
  },
  signOut(reason: EndReason | null = null) {
    set({ user: null, accessToken: null, refreshToken: null, endedBecause: reason });
  },
  /** Test helper: forget everything including what is in storage. */
  reset() {
    state = { user: null, refreshToken: null, accessToken: null, endedBecause: null };
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
    for (const l of listeners) l();
  },
};

export const useSession = () => useSyncExternalStore(sessionStore.subscribe, sessionStore.get, sessionStore.get);
