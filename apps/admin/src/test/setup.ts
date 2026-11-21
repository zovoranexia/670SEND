import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { sessionStore } from '@/lib/session';

// Screens are lazy-loaded: the first dynamic import in a test process is slow while other test files compete for CPU.
// (The hub console is the largest chunk; with the whole repo's tests running at once 6 s was not always enough.)
configure({ asyncUtilTimeout: 12_000 });

// jsdom has no layout engine: these are no-ops there.
window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) {
  this.removeAttribute('open');
};

afterEach(() => {
  cleanup();
  sessionStore.reset();
  sessionStorage.clear();
  localStorage.clear();
});
