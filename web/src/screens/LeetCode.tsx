import { useState } from 'react';
import {
  useNow, useProblemMap, useProblemStates, useSettings, useSolves, useTopics, useUpdateSettings,
} from '../data/hooks';
import type { Level, Solve } from '../data/types';
import { heatmap, intensity } from '../lib/heatmap';
import { reviewQueue, upcomingReviews } from '../lib/levels';
import { buildMap } from '../lib/mastery';
import { localDay, planDay, relativeTime } from '../lib/time';
import { LC_RATING_LABEL, problemUrl } from '../lib/today';
import { Button, Card, CardHead, DifficultyTag, Disclosure, Empty, ExternalLink, LoadError, Skeleton, Stepper } from '../ui/primitives';
import { RatingMark } from '../ui/RatingMark';
import { DailySetCard } from './DailySet';
import { RoadMap, TopicPanel } from './RoadMap';

const NO_FOCUS: Level[] = ['mastered'];

function solveLabel(s: Pick<Solve, 'rating' | 'applied_at' | 'effective_rating'>): string {
  if (s.rating) return LC_RATING_LABEL[s.rating];
  if (s.applied_at) return `${LC_RATING_LABEL[s.effective_rating ?? 'explained']} (not rated)`; // the worker counts an unrated past solve as explained
  return 'Not rated yet';
}

export default function LeetCode() {
  const now = useNow();
  const day = planDay(now);
  const topics = useTopics();
  const settings = useSettings();
  const pstates = useProblemStates();
  const problems = useProblemMap();
  const solves = useSolves();
  const update = useUpdateSettings();
  const countUpdate = useUpdateSettings();
  const [open, setOpen] = useState<string | null>(null);
  const [changed, setChanged] = useState<{ topic: string; prevTopic: string | null; prevSince: string | null } | null>(null);
  const makeFocus = (topic: string) => {
    const prevTopic = settings.data?.lc_focus_topic ?? null;
    const prevSince = settings.data?.lc_focus_since ?? null;
    update.mutate({ lc_focus_topic: topic, lc_focus_since: day }, { onSuccess: () => setChanged({ topic, prevTopic, prevSince }) });
  };
  const undoFocus = () => {
    if (!changed) return;
    update.mutate({ lc_focus_topic: changed.prevTopic, lc_focus_since: changed.prevSince }, { onSuccess: () => setChanged(null) });
  };

  const focus = settings.data?.lc_focus_topic ?? null;
  const map = buildMap(topics.data ?? [], solves.data ?? [], problems, focus);
  const selected = map.find((t) => t.name === (open ?? focus)) ?? map.find((t) => t.level !== 'mastered') ?? null;
  const queue = reviewQueue(pstates.data ?? [], problems, day);
  const soon = upcomingReviews(pstates.data ?? [], day, 7);
  const weeks = heatmap(solves.data ?? [], localDay(now));
  const total = weeks.flat().reduce((n, c) => n + c.count, 0);
  const reviewRow = ({ state, problem }: (typeof queue)[number]) => (
    <li key={state.slug} className="list-row">
      <ExternalLink href={problemUrl(state.slug)}>{problem?.title ?? state.slug}</ExternalLink>
      {problem && <DifficultyTag d={problem.difficulty} />}
    </li>
  );

  return (
    <div className="screen">
      <header className="screen-head"><h1>LeetCode</h1></header>

      <DailySetCard />

      <Card aria-labelledby="map-h" className="map-card">
        <CardHead id="map-h" title="Roadmap">
          {map.length > 0 && <span className="count">{map.filter((t) => t.level === 'mastered').length}/{map.length} mastered</span>}
        </CardHead>
        {topics.isPending || solves.isPending ? (
          <Skeleton label="Loading roadmap" />
        ) : topics.isError || solves.isError ? (
          <LoadError what="the roadmap" onRetry={() => { void topics.refetch(); void solves.refetch(); }} />
        ) : (
          <RoadMap topics={map} selected={selected?.name ?? null} onSelect={setOpen} />
        )}
        <div aria-live="polite">
          {selected && (
            <TopicPanel topic={selected}>
              {selected.isFocus ? (
                <p className="muted small">This is your focus. It stays until it's Mastered.</p>
              ) : NO_FOCUS.includes(selected.level) ? null : (
                <div className="row-actions">
                  <Button disabled={update.isPending} onClick={() => makeFocus(selected.name)}>Make focus</Button>
                  <span className="muted small">Starts with tomorrow's set.</span>
                </div>
              )}
              {changed && !update.isError && (
                <p className="small">Focus: {changed.topic}. <Button disabled={update.isPending} onClick={undoFocus}>Undo</Button></p>
              )}
              {update.isError && <p className="small" role="alert">Couldn't change focus. Try again.</p>}
            </TopicPanel>
          )}
        </div>
      </Card>

      <Card aria-labelledby="rev-h">
        <CardHead id="rev-h" title="Reviews due">{queue.length > 0 && <span className="count">{queue.length}</span>}</CardHead>
        {queue.length === 0 ? <Empty>Nothing due.</Empty> : <ul className="list">{queue.slice(0, 5).map(reviewRow)}</ul>}
        {queue.length > 5 && <Disclosure summary={`${queue.length - 5} more`}><ul className="list">{queue.slice(5).map(reviewRow)}</ul></Disclosure>}
        {soon > 0 && <p className="muted small">{soon} more this week.</p>}
      </Card>

      <Card aria-labelledby="hist-h">
        <CardHead id="hist-h" title="History">{total > 0 && <span className="count">{total} solves</span>}</CardHead>
        <div className="heat" role="img" aria-label={`${total} solves in the last 26 weeks`}>
          {weeks.flat().map((c) => (
            <span key={c.day} className={c.future ? 'future' : `h${intensity(c.count)}`} title={`${c.day}: ${c.count}`} />
          ))}
        </div>
        <Disclosure summary="Recent solves">
          <ul className="list">
            {(solves.data ?? []).slice(0, 10).map((s) => (
              <li key={s.id} className="list-row">
                <span>{s.title}</span>
                <span className="muted small solve-meta">
                  <RatingMark rating={s.rating ?? s.effective_rating ?? null} />{solveLabel(s)} · {relativeTime(s.accepted_at, now)}
                </span>
              </li>
            ))}
          </ul>
        </Disclosure>
      </Card>

      {settings.data && (
        <Disclosure summary="Daily count">
          <div className="row-actions">
            <Stepper label="Problems per day" value={settings.data.daily_lc_count} min={5} max={8}
              disabled={countUpdate.isPending} onChange={(v) => countUpdate.mutate({ daily_lc_count: v })} />
            {countUpdate.isError
              ? <span className="small" role="alert">Couldn't save. Try again.</span>
              : <span className="muted small">Applies from tomorrow's set.</span>}
          </div>
        </Disclosure>
      )}
    </div>
  );
}
