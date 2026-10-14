import { Outlet } from 'react-router';
import { Segmented } from '../ui/Segmented';

export default function Grind() {
  return (
    <div className="stack">
      <Segmented label="Grind" items={[{ to: '/grind/leetcode', label: 'LeetCode' }, { to: '/grind/prep', label: 'Prep' }]} />
      <Outlet />
    </div>
  );
}
