/**
 * Idempotency keys for money-moving requests (approve a deposit, pay a payout or a claim, refund, generate payouts).
 *
 * If a request times out AFTER the server has done the work and the officer clicks again with a fresh key, the money
 * moves twice. So the key belongs to the *payload*: the same payload keeps the same key until the request has
 * succeeded (the server then replays the first answer), and a changed payload gets a new key.
 */
const PREFIX = '670send.admin.idem.';

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

/** Call after the request succeeded (or after the officer confirmed it did NOT go through). */
export function clearAttempt(scope: string): void {
  try {
    sessionStorage.removeItem(PREFIX + scope);
  } catch {
    /* ignore */
  }
}

/** Run a keyed request: the key survives a network failure (retry is safe), and is dropped once the server answered. */
export async function withKey<T>(scope: string, payload: unknown, run: (key: string) => Promise<T>): Promise<T> {
  const key = await attemptKey(scope, payload);
  try {
    const result = await run(key);
    clearAttempt(scope);
    return result;
  } catch (e) {
    // A real answer from the server (4xx/5xx) means the attempt is over; only a network failure leaves it ambiguous.
    if ((e as { status?: number })?.status !== 0) clearAttempt(scope);
    throw e;
  }
}
