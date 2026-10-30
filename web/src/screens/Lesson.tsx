import { Check, X } from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Link, useParams } from 'react-router';
import { useLearnModules, useLearnProgress, useNow, useSaveLearnProgress } from '../data/hooks';
import type { LearnProgress } from '../data/types';
import { TRACKS } from '../lib/learn';
import {
  findLesson, lessonItemId, lessonPath, lessonRating, lessonsFor, loadLessonFiles, readDraft, writeDraft,
  type Draft, type Lesson as LessonT, type LessonFiles, type QuizQuestion,
} from '../lib/lessons';
import { getRunner, type GradeResult } from '../lib/python';
import { planDay } from '../lib/time';
import { RATINGS } from '../lib/today';
import { CodeEditor } from '../ui/CodeEditor';
import { prefersReducedMotion } from '../ui/motion';
import { Markdown, MarkdownInline, highlightPython } from '../ui/Markdown';
import { Badge, Button, Disclosure, Empty, Skeleton } from '../ui/primitives';

const DESKTOP = '(min-width: 900px)';
function useDesktop() {
  return useSyncExternalStore(
    (cb) => { if (typeof window.matchMedia !== 'function') return () => {}; const m = window.matchMedia(DESKTOP); m.addEventListener('change', cb); return () => m.removeEventListener('change', cb); },
    () => typeof window.matchMedia !== 'function' || window.matchMedia(DESKTOP).matches,
  );
}

function useRunnerState() {
  const runner = getRunner();
  return useSyncExternalStore(runner.subscribe, runner.state);
}

function QuizQ({ q, n }: { q: QuizQuestion; n: number }) {
  const [picked, setPicked] = useState<number | null>(null);
  const chosen = picked === null ? null : q.options[picked];
  return (
    <fieldset className="quiz">
      <legend><span className="label">Question {n}</span> <MarkdownInline text={q.q} /></legend>
      <div className="quiz-options">
        {q.options.map((o, i) => (
          <button key={i} type="button" className={`quiz-option${picked === i ? (o.correct ? ' is-right' : ' is-wrong') : ''}`}
            aria-pressed={picked === i} onClick={() => setPicked(i)}>
            {picked === i && (o.correct ? <Check size={16} aria-hidden /> : <X size={16} aria-hidden />)}
            <MarkdownInline text={o.text} />
          </button>
        ))}
      </div>
      <p className={`small quiz-why${chosen ? (chosen.correct ? ' is-right' : ' is-wrong') : ''}`} role="status">
        {chosen && <><b>{chosen.correct ? 'Right.' : 'Not quite.'}</b> <MarkdownInline text={chosen.why} />{!chosen.correct && ' Try another.'}</>}
      </p>
    </fieldset>
  );
}

