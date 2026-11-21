// Node 25+ ships its own (file-backed, experimental) `localStorage` global that shadows jsdom's and has no `clear`.
// Tests need a plain in-memory Storage, installed before any module that touches it is imported.
class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length() {
    return this.data.size;
  }
  clear() {
    this.data.clear();
  }
  getItem(key: string) {
    return this.data.has(key) ? this.data.get(key)! : null;
  }
  key(index: number) {
    return [...this.data.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
  setItem(key: string, value: string) {
    this.data.set(key, String(value));
  }
  [name: string]: unknown;
}

for (const name of ['localStorage', 'sessionStorage'] as const) {
  const current = (globalThis as Record<string, unknown>)[name] as Storage | undefined;
  if (typeof current?.clear !== 'function') {
    Object.defineProperty(globalThis, name, { value: new MemoryStorage(), configurable: true, writable: true });
    if (typeof window !== 'undefined') Object.defineProperty(window, name, { value: (globalThis as Record<string, unknown>)[name], configurable: true, writable: true });
  }
}
