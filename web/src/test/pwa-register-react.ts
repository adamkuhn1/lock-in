// Test stand-in for vite-plugin-pwa's virtual module (aliased in vite.config.ts under `test`).
import { useState } from 'react';

export const pwaState = { needRefresh: false, updated: 0 };

export function useRegisterSW() {
  const needRefresh = useState(pwaState.needRefresh);
  const offlineReady = useState(false);
  return { needRefresh, offlineReady, updateServiceWorker: async () => { pwaState.updated += 1; } };
}
