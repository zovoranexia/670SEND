/**
 * Idempotency keys for money-moving requests (registering a parcel, a deposit request).
 *
 * On a weak connection a request can time out AFTER the server has done the work. If the agent taps "Register"
 * again with a fresh key the customer is charged twice. So the key belongs to the *payload*: the same payload
 * keeps the same key until the request has succeeded (the server then replays the first answer), and a changed
 * payload gets a new key (the server would reject a reused key with different content).
 */
const PREFIX = '670send.idem.';

async function sha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  if (globalThis.crypto?.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  // Insecure context (plain-HTTP LAN testing): a non-cryptographic fingerprint is enough to detect "payload changed".
  let h = 5381;
  for (const b of bytes) h = ((h << 5) + h + b) | 0;
  return String(h);
}

const newKey = () => (typeof globalThis.crypto?.randomUUID === 'function' ? crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`);

export async function attemptKey(scope: string, payload: unknown): Promise<string> {
  const fingerprint = await sha256(JSON.stringify(payload));
  try {
    const raw = sessionStorage.getItem(PREFIX + scope);
    if (raw) {
      const saved = JSON.parse(raw) as { fingerprint: string; key: string };
      if (saved.fingerprint === fingerprint) return saved.key;
    }
    const key = newKey();
    sessionStorage.setItem(PREFIX + scope, JSON.stringify({ fingerprint, key }));
    return key;
  } catch {
    return newKey();
  }
}

/** Call after the request succeeded (or after the agent confirmed it did NOT go through). */
export function clearAttempt(scope: string): void {
  try {
    sessionStorage.removeItem(PREFIX + scope);
  } catch {
    /* ignore */
  }
}

/** True while an earlier attempt with this scope may or may not have reached the server. */
export function hasPendingAttempt(scope: string): boolean {
  try {
    return sessionStorage.getItem(PREFIX + scope) !== null;
  } catch {
    return false;
  }
}