function Results({ r, error }: { r: GradeResult | null; error: string | null }) {
  if (error) return <p role="alert" className="error small">{error}</p>;
  if (!r) return null;
  const passed = r.tests.filter((t) => t.ok).length;
  return (
    <div className="results">
      {r.error ? (
        <pre className="result-error">{r.error}</pre>
      ) : (
        <>
          <p className={`results-sum ${r.passed ? 'is-pass' : 'is-fail'}`}>
            {r.passed ? `All ${r.tests.length} tests pass` : `${passed} of ${r.tests.length} tests pass`}
          </p>
          <ul className="test-list">
            {r.tests.map((t, i) => (
              <li key={i} className={t.ok ? 'is-pass' : 'is-fail'}>
                {t.ok ? <Check size={16} aria-hidden /> : <X size={16} aria-hidden />}
                <span><span className="sr-only">{t.ok ? 'Passed: ' : 'Failed: '}</span>{t.name}
                  {!t.ok && <span className="test-msg">{t.message}</span>}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {r.stdout && (
        <div>
          <p className="label">Printed</p>
          <pre className="result-out">{r.stdout}</pre>
        </div>
      )}
    </div>
  );
}

function Exercise({ lesson, files, p, next, track }: {
  lesson: LessonT; files: LessonFiles; p: LearnProgress | undefined; next: LessonT | undefined; track: string;
}) {
  const now = useNow();
  const save = useSaveLearnProgress();
  const runnerState = useRunnerState();
  const desktop = useDesktop();
  const [draft, setDraft] = useState<Draft>(() => readDraft(lesson));
  const [code, setCode] = useState(() => draft.code ?? files.starter);
  const [resetKey, setResetKey] = useState(0);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<GradeResult | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [askSolution, setAskSolution] = useState(false);
  const resultsRef = useRef<HTMLDivElement>(null);
  const wrote = useRef<'started' | 'done' | null>(p?.status === 'done' ? 'done' : p?.status === 'in_progress' ? 'started' : null);
  const status = p?.status ?? 'not_started';

  useEffect(() => { if (desktop) void getRunner().warm(); }, [desktop]);

  const update = (d: Partial<Draft>) => setDraft((cur) => { const nd = { ...cur, ...d }; writeDraft(lesson, nd); return nd; });
  const onChange = (c: string) => { setCode(c); update({ code: c }); };

  const run = async () => {
    if (running) return;
    const today = planDay(now);
    setRunning(true);
    setRunError(null);
    if (!wrote.current) {
      wrote.current = 'started';
      save.mutate({ itemId: lessonItemId(lesson), patch: { status: 'in_progress', started_on: p?.started_on ?? today } });
    }
    try {
      const r = await getRunner().run(code, files.tests, files.prelude);
      setResult(r);
      requestAnimationFrame(() => resultsRef.current?.scrollIntoView?.({ block: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' }));
      if (r.passed && wrote.current !== 'done') {
        wrote.current = 'done';
        save.mutate({ itemId: lessonItemId(lesson), patch: {
          status: 'done', started_on: p?.started_on ?? today, done_on: today, rating: lessonRating(draft.hints, draft.sawSolution),
        } });
      }
    } catch (e) {
      setRunError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  const reset = () => { setCode(files.starter); update({ code: null }); setResult(null); setResetKey((k) => k + 1); };
  const passed = result?.passed ?? false;
  const rating = p?.rating ?? (passed ? lessonRating(draft.hints, draft.sawSolution) : null);
  const ratingLabel = RATINGS.find((r) => r.value === rating)?.label;

  return (
    <section className="card lesson-work" aria-labelledby="task-h">
      <div className="card-head">
        <h2 id="task-h">Your turn</h2>
        {status === 'done' && <Badge tone="accent">Done{ratingLabel ? ` · ${ratingLabel}` : ''}</Badge>}
      </div>
      <Markdown text={files.meta.task} className="prose small-prose" />
      {files.prelude && (
        <Disclosure summary="Given: code from earlier lessons">
          <p className="muted small">This runs before your code, so you can call these.</p>
          <pre className="code-block" tabIndex={0}><code dangerouslySetInnerHTML={{ __html: highlightPython(files.prelude) }} /></pre>
        </Disclosure>
      )}
      {desktop ? (
        <>
          <CodeEditor value={code} resetKey={resetKey} onChange={onChange} onRun={() => void run()} label={`Your code for ${lesson.title}`} />
          <div className="row-actions">
            <Button variant="primary" disabled={running} onClick={() => void run()} aria-keyshortcuts="Meta+Enter Control+Enter">
              {running ? (runnerState === 'loading' ? 'Loading Python' : 'Running') : 'Run tests'}
            </Button>
            <Button variant="quiet" disabled={running || code === files.starter} onClick={reset}>Reset code</Button>
            <span className="muted small kbd-hint">⌘ Enter runs the tests</span>
          </div>
          <div aria-live="polite" ref={resultsRef} className="results-anchor">
            <Results r={result} error={runError} />
          </div>
          {passed && (
            <div className="pass-row">
              <p className="small"><b>Done.</b>{ratingLabel && ` Saved as ${ratingLabel.toLowerCase()}.`}</p>
              {next
                ? <Link className="btn btn-primary" to={lessonPath(track, next)}>Next lesson</Link>
                : <Link className="btn btn-primary" to={`/grind/learn/${track}?module=${lesson.moduleId}`}>Back to module</Link>}
            </div>
          )}
          {save.isError && <p role="alert" className="error small">Couldn't save your progress. Run the tests again to retry.</p>}
        </>
      ) : (
        <p className="phone-note small">The code exercise runs on desktop. Read the lesson here, then open it on your Mac to code.</p>
      )}

      <div className="hints">
        {draft.hints > 0 && (
          <ol className="hint-list">
            {files.meta.hints.slice(0, draft.hints).map((h, i) => (
              <li key={i}><span className="label">Hint {i + 1}</span> <MarkdownInline text={h} /></li>
            ))}
          </ol>
        )}
        <div className="row-actions">
          {draft.hints < files.meta.hints.length && (
            <Button onClick={() => update({ hints: draft.hints + 1 })}>
              {draft.hints === 0 ? 'Show a hint' : 'Next hint'} ({files.meta.hints.length - draft.hints} left)
            </Button>
          )}
          {!draft.sawSolution && !askSolution && <Button variant="muted" onClick={() => setAskSolution(true)}>Show solution</Button>}
        </div>
        {askSolution && !draft.sawSolution && (
          <div className="confirm" role="group" aria-label="Show the solution?">
            <p className="small">Looking first saves this lesson as needed help. Try a hint first if you have one left.</p>
            <div className="row-actions">
              <Button variant="danger" onClick={() => { update({ sawSolution: true }); setAskSolution(false); }}>Yes, show it</Button>
              <Button variant="quiet" onClick={() => setAskSolution(false)}>Not yet</Button>
            </div>
          </div>
        )}
        {draft.sawSolution && (
          <div>
            <p className="label">Solution</p>
            <p className="muted small">Read it, close it, then type your own version. Retyping is what makes it stick.</p>
            <pre className="code-block" tabIndex={0}><code dangerouslySetInnerHTML={{ __html: highlightPython(files.solution) }} /></pre>
          </div>
        )}
      </div>
    </section>
  );
}

export default function Lesson() {
  const { track = 'cs', module = '', lesson: slug = '' } = useParams();
  const lesson = findLesson(module, slug);
  const modules = useLearnModules();
  const progress = useLearnProgress();
  const [files, setFiles] = useState<LessonFiles | null>(null);

  useEffect(() => {
    let live = true;
    setFiles(null);
    if (lesson) void loadLessonFiles(lesson).then((f) => { if (live) setFiles(f); });
    return () => { live = false; };
  }, [lesson]);

  if (!lesson) {
    return (
      <div className="screen">
        <header className="screen-head"><h1>Lesson not found</h1></header>
        <Empty>That lesson doesn't exist (any more).</Empty>
        <div data-primary className="row-actions"><Link className="btn" to={`/grind/learn/${track}`}>Back to the track</Link></div>
      </div>
    );
  }

  const all = lessonsFor(lesson.moduleId);
  const idx = all.findIndex((l) => l.id === lesson.id);
  const prev = all[idx - 1];
  const next = all[idx + 1];
  const mod = modules.data?.find((m) => m.id === lesson.moduleId);
  const trackLabel = TRACKS.find((t) => t.id === track)?.label ?? track;
  const p = progress.data?.find((r) => r.item_id === lessonItemId(lesson));

  return (
    <div className="screen lesson-screen">
      <header className="lesson-head">
        <p className="label">
          <Link to={`/grind/learn/${track}?module=${lesson.moduleId}`} className="crumb">{trackLabel}{mod ? ` · ${mod.ord}. ${mod.title}` : ''}</Link>
          {' · '}Lesson {idx + 1} of {all.length} · {lesson.minutes} min
        </p>
        <h1>{lesson.title}</h1>
      </header>
      {!files || progress.isPending ? (
        <Skeleton label="Loading the lesson" />
      ) : (
        <div className="lesson-grid">
          <article className="card lesson-read" data-primary aria-label="Lesson">
            <Markdown text={files.md} />
            {files.meta.quiz && files.meta.quiz.length > 0 && (
              <section className="quiz-block" aria-labelledby="quiz-h">
                <h2 id="quiz-h">Quick check</h2>
                {files.meta.quiz.map((q, i) => <QuizQ key={`${lesson.id}-${i}`} q={q} n={i + 1} />)}
              </section>
            )}
          </article>
          <Exercise key={lesson.id} lesson={lesson} files={files} p={p} next={next} track={track} />
        </div>
      )}
      <nav className="row-actions lesson-nav" aria-label="Lessons in this module">
        {prev && <Link className="btn btn-quiet" to={lessonPath(track, prev)}>Previous lesson</Link>}
        <Link className="btn btn-quiet" to={`/grind/learn/${track}?module=${lesson.moduleId}`}>All lessons</Link>
        {next && <Link className="btn btn-quiet" to={lessonPath(track, next)}>Next lesson</Link>}
      </nav>
    </div>
  );
}
