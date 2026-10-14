import { Check, Shuffle } from 'lucide-react';
import { useMemo } from 'react';
import { Link } from 'react-router';
import { AlreadyCountedError } from '../data/api';
import {
  useApplications, useCommits, useDailySet, useIdeas, useNow, useOutreach, usePostings, useProblemMap, useProjects,
  useRateSolve, useSettings, useSolves, useSwapIdea, useUpdateIdea,
} from '../data/hooks';
import type { Rating } from '../data/types';
import { committedOnPlanDay, swapCandidate, todaysIdea } from '../lib/ideas';
import { followUpsDue } from '../lib/outreach';
import { dayNumber, streaks } from '../lib/streaks';
import { localDay, planDay } from '../lib/time';
import { RATINGS, buildTodayItems, canRate, type TodayItem } from '../lib/today';
import { Button, Card, CardHead, DifficultyTag, Empty, ExternalLink, LoadError, Skeleton } from '../ui/primitives';

const RATED: Record<Rating, { emoji: string; label: string }> = Object.fromEntries(
  RATINGS.map((r) => [r.value, { emoji: r.emoji, label: r.label }]),
) as Record<Rating, { emoji: string; label: string }>;

function slotText(item: TodayItem): string | null {
  if (item.slot === 'mystery') return item.topicHidden || !item.topicLabel ? 'Mystery' : `Mystery · ${item.topicLabel}`;
  if (item.slot === 'review' || item.slot === 'spot') return item.topicLabel ? `Review · ${item.topicLabel}` : 'Review';
  return item.topicLabel;
}

function SetRow({ item, busy, onRate }: { item: TodayItem; busy: boolean; onRate: (r: Rating) => void }) {
  const meta = slotText(item);
  const rating = item.solve?.rating ?? null;
  return (
    <li className={item.done ? 'set-row is-done' : 'set-row'}>
      <ExternalLink className="set-link" href={item.url}>
        <span className="check" aria-hidden="true">{item.done && <Check size={16} strokeWidth={3} />}</span>
        <span className="set-main">
          <span className="set-title">
            {item.title}
            {item.done && <span className="sr-only"> (solved)</span>}
          </span>
          <span className="set-meta">
            {item.difficulty && <DifficultyTag d={item.difficulty} />}
            {meta && <span>{meta}</span>}
            {rating && (
              <span>
                <span aria-hidden="true">{RATED[rating].emoji}</span>
                <span className="sr-only">Rated: {RATED[rating].label}</span>
              </span>
            )}
          </span>
        </span>
      </ExternalLink>
      {item.needsRating && item.solve && !canRate(item.solve) && (
        <p className="muted small rate-late">Counted as <span aria-hidden="true">🟡</span><span className="sr-only">Struggled</span></p>
      )}
      {item.needsRating && item.solve && canRate(item.solve) && (
        <div className="rate" role="group" aria-label={`How did ${item.title} go?`}>
          {RATINGS.map((r) => (
            <Button key={r.value} disabled={busy} onClick={() => onRate(r.value)}>
              <span aria-hidden="true">{r.emoji}</span><span>{r.label}</span>
            </Button>
          ))}
        </div>
      )}
    </li>
  );
}

export default function Today() {
  const now = useNow();
  const day = planDay(now);
  const today = localDay(now);
  const settings = useSettings();
  const set = useDailySet(day);
  const solves = useSolves();
  const problems = useProblemMap();
  const commits = useCommits();
  const apps = useApplications();
  const ideas = useIdeas();
  const projects = useProjects();
  const postings = usePostings();
  const outreach = useOutreach();
  const rate = useRateSolve();
  const updateIdea = useUpdateIdea();
  const swap = useSwapIdea();

  const items = useMemo(
    () => (set.data ? buildTodayItems(set.data, solves.data ?? [], problems, day) : []),
    [set.data, solves.data, problems, day],
  );
  const s = streaks(solves.data ?? [], commits.data ?? [], apps.data ?? [], now);
  const n = dayNumber(settings.data?.lc_started_on ?? null, day);
  const idea = todaysIdea(ideas.data ?? [], day);
  const project = idea ? (projects.data ?? []).find((p) => p.id === idea.project_id) : undefined;
  const committed = idea ? committedOnPlanDay(commits.data ?? [], idea.project_id, day) : false;
  const ideaDone = idea?.status === 'done' || committed;
  const next = idea && idea.status === 'today' ? swapCandidate(ideas.data ?? [], idea) : null;
  const fresh = (postings.data ?? []).filter((p) => p.status === 'new');
  const starred = fresh.filter((p) => p.starred).length;
  const due = followUpsDue(outreach.data ?? [], today).length;
  const doneCount = items.filter((i) => i.done).length;

  return (
    <div className="screen screen-split">
      <header className="screen-head">
        <h1>{n ? `Day ${n}` : 'Today'}</h1>
        <ul className="streaks" aria-label="Streaks">
          {s.leetcode > 0 && <li className="streak">LeetCode <b>{s.leetcode}</b></li>}
          {s.project > 0 && <li className="streak">Project <b>{s.project}</b></li>}
          {s.apps > 0 && <li className="streak">Apps <b>{s.apps}</b></li>}
        </ul>
      </header>

      <Card data-primary aria-labelledby="set-h">
        <CardHead id="set-h" title={set.data?.mixed_day ? 'Mixed day' : (set.data?.focus ?? 'LeetCode')}>
          {set.data && <span className="count"><span className="sr-only">Done: </span>{doneCount}/{items.length}</span>}
        </CardHead>
        {set.isPending ? (
          <Skeleton label="Loading today's set" />
        ) : set.isError ? (
          <LoadError what="today's set" onRetry={() => void set.refetch()} />
        ) : !set.data ? (
          <Empty>No set yet.</Empty>
        ) : (
          <ol className="set-list">
            {items.map((it) => (
              <SetRow key={it.slug} item={it} busy={rate.isPending}
                onRate={(r) => { if (it.solve) rate.mutate({ id: it.solve.id, rating: r }); }} />
            ))}
          </ol>
        )}
        {rate.isError && (
          <p className="small error" role="alert">
            {rate.error instanceof AlreadyCountedError ? 'Already counted.' : "Couldn't save rating. Try again."}
          </p>
        )}
      </Card>

      <div className="side">
      {idea && project && (
        <Card aria-labelledby="idea-h">
          <CardHead id="idea-h" title={project.name}>
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
                patch: e.target.checked ? { status: 'done', done_at: new Date().toISOString() } : { status: 'today', done_at: null },
              })} />
            <span>{idea.text}</span>
          </label>
          {committed && <p className="muted small">Done by today's commit.</p>}
        </Card>
      )}

      {(due > 0 || fresh.length > 0) && (
        <nav className="links" aria-label="Also today">
          {due > 0 && <Link className="row-link" to="/outreach"><span>Follow-ups due</span><b>{due}</b></Link>}
          {fresh.length > 0 && (
            <Link className="row-link" to="/jobs"><span>New postings</span><b>{fresh.length}{starred > 0 && ` · ${starred} ⭐`}</b></Link>
          )}
        </nav>
      )}
      </div>
    </div>
  );
}
