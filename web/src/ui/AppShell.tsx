import { useQueryClient } from '@tanstack/react-query';
import { Briefcase, Code, FolderGit2, ListChecks, Mail, RefreshCw, Settings, Sun } from 'lucide-react';
import { useState } from 'react';
import { NavLink, Outlet } from 'react-router';
import { useNow, useSyncOnOpen, useSyncStatus } from '../data/hooks';
import { anyStale } from '../lib/sync';

const TABS = [
  { to: '/', label: 'Today', Icon: Sun, end: true },
  { to: '/leetcode', label: 'LeetCode', Icon: Code, end: false },
  { to: '/projects', label: 'Projects', Icon: FolderGit2, end: false },
  { to: '/apps', label: 'Apps', Icon: ListChecks, end: false },
  { to: '/jobs', label: 'Jobs', Icon: Briefcase, end: false },
  { to: '/outreach', label: 'Outreach', Icon: Mail, end: false },
];

export function AppShell() {
  const now = useNow();
  const sync = useSyncOnOpen();
  const qc = useQueryClient();
  const status = useSyncStatus();
  const stale = anyStale(status.data ?? [], now);
  const settingsLabel = stale ? 'Settings (a sync is stale)' : 'Settings';
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
          <NavLink key={to} to={to} end={end} className="nav-link"><Icon size={20} aria-hidden />{label}</NavLink>
        ))}
        <div className="spacer" />
        <button type="button" className="nav-link" onClick={refresh} disabled={sync.isPending}>
          <RefreshCw size={20} aria-hidden className={spin} />Refresh
        </button>
        <NavLink to="/settings" className="nav-link" aria-label={settingsLabel}>
          <Settings size={20} aria-hidden />Settings{stale && <span className="dot" aria-hidden />}
        </NavLink>
      </nav>
      <header className="topbar">
        <button type="button" className="icon-btn" onClick={refresh} disabled={sync.isPending} aria-label="Refresh">
          <RefreshCw size={20} aria-hidden className={spin} />
        </button>
        <NavLink to="/settings" className="icon-btn" aria-label={settingsLabel}>
          <Settings size={20} aria-hidden />{stale && <span className="dot dot-corner" aria-hidden />}
        </NavLink>
      </header>
      <main id="main" className="main" tabIndex={-1}>
        {syncFailed && <p className="sync-note small error" role="alert">Couldn't sync LeetCode.</p>}
        <Outlet />
      </main>
      <nav className="bottom-nav" aria-label="Tabs">
        {TABS.map(({ to, label, Icon, end }) => (
          <NavLink key={to} to={to} end={end} className="nav-link"><Icon size={22} aria-hidden />{label}</NavLink>
        ))}
      </nav>
    </div>
  );
}
