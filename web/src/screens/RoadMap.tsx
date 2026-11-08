import { Check, Lock } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { Level } from '../data/types';
import { LEVEL_LABEL, LEVELS, type MapTopic, nextStep } from '../lib/mastery';
import { ExternalLink } from '../ui/primitives';
import { RatingMark } from '../ui/RatingMark';

const Y_SCALE = 1; // NeetCode's own spacing: anything tighter stacks the top topics on each other
const PAD_X = 120;
const PAD_Y = 64;
const open = (l: Level) => LEVELS.indexOf(l) >= LEVELS.indexOf('practicing');

/** NeetCode's roadmap, with each topic's level and how far it is toward Mastered. */
export function RoadMap({ topics, selected, onSelect }: { topics: MapTopic[]; selected: string | null; onSelect: (name: string) => void }) {
  const scroller = useRef<HTMLDivElement>(null);
  const xs = topics.map((t) => t.x);
  const ys = topics.map((t) => t.y * Y_SCALE);
  const minX = Math.min(...xs) - PAD_X;
  const minY = Math.min(...ys) - PAD_Y;
  const w = Math.max(...xs) + PAD_X - minX;
  const h = Math.max(...ys) + PAD_Y - minY;
  const at = new Map(topics.map((t) => [t.name, { x: t.x - minX, y: t.y * Y_SCALE - minY, t }]));
  const focus = topics.find((t) => t.isFocus)?.name ?? null;

  useEffect(() => {
    // On a phone the map is wider than the screen: start with the focus in view.
    const el = scroller.current;
    const f = focus ? at.get(focus) : null;
    if (!el || !f || el.scrollWidth <= el.clientWidth) return;
    el.scrollLeft = (f.x / w) * el.scrollWidth - el.clientWidth / 2;
  }, [focus]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="map-scroll" ref={scroller}>
      <div className="map" style={{ aspectRatio: `${w} / ${h}` }} role="group" aria-label="Roadmap">
        <svg className="map-edges" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
          {topics.flatMap((t) => t.prereqs.map((p) => {
            const a = at.get(p);
            const b = at.get(t.name);
            if (!a || !b) return null;
            const mid = (a.y + b.y) / 2;
            const cls = a.t.level === 'mastered' ? 'edge is-lit' : open(a.t.level) ? 'edge is-open' : 'edge';
            return <path key={`${p}>${t.name}`} className={cls} d={`M${a.x} ${a.y} C${a.x} ${mid} ${b.x} ${mid} ${b.x} ${b.y}`} />;
          }))}
        </svg>
        {topics.map((t) => {
          const p = at.get(t.name)!;
          const pct = Math.round(t.share * 100);
          return (
            <button key={t.name} type="button"
              className={`node lvl-${t.level}${t.isFocus ? ' is-focus' : ''}${selected === t.name ? ' is-selected' : ''}`}
              style={{ left: `${(p.x / w) * 100}%`, top: `${(p.y / h) * 100}%` }}
              aria-pressed={selected === t.name}
              aria-label={`${t.name}, ${LEVEL_LABEL[t.level]}${t.isFocus ? ', your focus' : ''}${t.level === 'locked' ? '' : `, ${pct}% to Mastered`}`}
              onClick={() => onSelect(t.name)}>
              {t.isFocus && <span className="node-flag" aria-hidden="true">Focus</span>}
              <span className="node-name">
                {t.level === 'locked' && <Lock size={12} aria-hidden />}
                {t.level === 'mastered' && <Check size={13} strokeWidth={3} aria-hidden />}
                {t.short}
              </span>
              <span className="node-level" aria-hidden="true">{LEVEL_LABEL[t.level]}</span>
              <span className="node-bar" aria-hidden="true"><span style={{ width: `${pct}%` }} /></span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const TRACK: Level[] = ['learning', 'practicing', 'solid', 'mastered'];

/** What the selected topic needs next, row by row. */
export function TopicPanel({ topic, children }: { topic: MapTopic; children?: React.ReactNode }) {
  const step = nextStep(topic.level, topic.progress, topic.pools);
  const reached = LEVELS.indexOf(topic.level);
  return (
    <section className="topic-panel" aria-labelledby="tp-h">
      <div className="tp-head">
        <h3 id="tp-h" className="tp-name">{topic.name}</h3>
        <span className={`tp-level lvl-${topic.level}`}>{LEVEL_LABEL[topic.level]}</span>
      </div>
      <ol className="tp-track" aria-label="Levels">
        {TRACK.map((l) => (
          <li key={l} className={LEVELS.indexOf(l) <= reached ? 'is-reached' : l === step.target ? 'is-next' : ''}
            aria-current={l === topic.level ? 'step' : undefined}>
            <span>{LEVEL_LABEL[l]}</span>
          </li>
        ))}
      </ol>

      {topic.level === 'locked' && topic.prereqs.length > 0 && (
        <p className="muted small">Unlocks when {topic.prereqs.join(' and ')} reach Practicing. You can still start it now.</p>
      )}
      <p className="tp-goal">{step.target ? <>To reach <b>{LEVEL_LABEL[step.target]}</b></> : <>Mastered. Mystery problems keep checking it.</>}</p>
      <ul className="reqs">
        {step.reqs.map((r) => (
          <li key={r.kind} className={r.met ? 'req is-met' : 'req'}>
            <span className="req-check" aria-hidden="true">{r.met && <Check size={14} strokeWidth={3} />}</span>
            <span className="req-text">{r.text}<span className="sr-only">{r.met ? ': done' : `: ${r.have} of ${r.need}`}</span></span>
            <span className="req-have num" aria-hidden="true">{Math.min(r.have, r.need)}/{r.need}</span>
            {r.kind === 'easy' && <EasyStrip cleared={topic.progress.easyCleared} total={topic.pools.easy} />}
            {r.kind === 'window' && <FirstTries tries={topic.progress.firstTries} window={r.window ?? 5} />}
          </li>
        ))}
      </ul>

      {topic.lessons.length > 0 && (
        <div className="tp-lessons">
          <p className="muted small">Learn the pattern on NeetCode</p>
          <ul className="row-actions">
            {topic.lessons.map((l) => <li key={l.url}><ExternalLink className="btn btn-quiet" href={l.url}>{l.name}</ExternalLink></li>)}
          </ul>
        </div>
      )}
      {children}
    </section>
  );
}

function EasyStrip({ cleared, total }: { cleared: number; total: number }) {
  return (
    <span className="easy-strip" aria-hidden="true">
      {Array.from({ length: total }, (_, i) => <span key={i} className={i < cleared ? 'is-on' : ''} />)}
    </span>
  );
}

function FirstTries({ tries, window }: { tries: MapTopic['progress']['firstTries']; window: number }) {
  const recent = tries.slice(-window);
  const slots = [...recent, ...Array(Math.max(window - recent.length, 0)).fill(null)];
  return (
    <span className="first-tries" aria-hidden="true">
      {slots.map((r, i) => <RatingMark key={i} rating={r} size={14} />)}
      <span className="muted small">{recent.length < window ? `${window - recent.length} more to try` : `last ${window}, oldest first`}</span>
    </span>
  );
}
