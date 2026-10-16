import { Check, Play, RotateCcw } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Idea } from '../data/types';
import type { LaunchState } from '../lib/ideas';
import { Button, ErrorDetail } from './primitives';

export function IdeaCard({ idea, state, busy, onWork, onResend, resending = false, onDone, menu }: {
  idea: Idea; state: LaunchState; busy: boolean; onWork: () => void; onDone: () => void; menu?: ReactNode;
  /** Re-sends the Work on this request, e.g. when the Claude window was closed before it started. */
  onResend?: () => void; resending?: boolean;
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
          <>
            <span className="badge badge-accent">In progress</span>
            {onResend && (
              <Button variant="quiet" disabled={resending} onClick={onResend} aria-label={`Send again: ${idea.text}`}>
                <RotateCcw size={16} aria-hidden />Send again
              </Button>
            )}
          </>
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
