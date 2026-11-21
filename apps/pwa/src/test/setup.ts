import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// Screens are lazy-loaded: the first dynamic import in a test process is slow while other test files compete for CPU.
configure({ asyncUtilTimeout: 6000 });

// Screens are lazy-loaded: the first dynamic import in a test process is slow while other test files compete for CPU.
configure({ asyncUtilTimeout: 6000 });

// jsdom has no layout engine: these are no-ops there.
window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
import { sessionStore } from '@/lib/session';

afterEach(() => {
  cleanup();
  sessionStore.reset();
  sessionStorage.clear();
  localStorage.clear();
});
