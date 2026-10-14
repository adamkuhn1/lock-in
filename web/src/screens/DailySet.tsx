import { Check } from 'lucide-react';
import { useMemo } from 'react';
import { AlreadyCountedError } from '../data/api';
import { useDailySet, useNow, useProblemMap, useRateSolve, useSolves } from '../data/hooks';
import type { Rating } from '../data/types';
import { planDay } from '../lib/time';
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

export function DailySetCard() {
  const now = useNow();
  const day = planDay(now);
  const set = useDailySet(day);
  const solves = useSolves();
  const problems = useProblemMap();
  const rate = useRateSolve();
  const items = useMemo(
    () => (set.data ? buildTodayItems(set.data, solves.data ?? [], problems, day) : []),
    [set.data, solves.data, problems, day],
  );
  const doneCount = items.filter((i) => i.done).length;
  return (
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
  );
}
