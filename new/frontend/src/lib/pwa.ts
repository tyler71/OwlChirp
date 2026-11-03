// Service worker registration. Updates never apply on their own: an agent may be
// mid-call, so a waiting worker only flips $updateReady and the UI shows an
// "Update" button that calls applyUpdate().
import { atom } from "nanostores";
import { registerSW } from "virtual:pwa-register";
import { $wsStatus } from "./stores";

// Long-lived agent sessions should still notice new deploys.
const UPDATE_CHECK_MS = 60 * 60 * 1000;

export const $updateReady = atom(false);

function checkForUpdate(registration: ServiceWorkerRegistration): void {
  if (navigator.onLine) registration.update().catch(() => {});
}

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    $updateReady.set(true);
  },
  onRegisteredSW(_url, registration) {
    if (!registration) return;
    setInterval(() => checkForUpdate(registration), UPDATE_CHECK_MS);

    // A deploy restarts the backend, dropping the realtime socket. When it
    // reconnects the new sw.js is being served, so check right away.
    let wasOpen = $wsStatus.get() === "open";
    let hasConnected = wasOpen;
    $wsStatus.subscribe((status) => {
      const isOpen = status === "open";
      if (isOpen && !wasOpen) {
        if (hasConnected) checkForUpdate(registration);
        hasConnected = true;
      }
      wasOpen = isOpen;
    });

    // Agents returning to a backgrounded tab should see pending updates.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") checkForUpdate(registration);
    });
  },
});

/** Activate the waiting service worker and reload onto the new version. */
export function applyUpdate(): Promise<void> {
  return updateSW(true);
}
