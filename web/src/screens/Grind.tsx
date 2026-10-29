import { Outlet } from 'react-router';
import { TRACKS } from '../lib/learn';
import { Segmented } from '../ui/Segmented';

export default function Grind() {
  return (
    <div className="stack">
      <Segmented label="Grind" items={[
        { to: '/grind/leetcode', label: 'LeetCode' }, { to: '/grind/prep', label: 'Prep' },
        ...TRACKS.map((t) => ({ to: `/grind/learn/${t.id}`, label: t.label })),
      ]} />
      <Outlet />
    </div>
  );
}
