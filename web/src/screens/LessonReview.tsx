import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useAddLearnCheck, useLearnChecks, useLearnProgress, useNow } from '../data/hooks';
import { nextReview } from '../lib/learn';
import { REVIEW_LESSONS_MAX, SECONDS_PER_QUESTION, lessonReviewsDue, pickQuestions, reviewRating } from '../lib/lessonReview';
import { lessonItemId, loadLessonMeta, type Lesson, type Question as Q } from '../lib/lessons';
import { shortDate, planDay } from '../lib/time';
import { RATINGS } from '../lib/today';
import { Button, Card, Empty, LoadError, Skeleton } from '../ui/primitives';
import { Question } from '../ui/Question';

interface Item { lesson: Lesson; q: Q; last: boolean }
interface Scored { lesson: Lesson; score: number; total: number }

/** Today's spaced review: a couple of questions from each finished lesson that's due, one at a time. */
export default function LessonReview() {
  const now = useNow();
  const today = planDay(now);
  const progress = useLearnProgress();
  const checks = useLearnChecks();
  const add = useAddLearnCheck();
  const [items, setItems] = useState<Item[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [i, setI] = useState(0);
  const [answered, setAnswered] = useState(false);
  const [scores, setScores] = useState<Scored[]>([]);
  const right = useRef(0);
  const ready = progress.isSuccess && checks.isSuccess;

  // The session is fixed when it starts, so saving a lesson's result doesn't reshuffle what's left.
  useEffect(() => {
    if (!ready || items) return;
    const due = lessonReviewsDue(progress.data, checks.data, today).slice(0, REVIEW_LESSONS_MAX);
    Promise.all(due.map(async (d) => {
      const qs = pickQuestions((await loadLessonMeta(d.lesson)).review ?? [], d.reviewsSoFar);
      return qs.map((q, k): Item => ({ lesson: d.lesson, q, last: k === qs.length - 1 }));
    })).then((all) => setItems(all.flat()), () => setLoadFailed(true));
  }, [ready, items, progress.data, checks.data, today]);

  if (progress.isError || checks.isError || loadFailed) {
    return <div className="screen"><header className="screen-head"><h1>Review</h1></header>
      <LoadError what="your reviews" onRetry={() => { setLoadFailed(false); void progress.refetch(); void checks.refetch(); }} /></div>;
  }
  if (!items) return <div className="screen"><header className="screen-head"><h1>Review</h1></header><Skeleton label="Loading your review" /></div>;

  if (items.length === 0) {
    const upcoming = (progress.data ?? []).filter((p) => p.item_id.startsWith('lesson:') && p.status === 'done' && p.done_on)
      .map((p) => nextReview({ module_id: p.item_id, done_on: p.done_on! }, checks.data ?? [])).filter(Boolean).sort()[0];
    return (
      <div className="screen">
        <header className="screen-head"><h1>Review</h1></header>
        <Card data-primary>
          <Empty>Nothing to review today.{upcoming ? ` The next one is ${shortDate(upcoming)}.` : ' Finished lessons come back here 3, 7, 21, 60 and 120 days later.'}</Empty>
          <div className="row-actions"><Link className="btn" to="/">Back to Today</Link></div>
        </Card>
      </div>
    );
  }

  const finished = i >= items.length;
  const item = items[Math.min(i, items.length - 1)];

  const onFirstAnswer = (ok: boolean) => {
    if (ok) right.current += 1;
    setAnswered(true);
    if (item.last) {
      const total = items.filter((x) => x.lesson.id === item.lesson.id).length;
      const score = right.current;
      right.current = 0;
      setScores((s) => [...s, { lesson: item.lesson, score, total }]);
      add.mutate({ module_id: lessonItemId(item.lesson), kind: 'review', score, total, rating: reviewRating(score, total), summary: '', taken_on: today });
    }
  };

  if (finished) {
    const score = scores.reduce((n, s) => n + s.score, 0);
    return (
      <div className="screen">
        <header className="screen-head"><h1>Review</h1><span className="count">{score}/{items.length}</span></header>
        <Card data-primary aria-labelledby="rev-done-h">
          <h2 id="rev-done-h">Done: {score} of {items.length} right</h2>
          <ul className="list">
            {scores.map((s) => (
              <li key={s.lesson.id} className="list-row">
                <span>{s.lesson.title}</span>
                <span className="muted small">{s.score}/{s.total} · {RATINGS.find((r) => r.value === reviewRating(s.score, s.total))?.label}</span>
              </li>
            ))}
          </ul>
          <p className="muted small">Lessons you nailed come back later; the rest come back sooner.</p>
          {add.isError && <p role="alert" className="error small">Some results didn't save. They'll come back as due.</p>}
          <div className="row-actions"><Link className="btn btn-primary" to="/">Back to Today</Link></div>
        </Card>
      </div>
    );
  }

  return (
    <div className="screen">
      <header className="screen-head">
        <h1>Review</h1>
        <span className="count">{i + 1}/{items.length} · about {Math.max(1, Math.round((items.length * SECONDS_PER_QUESTION) / 60))} min</span>
      </header>
      <div className="review-bar" role="progressbar" aria-label="Review progress" aria-valuemin={0} aria-valuemax={items.length} aria-valuenow={i}>
        <span style={{ width: `${(i / items.length) * 100}%` }} />
      </div>
      <Card data-primary aria-label={`Question ${i + 1} of ${items.length}`}>
        <p className="label">From: {item.lesson.title}</p>
        <Question key={i} q={item.q} label={`Question ${i + 1}`} onFirstAnswer={onFirstAnswer} />
        <div className="row-actions">
          <Button variant="primary" disabled={!answered} onClick={() => { setAnswered(false); setI(i + 1); }}>
            {i + 1 === items.length ? 'Finish' : 'Next question'}
          </Button>
        </div>
      </Card>
    </div>
  );
}
