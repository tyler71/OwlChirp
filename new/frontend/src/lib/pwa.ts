// Service worker registration. Updates never apply on their own: an agent may be
// mid-call, so a waiting worker only flips $updateReady and the UI shows an
// "Update" button that calls applyUpdate().
import { atom } from 'nanostores';
import { registerSW } from 'virtual:pwa-register';

// Long-lived agent sessions should still notice new deploys.
const UPDATE_CHECK_MS = 60 * 60 * 1000;

export const $updateReady = atom(false);

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    $updateReady.set(true);
  },
  onRegisteredSW(_url, registration) {
    if (!registration) return;
    setInterval(() => {
      if (navigator.onLine) registration.update().catch(() => {});
    }, UPDATE_CHECK_MS);
  },
});

/** Activate the waiting service worker and reload onto the new version. */
export function applyUpdate(): Promise<void> {
  return updateSW(true);
}
