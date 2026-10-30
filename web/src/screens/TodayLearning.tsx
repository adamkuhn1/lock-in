import { Link } from 'react-router';
import { useLaunchRequests, useNow, useRequestLaunch, useSettings } from '../data/hooks';
import { launchState } from '../lib/ideas';
import { lessonPath } from '../lib/lessons';
import { QUESTIONS_PER_LESSON, REVIEW_LESSONS_MAX, SECONDS_PER_QUESTION, lessonReviewsDue } from '../lib/lessonReview';
import { TRACKS, TYPE_LABEL, fmtMinutes, reviewsDue, split, whatsNext } from '../lib/learn';
import { planDay } from '../lib/time';
import { safeHref } from '../lib/url';
import { Button, ExternalLink } from '../ui/primitives';
import { useLearnData } from './Learn';

const trackLabel = (id: string) => TRACKS.find((t) => t.id === id)?.label ?? id;

/** Today's study time, split between interview prep and learning, and the one learning step for today. */
export function TodayLearning({ lcDone, lcTotal }: { lcDone: number; lcTotal: number }) {
  const now = useNow();
  const today = planDay(now);
  const settings = useSettings();
  const { state, data } = useLearnData();
  const requests = useLaunchRequests();
  const launch = useRequestLaunch();
  const s = split(settings.data);
  const next = state === 'ready' ? whatsNext(data, today, s.learn) : { kind: 'none' as const };
  const due = state === 'ready' ? reviewsDue(data, today).length : 0;
  const lcLeft = lcTotal > 0 && lcDone < lcTotal;
  const reqs = requests.data ?? [];
  const warm = state === 'ready' ? Math.min(lessonReviewsDue(data.progress, data.checks, today).length, REVIEW_LESSONS_MAX) : 0;
  const warmMin = Math.max(1, Math.round((warm * QUESTIONS_PER_LESSON * SECONDS_PER_QUESTION) / 60));

  let step = null;
  if (next.kind === 'review') {
    const st = launchState(reqs, (r) => r.kind === 'review_module' && r.payload.module_id === next.view.module.id, now);
    step = (
      <>
        <p className="small"><b>Review:</b> {next.view.module.title} <span className="muted">({trackLabel(next.view.module.track)}, 3 questions)</span></p>
        <div className="row-actions">
          <Button variant="primary" disabled={launch.isPending || st.kind === 'queued'}
            onClick={() => launch.mutate({ kind: 'review_module', payload: { module_id: next.view.module.id } })}>
            {st.kind === 'queued' ? 'Queued for Mac' : st.kind === 'launched' ? 'Opened on Mac' : 'Start review'}
          </Button>
        </div>
      </>
    );
  } else if (next.kind === 'lesson') {
    const v = next.view;
    step = (
      <>
        <p className="small">
          <b>Lesson {next.lesson.ord}:</b> {next.lesson.title}{' '}
          <span className="muted">({trackLabel(v.module.track)} {v.module.ord}. {v.module.title}, {fmtMinutes(next.lesson.minutes)}, on your Mac)</span>
        </p>
        <div className="row-actions">
          <Link className={`btn ${lcLeft || warm ? '' : 'btn-primary'}`.trim()} to={lessonPath(v.module.track, next.lesson)}>
            {next.status === 'in_progress' ? 'Continue lesson' : 'Start lesson'}
          </Link>
          <Link className="btn btn-quiet" to={`/grind/learn/${v.module.track}?module=${v.module.id}`}>{trackLabel(v.module.track)} track</Link>
        </div>
      </>
    );
  } else if (next.kind === 'item' || next.kind === 'check') {
    const v = next.view;
    const href = next.kind === 'item' ? safeHref(next.item.url) : null;
    const st = next.kind === 'item'
      ? launchState(reqs, (r) => r.kind === 'teach_item' && r.payload.item_id === next.item.id, now)
      : launchState(reqs, (r) => r.kind === 'check_module' && r.payload.module_id === v.module.id, now);
    step = (
      <>
        <p className="small">
          <b>{next.kind === 'item' ? `${TYPE_LABEL[next.item.type]}:` : 'Check:'}</b>{' '}
          {next.kind === 'item' ? next.item.title : `quiz on ${v.module.title}`}{' '}
          <span className="muted">
            ({trackLabel(v.module.track)} {v.module.ord}. {v.module.title}
            {next.kind === 'item' && `, ${next.partial ? `${fmtMinutes(next.minutes)} of it today` : fmtMinutes(next.minutes)}`})
          </span>
        </p>
        <div className="row-actions">
          <Button variant={lcLeft ? 'ghost' : 'primary'} disabled={launch.isPending || st.kind === 'queued'}
            onClick={() => launch.mutate(next.kind === 'item'
              ? { kind: 'teach_item', payload: { item_id: next.item.id } }
              : { kind: 'check_module', payload: { module_id: v.module.id } })}>
            {st.kind === 'queued' ? 'Queued for Mac' : st.kind === 'launched' ? 'Opened on Mac' : next.kind === 'item' ? 'Teach me' : 'Check me'}
          </Button>
          {href && <ExternalLink className="btn" href={href}>Open</ExternalLink>}
          <Link className="btn btn-quiet" to={`/grind/learn/${v.module.track}`}>{trackLabel(v.module.track)} track</Link>
        </div>
      </>
    );
  } else if (state === 'ready' && data.modules.length > 0) {
    step = <p className="muted small">Every module is done and no reviews are due.</p>;
  }

  return (
    <section className="today-time" aria-labelledby="time-h">
      <h2 id="time-h">Today's time</h2>
      <div className="split-bar" role="img" aria-label={`Interview prep ${100 - s.learnPct}%, learning ${s.learnPct}%`}>
        <span className="prep" style={{ width: `${100 - s.learnPct}%` }} />
        <span className="learn" style={{ width: `${s.learnPct}%` }} />
      </div>
      <div className="split">
        <div>
          <p className="label">Interview prep · {fmtMinutes(s.prep)}</p>
          <p className="small">LeetCode {lcDone}/{lcTotal}{lcLeft ? ' · do this first' : lcTotal ? ' · done' : ''}</p>
        </div>
        <div>
          <p className="label">Learning · {fmtMinutes(s.learn)}</p>
          {due > 1 && <p className="small">{due} reviews due</p>}
        </div>
      </div>
      {warm > 0 && (
        <div className="warmup">
          <p className="small"><b>Warm-up:</b> review {warm} finished {warm === 1 ? 'lesson' : 'lessons'}, about {warmMin} min. Do it first: it's what makes them stick.</p>
          <Link className={`btn ${lcLeft ? '' : 'btn-primary'}`.trim()} to="/grind/review">Start review</Link>
        </div>
      )}
      {step}
      {launch.isError && <p role="alert" className="error small">Couldn't queue it. Try again.</p>}
    </section>
  );
}
