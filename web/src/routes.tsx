import { Navigate, Route, Routes } from 'react-router';
import Applications from './screens/Applications';
import Calendar from './screens/Calendar';
import Engineers from './screens/Engineers';
import Grind from './screens/Grind';
import Hunt from './screens/Hunt';
import Jobs from './screens/Jobs';
import LeetCode from './screens/LeetCode';
import Me from './screens/Me';
import Outreach from './screens/Outreach';
import Prep from './screens/Prep';
import Projects from './screens/Projects';
import SettingsScreen from './screens/Settings';
import Share from './screens/Share';
import Today from './screens/Today';
import { AppShell } from './ui/AppShell';

/** v1 paths (bookmarks, ntfy links) → v2 homes. */
export const LEGACY: [string, string][] = [
  ['leetcode', '/grind/leetcode'], ['apps', '/hunt/apps'],
  ['jobs', '/hunt/jobs'], ['outreach', '/hunt/outreach'], ['settings', '/me/settings'],
];

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Today />} />
        <Route path="grind" element={<Grind />}>
          <Route index element={<Navigate to="leetcode" replace />} />
          <Route path="leetcode" element={<LeetCode />} />
          <Route path="prep" element={<Prep />} />
        </Route>
        <Route path="hunt" element={<Hunt />}>
          <Route index element={<Navigate to="jobs" replace />} />
          <Route path="jobs" element={<Jobs />} />
          <Route path="apps" element={<Applications />} />
          <Route path="engineers" element={<Engineers />} />
          <Route path="outreach" element={<Outreach />} />
        </Route>
        <Route path="projects" element={<Projects />} />
        <Route path="calendar" element={<Calendar />} />
        <Route path="me" element={<Me />} />
        <Route path="me/share" element={<Share />} />
        <Route path="me/settings" element={<SettingsScreen />} />
        {LEGACY.map(([from, to]) => <Route key={from} path={from} element={<Navigate to={to} replace />} />)}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
