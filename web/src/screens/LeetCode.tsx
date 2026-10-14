import { Lock } from 'lucide-react';
import { useState } from 'react';
import {
  useNow, useProblemMap, useProblemStates, useSettings, useSolves, useTopicStates, useTopics, useUpdateSettings,
} from '../data/hooks';
import type { Level, Solve } from '../data/types';
import { heatmap, intensity } from '../lib/heatmap';
import { LEVEL_LABEL, reviewQueue, roadmapRows, topicCounts, upcomingReviews } from '../lib/levels';
import { localDay, planDay, relativeTime } from '../lib/time';
import { RATINGS, problemUrl } from '../lib/today';
import { Button, Card, CardHead, DifficultyTag, Disclosure, Empty, ExternalLink, LoadError, Skeleton, Stepper } from '../ui/primitives';
import { DailySetCard } from './DailySet';

const ALL_LEVELS: Level[] = ['locked', 'available', 'learning', 'practicing', 'solid', 'mastered'];
const RATING_LABEL = Object.fromEntries(RATINGS.map((r) => [r.value, `${r.emoji} ${r.label}`])) as Record<string, string>;
const AUTO_LABEL = `${RATINGS.find((r) => r.value === 'struggled')!.emoji} (auto)`; // the worker counts an unrated past solve as struggled
const NO_FOCUS: Level[] = ['solid', 'mastered'];

function solveLabel(s: Pick<Solve, 'rating' | 'applied_at'>): string {
  if (s.rating) return RATING_LABEL[s.rating];
  return s.applied_at ? AUTO_LABEL : 'Unrated';
}

export default function LeetCode() {
  const now = useNow();
  const day = planDay(now);
  const topics = useTopics();
  const states = useTopicStates();
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

  const rows = roadmapRows(topics.data ?? [], states.data ?? [], settings.data?.lc_focus_topic ?? null);
  const selected = rows.flatMap((r) => r.topics).find((t) => t.name === open) ?? null;
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

      <Card aria-labelledby="map-h">
        <CardHead id="map-h" title="Roadmap" />
        {topics.isPending || states.isPending ? (
          <Skeleton label="Loading roadmap" />
        ) : topics.isError || states.isError ? (
          <LoadError what="the roadmap" onRetry={() => { void topics.refetch(); void states.refetch(); }} />
        ) : (
          <ol className="roadmap">
            {rows.map((r) => (
              <li key={r.tier}>
                <ul className="tier">
                  {r.topics.map((t) => (
                    <li key={t.name}>
                      {/* The level (and focus) caption renders from data-sub via CSS so the visible label stays the topic name;
                          the accessible name carries both. */}
                      <button type="button" className={`topic lvl-${t.level}${t.isFocus ? ' is-focus' : ''}`}
                        aria-expanded={open === t.name} aria-controls={open === t.name ? 'topic-detail' : undefined}
                        aria-label={`${t.name}${t.isFocus ? ' Focus' : ''}, ${LEVEL_LABEL[t.level]}`}
                        data-sub={t.level === 'locked' ? undefined : `${LEVEL_LABEL[t.level]}${t.isFocus ? ' · Focus' : ''}`}
                        onClick={() => setOpen(open === t.name ? null : t.name)}>
                        {t.level === 'locked' && <Lock size={14} aria-hidden />}
                        {t.name}
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        )}
        <div id="topic-detail" className="stack" aria-live="polite">
          {selected && (<>
            <p><b>{selected.name}</b> · {LEVEL_LABEL[selected.level]}</p>
            {(() => {
              const c = topicCounts(solves.data ?? [], problems, selected.name);
              return <p className="muted small">Solved: {c.Easy} easy · {c.Medium} medium · {c.Hard} hard</p>;
            })()}
            {selected.level === 'locked' && selected.prereqs.length > 0 && (
              <p className="muted small">Unlocks when {selected.prereqs.join(' and ')} reach Practicing.</p>
            )}
            {selected.isFocus ? (
              <p className="muted small">This is your focus.</p>
            ) : NO_FOCUS.includes(selected.level) ? null : (
              <div className="row-actions">
                <Button disabled={update.isPending} onClick={() => makeFocus(selected.name)}>Make focus</Button>
                <span className="muted small">Starts with tomorrow's set.</span>
              </div>
            )}
          </>)}
          {changed && !update.isError && (
            <p className="small">Focus: {changed.topic}. <Button disabled={update.isPending} onClick={undoFocus}>Undo</Button></p>
          )}
          {update.isError && <p className="small" role="alert">Couldn't change focus. Try again.</p>}
        </div>
        <Disclosure summary="Colors">
          <ul className="legend">
            {ALL_LEVELS.map((l) => <li key={l}><span className={`topic lvl-${l}`}>{LEVEL_LABEL[l]}</span></li>)}
          </ul>
        </Disclosure>
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
                <span className="muted small">{solveLabel(s)} · {relativeTime(s.accepted_at, now)}</span>
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
