import { Outlet } from 'react-router';
import { useNow, useOutreach, usePostings } from '../data/hooks';
import { followUpsDue } from '../lib/outreach';
import { localDay } from '../lib/time';
import { Segmented } from '../ui/Segmented';

export default function Hunt() {
  const now = useNow();
  const fresh = (usePostings().data ?? []).filter((p) => p.status === 'new').length;
  const due = followUpsDue(useOutreach().data ?? [], localDay(now)).length;
  return (
    <div className="stack">
      <Segmented label="Hunt" items={[
        { to: '/hunt/jobs', label: 'Jobs', badge: fresh, badgeLabel: 'new' },
        { to: '/hunt/apps', label: 'Applications' },
        { to: '/hunt/outreach', label: 'Outreach', badge: due, badgeLabel: 'due' },
      ]} />
      <Outlet />
    </div>
  );
}
