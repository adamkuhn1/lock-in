import { Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import {
  useAddPrepSession, useAddStory, useApplications, useCompanyPrep, useDeleteStory, useLaunchRequests, useNow, usePracticeStory,
  usePrepItems, usePrepProgress, usePrepSessions, useRequestLaunch, useSaveCompanyPrep, useSetPrepProgress, useStories, useUpdateStory,
} from '../data/hooks';
import { STORY_TAGS, type PrepItem, type PrepKind, type PrepProgress, type PrepSession, type PrepStatus, type PrepTrack, type Story, type StoryInput } from '../data/types';
import { STAGE_LABEL } from '../lib/funnel';
import { mockState, type LaunchState } from '../lib/ideas';
import { countdown } from '../lib/calendar';
import { PREP_KIND_LABEL, missingTags, nextStatus, practicedLabel, prepCompanies, weekSessions, type PrepCompany } from '../lib/prep';
import { planDay, shortDate } from '../lib/time';
import { Button, Card, CardHead, Chip, Disclosure, Empty, ErrorDetail, LoadError, Skeleton } from '../ui/primitives';

const SAVE_ERROR = "Couldn't save. Try again.";
const ST_LABEL: Record<PrepStatus | 'none', string> = { none: 'Not started', learning: 'Learning', solid: 'Solid' };

function CompanyForm({ c }: { c: PrepCompany }) {
  const save = useSaveCompanyPrep();
  const [notes, setNotes] = useState(c.prep?.notes ?? '');
  const [links, setLinks] = useState(c.prep?.links ?? '');
  const [date, setDate] = useState(c.prep?.interview_on ?? '');
  const [saved, setSaved] = useState(false);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSaved(false);
    save.mutate({ company: c.company, notes: notes.trim(), links: links.trim(), interview_on: date || null }, { onSuccess: () => setSaved(true) });
  };
  return (
    <form className="stack" onSubmit={submit}>
      <label className="field"><span>Notes</span>
        <textarea aria-label={`${c.company} notes`} rows={4} maxLength={4000} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
      <label className="field"><span>Links</span>
        <input aria-label={`${c.company} links`} maxLength={1000} value={links} onChange={(e) => setLinks(e.target.value)} /></label>
      <label className="field"><span>Interview date</span>
        <input aria-label={`${c.company} interview date`} type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
      <div className="row-actions">
        <Button type="submit" variant="primary" aria-label={`Save ${c.company}`} disabled={save.isPending}>Save</Button>
        <span className="muted small" aria-live="polite">{saved ? 'Saved' : ''}</span>
      </div>
      {save.isError && <p role="alert" className="error small">{SAVE_ERROR}</p>}
    </form>
  );
}

function CompanyPrepCard({ companies, day }: { companies: PrepCompany[]; day: string }) {
  return (
    <Card data-primary aria-labelledby="cp-h">
      <CardHead id="cp-h" title="Company prep" />
      {companies.length === 0 ? (
        <Empty>No OAs or interviews yet. Prep cards appear here when your Sheet moves an application to OA or interview.</Empty>
      ) : companies.map((c) => (
        <Disclosure key={c.company} summary={
          <span className="cp-sum">
            <span>{c.company}</span>
            <span className="muted small">
              {[c.stage ? STAGE_LABEL[c.stage] : null, c.prep?.interview_on ? `interview ${countdown(c.prep.interview_on, day)}` : null].filter(Boolean).join(' · ')}
            </span>
          </span>}>
          <CompanyForm c={c} />
        </Disclosure>
      ))}
    </Card>
  );
}

