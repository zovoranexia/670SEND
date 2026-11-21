import { api } from './api';
import { sessionStore, type EndReason } from './session';

/** Leave this console: end the session. The server-side revoke is best effort — offline, the token simply expires unused. */
export function signOut(refreshToken: string | null, reason: EndReason | null = null) {
  // A password change already revoked every session of this user: nothing left to tell the server.
  if (reason !== 'password_changed') void api.logout(refreshToken ?? undefined).catch(() => undefined);
  sessionStore.signOut(reason);
}
