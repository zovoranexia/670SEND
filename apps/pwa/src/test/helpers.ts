import type { Locale } from '@670send/types';
import { sessionStore } from '@/lib/session';
import type { PublicUser } from '@/lib/types';

export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
export const apiError = (statusCode: number, code: string, message: string, details?: Array<{ path: string; message: string }>) => json({ statusCode, code, message, ...(details ? { details } : {}) }, statusCode);

export function user(over: Partial<PublicUser> = {}): PublicUser {
  return {
    id: 'u-1',
    fullName: 'Maria Agente',
    phone: '+67077123456',
    email: null,
    lang: 'tet' as Locale,
    roles: ['AGENT'],
    permissions: ['shipments:create', 'inbound:scan', 'pod:verify', 'wallets:read_own'],
    scope: { agentId: 'a-1' },
    mustChangePassword: false,
    ...over,
  };
}

/** Sign in without going through the network. */
export function signIn(u: PublicUser = user(), tokens = { accessToken: 'access-1', refreshToken: 'refresh-1' }) {
  sessionStore.signIn(u, tokens);
  return u;
}

/** A tiny fetch router: `routes['POST /v1/shipments'] = (init) => Response`. Unknown calls fail loudly. */
export type Handler = (init: Omit<RequestInit, 'body'> & { url: string; body?: unknown }) => Response | Promise<Response>;
export function mockApi(routes: Record<string, Handler>) {
  const calls: Array<{ method: string; path: string; init: RequestInit & { headers: Record<string, string> }; body: unknown }> = [];
  const fn = async (url: string | URL, init: RequestInit = {}) => {
    const u = new URL(String(url));
    const method = (init.method ?? 'GET').toUpperCase();
    const key = `${method} ${u.pathname}`;
    let body: unknown = init.body;
    if (typeof init.body === 'string') {
      try {
        body = JSON.parse(init.body);
      } catch {
        /* keep raw */
      }
    }
    calls.push({ method, path: u.pathname + u.search, init: init as never, body });
    const h = routes[key];
    if (!h) throw new Error(`Unmocked API call: ${key}`);
    return h({ ...init, url: String(url), body });
  };
  return { fn, calls, last: () => calls[calls.length - 1]!, find: (method: string, path: string) => calls.filter((c) => c.method === method && c.path.startsWith(path)) };
}
