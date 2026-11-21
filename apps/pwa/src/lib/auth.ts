import { api } from './api';
import { clearDraft } from './intake';
import { printer } from './printer';
import { sessionStore } from './session';

/**
 * Leave this phone: forget the unfinished parcel, drop the printer link and end the session.
 * The server-side revoke is best effort — offline, the refresh token simply expires unused.
 */
export function signOut(refreshToken: string | null, userId: string | undefined) {
  if (userId) clearDraft(userId);
  void api.logout(refreshToken ?? undefined).catch(() => undefined);
  printer.disconnect();
  sessionStore.signOut();
}