function LogPrepCard({ day, sessions }: { day: string; sessions: PrepSession[] }) {
  const add = useAddPrepSession();
  const [minutes, setMinutes] = useState('30');
  const [note, setNote] = useState('');
  const m = Math.round(Number(minutes));
  const valid = Number.isFinite(m) && m >= 1 && m <= 600;
  const log = (kind: PrepKind) =>
    add.mutate({ kind, minutes: m, note: note.trim() || null, happened_on: day }, { onSuccess: () => setNote('') });
  return (
    <Card aria-labelledby="log-h">
      <CardHead id="log-h" title="Log prep" />
      <div className="prep-fields">
        <label className="field"><span>Minutes</span>
          <input type="number" inputMode="numeric" min={1} max={600} value={minutes} onChange={(e) => setMinutes(e.target.value)} /></label>
        <label className="field"><span>Note (optional)</span>
          <input maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} /></label>
      </div>
      {!valid && <p className="error small">Minutes: 1 to 600.</p>}
      <div className="row-actions">
        {(['oa', 'mock', 'study'] as const).map((k) => (
          <Button key={k} variant="primary" disabled={add.isPending || !valid} onClick={() => log(k)}>Log {PREP_KIND_LABEL[k]}</Button>
        ))}
      </div>
      {add.isError && <p role="alert" className="error small">{SAVE_ERROR}</p>}
      <h3 className="label">This week</h3>
      {sessions.length === 0 ? <Empty>No prep logged this week.</Empty> : (
        <ul className="list">
          {sessions.map((s) => (
            <li key={s.id} className="list-row">
              <span>{[PREP_KIND_LABEL[s.kind], s.minutes ? `${s.minutes} min` : null, s.note].filter(Boolean).join(' · ')}</span>
              <span className="muted small">{shortDate(s.happened_on)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function MockCard({ companies, state }: { companies: string[]; state: LaunchState }) {
  const launch = useRequestLaunch();
  const [company, setCompany] = useState('');
  const queued = state.kind === 'queued';
  const go = (mode: 'behavioral' | 'technical') => launch.mutate({ kind: 'mock_interview', payload: { mode, company: company || null } });
  return (
    <Card aria-labelledby="mock-h">
      <CardHead id="mock-h" title="Mock with Claude" />
      <p className="muted small">Opens Claude Code on your Mac for a 30-minute mock, then logs it.</p>
      {companies.length > 0 && (
        <label className="field"><span>Company (optional)</span>
          <select value={company} onChange={(e) => setCompany(e.target.value)}>
            <option value="">Any company</option>
            {companies.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
      )}
      <div className="row-actions">
        <Button variant="primary" disabled={queued || launch.isPending} onClick={() => go('behavioral')}>Behavioral</Button>
        <Button disabled={queued || launch.isPending} onClick={() => go('technical')}>Technical</Button>
        {queued && <span className="muted small">Queued for Mac</span>}
        {state.kind === 'launched' && <span className="muted small">Opened on Mac</span>}
      </div>
      {state.kind === 'failed' && <ErrorDetail error={state.error} />}
      {launch.isError && <p role="alert" className="error small">{SAVE_ERROR}</p>}
    </Card>
  );
}

const EMPTY_STORY: StoryInput = { title: '', tags: [], situation: '', task: '', action: '', result: '' };

function StoryForm({ initial, submitLabel, busy, onSave, onCancel }: {
  initial: StoryInput; submitLabel: string; busy: boolean; onSave: (s: StoryInput) => void; onCancel?: () => void;
}) {
  const [f, setF] = useState<StoryInput>({ title: initial.title, tags: initial.tags, situation: initial.situation, task: initial.task, action: initial.action, result: initial.result });
  const [err, setErr] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!f.title.trim()) { setErr('Title is required.'); return; }
    setErr(null);
    onSave({ ...f, title: f.title.trim() });
  };
  const area = (k: 'situation' | 'task' | 'action' | 'result', label: string) => (
    <label className="field"><span>{label}</span>
      <textarea rows={2} maxLength={1500} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>
  );
  return (
    <form className="stack" onSubmit={submit}>
      <label className="field"><span>Title</span>
        <input maxLength={120} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
      <div className="chips" role="group" aria-label="Tags">
        {STORY_TAGS.map((t) => (
          <Chip key={t} pressed={f.tags.includes(t)}
            onToggle={() => setF({ ...f, tags: f.tags.includes(t) ? f.tags.filter((x) => x !== t) : [...f.tags, t] })}>{t}</Chip>
        ))}
      </div>
      {area('situation', 'Situation')}{area('task', 'Task')}{area('action', 'Action')}{area('result', 'Result')}
      {err && <p role="alert" className="error small">{err}</p>}
      <div className="row-actions">
        <Button type="submit" variant="primary" disabled={busy}>{submitLabel}</Button>
        {onCancel && <Button variant="quiet" onClick={onCancel}>Cancel</Button>}
      </div>
    </form>
  );
}

function StoryRow({ story, day }: { story: Story; day: string }) {
  const update = useUpdateStory();
  const del = useDeleteStory();
  const practice = usePracticeStory();
  const [confirm, setConfirm] = useState(false);
  const today = story.last_practiced_on === day;
  return (
    <li className="story-row">
      <Disclosure summary={
        <span className="cp-sum">
          <span>{story.title}</span>
          <span className="muted small">{(story.tags.join(' · ') || 'no tags')} · practiced {practicedLabel(story.last_practiced_on, day)}</span>
        </span>}>
        <StoryForm initial={story} submitLabel="Save changes" busy={update.isPending} onSave={(s) => update.mutate({ id: story.id, patch: s })} />
        <div className="row-actions">
          <Button variant="primary" disabled={practice.isPending || today} onClick={() => practice.mutate({ id: story.id, day })}>
            {today ? 'Practiced today' : 'Practiced'}
          </Button>
          {confirm ? (
            <>
              <Button variant="danger" disabled={del.isPending} onClick={() => del.mutate(story.id)}>Delete story</Button>
              <Button variant="quiet" onClick={() => setConfirm(false)}>Keep</Button>
            </>
          ) : <Button variant="quiet" onClick={() => setConfirm(true)}>Delete</Button>}
        </div>
        {(update.isError || del.isError || practice.isError) && <p role="alert" className="error small">{SAVE_ERROR}</p>}
      </Disclosure>
    </li>
  );
}

function StoriesCard({ stories, day }: { stories: Story[]; day: string }) {
  const add = useAddStory();
  const [adding, setAdding] = useState(false);
  const missing = missingTags(stories);
  return (
    <Card aria-labelledby="stories-h">
      <CardHead id="stories-h" title="Story bank">
        <Button variant="quiet" disabled={adding} onClick={() => setAdding(true)}><Plus size={18} aria-hidden />New story</Button>
      </CardHead>
      {missing.length > 0 && <p className="muted small">No story for: {missing.join(', ')}</p>}
      {adding && (
        <section aria-label="New story">
          <StoryForm initial={EMPTY_STORY} submitLabel="Save story" busy={add.isPending} onCancel={() => setAdding(false)}
            onSave={(s) => add.mutate(s, { onSuccess: () => setAdding(false) })} />
        </section>
      )}
      {add.isError && <p role="alert" className="error small">{SAVE_ERROR}</p>}
      {stories.length === 0 && !adding ? <Empty>No stories yet.</Empty> : (
        <ul className="list">{stories.map((s) => <StoryRow key={s.id} story={s} day={day} />)}</ul>
      )}
    </Card>
  );
}

function FundamentalsCard({ items, progress }: { items: PrepItem[]; progress: PrepProgress[] }) {
  const set = useSetPrepProgress();
  const status = new Map(progress.map((p) => [p.item_id, p.status]));
  const track = (t: PrepTrack, title: string) => {
    const list = items.filter((i) => i.track === t).sort((a, b) => a.ord - b.ord);
    const solid = list.filter((i) => status.get(i.id) === 'solid').length;
    return (
      <Disclosure summary={`${title} (${solid}/${list.length} solid)`}>
        <ul className="list">
          {list.map((i) => {
            const st = status.get(i.id) ?? null;
            return (
              <li key={i.id} className="prep-item">
                <span>{i.title}</span>
                {/* The button holds only the short state word (labels stay <= 24 chars); its ::after stretches the tap area over the whole row. */}
                <button type="button" className={`check-item s-${st ?? 'none'}`} aria-label={`${i.title}: ${ST_LABEL[st ?? 'none']}`}
                  disabled={set.isPending} onClick={() => set.mutate({ itemId: i.id, status: nextStatus(st) })}>
                  <span className="check-state">{ST_LABEL[st ?? 'none']}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </Disclosure>
    );
  };
  return (
    <Card aria-labelledby="fund-h">
      <CardHead id="fund-h" title="Fundamentals" />
      {track('system_design', 'System design')}
      {track('cs', 'CS fundamentals')}
      {set.isError && <p role="alert" className="error small">{SAVE_ERROR}</p>}
    </Card>
  );
}

export default function Prep() {
  const now = useNow();
  const day = planDay(now);
  const apps = useApplications();
  const cprep = useCompanyPrep();
  const sessions = usePrepSessions();
  const stories = useStories();
  const items = usePrepItems();
  const progress = usePrepProgress();
  const requests = useLaunchRequests();
  const queries = [apps, cprep, sessions, stories, items, progress];
  if (queries.some((q) => q.isPending)) return <Skeleton label="Loading prep" />;
  if (queries.some((q) => q.isError)) return <LoadError what="prep" onRetry={() => queries.forEach((q) => void q.refetch())} />;
  const companies = prepCompanies(apps.data ?? [], cprep.data ?? [], day);
  return (
    <div className="screen">
      <header className="screen-head"><h1>Prep</h1></header>
      <CompanyPrepCard companies={companies} day={day} />
      <LogPrepCard day={day} sessions={weekSessions(sessions.data ?? [], day)} />
      <MockCard companies={companies.map((c) => c.company)} state={mockState(requests.data ?? [], now)} />
      <StoriesCard stories={stories.data ?? []} day={day} />
      <FundamentalsCard items={items.data ?? []} progress={progress.data ?? []} />
    </div>
  );
}
