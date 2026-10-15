import { Shuffle } from 'lucide-react';
import { useCommits, useIdeas, useNow, useProjects, useSwapIdea, useUpdateIdea } from '../data/hooks';
import { committedOnPlanDay, swapCandidate, todaysIdea } from '../lib/ideas';
import { planDay } from '../lib/time';
import { Button, Card, CardHead } from '../ui/primitives';

export function TodayIdeaCard() {
  const day = planDay(useNow());
  const ideas = useIdeas();
  const projects = useProjects();
  const commits = useCommits();
  const updateIdea = useUpdateIdea();
  const swap = useSwapIdea();
  const idea = todaysIdea(ideas.data ?? [], day);
  const project = idea ? (projects.data ?? []).find((p) => p.id === idea.project_id) : undefined;
  if (!idea || !project) return null;
  // Any commit today completes a 'today' idea (worker complete_idea_on_commit). A started idea
  // only completes on a commit after Work on this (complete_started_ideas), so skip it here.
  const committed = idea.status !== 'in_progress' && committedOnPlanDay(commits.data ?? [], idea.project_id, day);
  const ideaDone = idea.status === 'done' || committed;
  const next = idea.status === 'today' ? swapCandidate(ideas.data ?? [], idea) : null;
  return (
    <Card aria-labelledby="idea-h">
      <CardHead id="idea-h" title={`Today · ${project.name}`}>
        {next && (
          <Button variant="quiet" disabled={swap.isPending} onClick={() => swap.mutate({ fromId: idea.id, toId: next.id, day })}>
            <Shuffle size={16} aria-hidden />Swap
          </Button>
        )}
      </CardHead>
      <label className="idea-toggle">
        <input type="checkbox" checked={ideaDone} disabled={committed || updateIdea.isPending}
          onChange={(e) => updateIdea.mutate({
            id: idea.id,
            patch: e.target.checked ? { status: 'done', done_at: new Date().toISOString() } : { status: idea.started_at ? 'in_progress' : 'today', done_at: null },
          })} />
        <span>{idea.text}</span>
      </label>
      {committed && <p className="muted small">Done by today's commit.</p>}
    </Card>
  );
}
