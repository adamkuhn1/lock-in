import { Check } from 'lucide-react';
import { useMemo } from 'react';
import { AlreadyCountedError } from '../data/api';
import { useDailySet, useNow, useProblemMap, useRateSolve, useSettings, useSolves, useTopics } from '../data/hooks';
import type { LcRating } from '../data/types';
import { LEVEL_LABEL, buildMap, nextStep } from '../lib/mastery';
import { planDay } from '../lib/time';
import { LC_RATINGS, LC_RATING_LABEL, buildTodayItems, canRate, type TodayItem } from '../lib/today';
import { Button, Card, CardHead, DifficultyTag, Empty, ExternalLink, LoadError, Skeleton } from '../ui/primitives';
import { RatingMark } from '../ui/RatingMark';

function slotText(item: TodayItem): string | null {
  if (item.slot === 'mystery') return item.topicHidden || !item.topicLabel ? 'Mystery' : `Mystery · ${item.topicLabel}`;
  if (item.slot === 'review' || item.slot === 'spot') return item.topicLabel ? `Review · ${item.topicLabel}` : 'Review';
  return item.topicLabel;
}

function SetRow({ item, busy, onRate }: { item: TodayItem; busy: boolean; onRate: (r: LcRating) => void }) {
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
              <span className="set-rated">
                <RatingMark rating={rating} />
                <span>{LC_RATING_LABEL[rating]}</span>
              </span>
            )}
          </span>
        </span>
      </ExternalLink>
      {item.needsRating && item.solve && !canRate(item.solve) && (
        <p className="muted small rate-late">Not rated in time, so it counted as {LC_RATING_LABEL[item.solve.effective_rating ?? 'explained']}.</p>
      )}
      {item.needsRating && item.solve && canRate(item.solve) && (
        <div className="rate" role="group" aria-label={`How did ${item.title} go?`}>
          {LC_RATINGS.map((r) => (
            <Button key={r.value} disabled={busy} onClick={() => onRate(r.value)}>
              <span className="rate-label"><RatingMark rating={r.value} />{r.label}</span>
            </Button>
          ))}
          <p className="rate-hint">Explained: you watched the explanation, then wrote it yourself.</p>
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
  const topics = useTopics();
  const settings = useSettings();
  const focusName = set.data?.focus ?? settings.data?.lc_focus_topic ?? null;
  const focus = buildMap(topics.data ?? [], solves.data ?? [], problems, focusName).find((t) => t.isFocus) ?? null;
  const step = focus ? nextStep(focus.level, focus.progress, focus.pools) : null;
  const left = step?.reqs.find((r) => !r.met) ?? null;
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
      ) : (<>
        {focus && step && (
          <p className="set-focus small">
            <span className={`tp-level lvl-${focus.level}`}>{LEVEL_LABEL[focus.level]}</span>
            {step.target && left ? <span>Next: {left.text.charAt(0).toLowerCase() + left.text.slice(1)} ({Math.min(left.have, left.need)}/{left.need})</span>
              : step.target ? <span>{LEVEL_LABEL[step.target]} on the next sync</span> : <span>Mastered</span>}
          </p>
        )}
        <ol className="set-list">
          {items.map((it) => (
            <SetRow key={it.slug} item={it} busy={rate.isPending}
              onRate={(r) => { if (it.solve) rate.mutate({ id: it.solve.id, rating: r }); }} />
          ))}
        </ol>
      </>)}
      {rate.isError && (
        <p className="small error" role="alert">
          {rate.error instanceof AlreadyCountedError ? 'Already counted.' : "Couldn't save rating. Try again."}
        </p>
      )}
    </Card>
  );
}
