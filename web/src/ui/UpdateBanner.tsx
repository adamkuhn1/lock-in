import { useRegisterSW } from 'virtual:pwa-register/react';
import { Button } from './primitives';

export const UPDATE_CHECK_MS = 30 * 60_000;

/**
 * "A new version is ready": the installed app keeps its cached build until reloaded, so say so instead of
 * leaving an old version running. Checks every 30 minutes and whenever the window comes back into focus.
 */
export function UpdateBanner() {
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW({
    onRegisteredSW(_url, reg) {
      if (!reg) return;
      const check = () => { if (navigator.onLine) void reg.update(); };
      window.setInterval(check, UPDATE_CHECK_MS);
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
    },
  });
  if (!needRefresh) return null;
  return (
    <div role="status" className="undo update-banner">
      <span className="small">A new version of Lock In is ready.</span>
      <Button variant="primary" onClick={() => void updateServiceWorker(true)}>Reload</Button>
    </div>
  );
}
