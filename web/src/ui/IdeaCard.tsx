import { Check, Play } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Idea } from '../data/types';
import type { LaunchState } from '../lib/ideas';
import { Button, ErrorDetail } from './primitives';

export function IdeaCard({ idea, state, busy, onWork, onDone, menu }: {
  idea: Idea; state: LaunchState; busy: boolean; onWork: () => void; onDone: () => void; menu?: ReactNode;
}) {
  const tags = [idea.size, idea.source === 'claude' ? 'Claude' : null, idea.status === 'today' ? 'Today' : null].filter(Boolean).join(' · ');
  const queued = state.kind === 'queued';
  const working = idea.status === 'in_progress' && !queued;
  return (
    <li className="idea-card">
      <div className="idea-top">
        <span className="idea-text">{idea.text} <span className="muted small">{tags}</span></span>
        <Button variant="quiet" aria-label={`Done: ${idea.text}`} onClick={onDone}><Check size={18} aria-hidden /></Button>
        {menu}
      </div>
      <div className="idea-actions">
        {working ? (
          <span className="badge badge-accent">In progress</span>
        ) : (
          <Button variant={queued ? 'muted' : 'primary'} disabled={queued || busy} onClick={onWork}
            aria-label={`${queued ? 'Queued for Mac' : 'Work on this'}: ${idea.text}`}>
            <Play size={16} aria-hidden />{queued ? 'Queued for Mac' : 'Work on this'}
          </Button>
        )}
      </div>
      {state.kind === 'failed' && idea.status !== 'in_progress' && <ErrorDetail error={state.error} />}
    </li>
  );
}
