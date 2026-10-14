import { ChevronRight, Share2 } from 'lucide-react';
import { Link } from 'react-router';
import { useNow, useSyncStatus } from '../data/hooks';
import { anyStale } from '../lib/sync';
import { ProjectsList } from './Projects';
import { TodayIdeaCard } from './TodayIdea';

export default function Me() {
  const now = useNow();
  const stale = anyStale(useSyncStatus().data ?? [], now);
  return (
    <div className="screen">
      <header className="screen-head"><h1>Me</h1></header>
      <nav className="links" aria-label="Share">
        <Link className="row-link" to="/me/share"><span><Share2 size={18} aria-hidden /> Share today's card</span><ChevronRight size={18} aria-hidden /></Link>
      </nav>
      <TodayIdeaCard />
      <ProjectsList />
      <nav className="links" aria-label="More">
        <Link className="row-link" to="/me/settings">
          <span>Settings{stale && <span className="sr-only"> (a sync is stale)</span>}</span>
          <span>{stale && <span className="dot" aria-hidden />}<ChevronRight size={18} aria-hidden /></span>
        </Link>
      </nav>
    </div>
  );
}
