import { useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Dumbbell, Flame, RefreshCw, Target, User } from 'lucide-react';
import { useState } from 'react';
import { NavLink, Outlet } from 'react-router';
import { useNow, useSyncOnOpen, useSyncStatus } from '../data/hooks';
import { anyStale } from '../lib/sync';

const TABS = [
  { to: '/', label: 'Today', Icon: Flame, end: true },
  { to: '/grind', label: 'Grind', Icon: Dumbbell, end: false },
  { to: '/hunt', label: 'Hunt', Icon: Target, end: false },
  { to: '/calendar', label: 'Calendar', Icon: CalendarDays, end: false },
  { to: '/me', label: 'Me', Icon: User, end: false },
];

export function AppShell() {
  const now = useNow();
  const sync = useSyncOnOpen();
  const qc = useQueryClient();
  const status = useSyncStatus();
  const stale = anyStale(status.data ?? [], now);
  // Only a manual Refresh reports failure; the automatic sync on open stays quiet. 'skipped' (within 60 s) is fine.
  const [syncFailed, setSyncFailed] = useState(false);
  const refresh = () => {
    setSyncFailed(false);
    sync.mutate(undefined, {
      onSuccess: (r) => setSyncFailed(r.status === 'error'),
      onError: () => setSyncFailed(true),
      onSettled: () => void qc.invalidateQueries(),
    });
  };
  const spin = sync.isPending ? 'spin' : undefined;

  return (
    <div className="shell">
      <a className="skip-link" href="#main">Skip to content</a>
      <nav className="sidebar" aria-label="Main">
        <div className="brand">Lock In</div>
        {TABS.map(({ to, label, Icon, end }) => (
          <NavLink key={to} to={to} end={end} className="nav-link" aria-label={to === '/me' && stale ? 'Me (a sync is stale)' : undefined}>
            <Icon size={20} aria-hidden />{label}{to === '/me' && stale && <span className="dot dot-corner" aria-hidden />}
          </NavLink>
        ))}
        <div className="spacer" />
        <button type="button" className="nav-link" onClick={refresh} disabled={sync.isPending}>
          <RefreshCw size={20} aria-hidden className={spin} />Refresh
        </button>
      </nav>
      <header className="topbar">
        <button type="button" className="icon-btn" onClick={refresh} disabled={sync.isPending} aria-label="Refresh">
          <RefreshCw size={20} aria-hidden className={spin} />
        </button>
      </header>
      <main id="main" className="main" tabIndex={-1}>
        {syncFailed && <p className="sync-note small error" role="alert">Couldn't sync LeetCode.</p>}
        <Outlet />
      </main>
      <nav className="bottom-nav" aria-label="Tabs">
        {TABS.map(({ to, label, Icon, end }) => (
          <NavLink key={to} to={to} end={end} className="nav-link" aria-label={to === '/me' && stale ? 'Me (a sync is stale)' : undefined}>
            <Icon size={22} aria-hidden />{label}{to === '/me' && stale && <span className="dot dot-corner" aria-hidden />}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
