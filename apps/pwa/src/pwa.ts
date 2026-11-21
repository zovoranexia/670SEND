import { useEffect, useState, useSyncExternalStore } from 'react';
import { registerSW } from 'virtual:pwa-register';

/**
 * Service-worker lifecycle. Registered ONCE when the app starts (so the offline shell is cached even before the
 * first sign-in). A new version is downloaded in the background and WAITS: the agent taps "Update" between parcels,
 * so a deploy can never reload the app in the middle of a drop-off.
 */
let needRefresh = false;
let updater: ((reloadPage?: boolean) => Promise<void>) | undefined;
const listeners = new Set<() => void>();

export function registerServiceWorker(): void {
  if (updater) return;
  updater = registerSW({
    onNeedRefresh() {
      needRefresh = true;
      for (const l of listeners) l();
    },
  });
}

export function usePwaUpdate() {
  const needed = useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => needRefresh,
    () => false,
  );
  return { needRefresh: needed, applyUpdate: () => void updater?.(true) };
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** "Add to home screen" offered from the profile page (Chrome / Edge on Android). */
export function useInstallPrompt() {
  const [event, setEvent] = useState<BeforeInstallPromptEvent | null>(null);
  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setEvent(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setEvent(null);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);
  return {
    canInstall: event !== null,
    install: async () => {
      if (!event) return;
      await event.prompt();
      await event.userChoice;
      setEvent(null);
    },
  };
}
