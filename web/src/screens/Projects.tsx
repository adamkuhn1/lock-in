import { ChevronDown, ChevronUp, MoreHorizontal, Plus, X } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type Ref } from 'react';
import {
  useAddIdea, useCommits, useIdeas, useLaunchRequests, useNow, useProjects, useReorderIdeas, useRequestLaunch, useUpdateIdea, useWorkOnIdea,
} from '../data/hooks';
import type { Commit, Idea, LaunchRequest, Project } from '../data/types';
import { commitStrip, doneIdeas, moveIdea, nextPosition, suggestState, visibleIdeas, workPrevStatus, workState } from '../lib/ideas';
import { localDay, relativeTime } from '../lib/time';
import { IdeaCard } from '../ui/IdeaCard';
import { Button, Card, CardHead, Disclosure, Empty, ErrorDetail, ExternalLink, LoadError, Skeleton } from '../ui/primitives';
import { TodayIdeaCard } from './TodayIdea';

/** The row's "…" menu: closes after an action, on Escape and on a click outside, and hands focus back to its toggle. */
function IdeaMenu({ label, first, last, onMove, onDrop }: {
  label: string; first: boolean; last: boolean; onMove: (dir: -1 | 1) => void; onDrop: () => void;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const close = (refocus: boolean) => {
    const d = ref.current;
    if (!d?.open) return;
    d.open = false;
    if (refocus) d.querySelector('summary')?.focus();
  };
  useEffect(() => {
    const outside = (e: PointerEvent) => {
      const d = ref.current;
      if (d?.open && !d.contains(e.target as Node)) d.open = false;
    };
    const escape = (e: KeyboardEvent) => {
      const d = ref.current;
      if (e.key !== 'Escape' || !d?.open) return;
      d.open = false;
      d.querySelector('summary')?.focus();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, []);
  return (
    <details ref={ref} className="idea-menu" data-idea-menu>
      <summary className="btn btn-quiet" aria-label={`More: ${label}`}><MoreHorizontal size={18} aria-hidden /></summary>
      <div className="idea-menu-body">
        <Button variant="quiet" aria-label={`Move up: ${label}`} disabled={first} onClick={() => { onMove(-1); close(true); }}><ChevronUp size={18} aria-hidden /></Button>
        <Button variant="quiet" aria-label={`Move down: ${label}`} disabled={last} onClick={() => { onMove(1); close(true); }}><ChevronDown size={18} aria-hidden /></Button>
        <Button variant="quiet" aria-label={`Drop: ${label}`} onClick={() => { close(false); onDrop(); }}><X size={18} aria-hidden /></Button>
      </div>
    </details>
  );
}

function AddIdea({ label, busy, onAdd, inputRef }: {
  label: string; busy: boolean; onAdd: (text: string, size: 'S' | 'M') => void; inputRef?: Ref<HTMLInputElement>;
}) {
  const [text, setText] = useState('');
  const [size, setSize] = useState<'S' | 'M'>('S');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    onAdd(t, size);
    setText('');
  };
  return (
    <form className="inline-form" onSubmit={submit}>
      <input ref={inputRef} aria-label={label} placeholder="Add an idea" maxLength={200} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="seg" role="group" aria-label="Size">
        {(['S', 'M'] as const).map((s) => (
          <Button key={s} aria-pressed={size === s} onClick={() => setSize(s)}>{s}</Button>
        ))}
      </div>
      <Button type="submit" variant="primary" aria-label="Add idea" disabled={busy || !text.trim()}><Plus size={18} aria-hidden /></Button>
    </form>
  );
}

function ProjectCard({ project, primary, now, commits, ideas, requests }: {
  project: Project; primary: boolean; now: Date; commits: Commit[]; ideas: Idea[]; requests: LaunchRequest[];
}) {
  const addIdea = useAddIdea();
  const updateIdea = useUpdateIdea();
  const reorder = useReorderIdeas();
  const launch = useRequestLaunch();
  const work = useWorkOnIdea();
  const strip = commitStrip(commits, project.id, localDay(now));
  const last = commits
    .filter((c) => c.project_id === project.id)
    .sort((a, b) => Date.parse(b.committed_at) - Date.parse(a.committed_at))[0];
  const list = visibleIdeas(ideas, project.id);
  const done = doneIdeas(ideas, project.id);
  const suggest = suggestState(requests, project.id, now);
  const headId = `proj-${project.id}`;
  const listRef = useRef<HTMLOListElement>(null);
  const addRef = useRef<HTMLInputElement>(null);
  // Done and Drop remove the row: move focus to the neighbouring row's menu (or the add field) so it isn't lost.
  const leave = (i: number, patch: Parameters<typeof updateIdea.mutate>[0]['patch']) => {
    const rows = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-idea-menu] > summary') ?? [])];
    (rows[i + 1] ?? rows[i - 1] ?? addRef.current)?.focus();
    updateIdea.mutate({ id: list[i].id, patch });
  };

  return (
    <Card data-primary={primary || undefined} aria-labelledby={headId}>
      <CardHead id={headId} title={project.name}>
        {project.repo && <ExternalLink className="btn btn-quiet" href={`https://github.com/${project.repo}`}>GitHub</ExternalLink>}
      </CardHead>
      <p className="muted small">{!project.repo ? 'No repo linked' : last ? `${relativeTime(last.committed_at, now)} · ${last.message}` : 'No commits yet'}</p>
      <div className="strip" role="img" aria-label={`Commits on ${strip.filter((n) => n > 0).length} of the last 30 days`}>
        {strip.map((n, i) => <span key={i} className={n > 0 ? 'on' : undefined} />)}
      </div>
      {list.length === 0 ? (
        <Empty>No ideas yet.</Empty>
      ) : (
        <ol ref={listRef} className="idea-list">
          {list.map((idea, i) => (
            <IdeaCard key={idea.id} idea={idea} state={workState(requests, idea.id, now)} busy={work.isPending}
              onWork={() => work.mutate({ id: idea.id, status: idea.status })}
              resending={launch.isPending}
              onResend={() => launch.mutate({ kind: 'work_on_idea', payload: { idea_id: idea.id, prev_status: workPrevStatus(requests, idea.id) } })}
              onDone={() => leave(i, { status: 'done', done_at: new Date().toISOString() })}
              menu={<IdeaMenu label={idea.text} first={i === 0} last={i === list.length - 1}
                onMove={(dir) => reorder.mutate(moveIdea(list, idea.id, dir))}
                onDrop={() => leave(i, { status: 'dropped' })} />} />
          ))}
        </ol>
      )}
      <AddIdea inputRef={addRef} label={`New idea for ${project.name}`} busy={addIdea.isPending}
        onAdd={(text, size) => addIdea.mutate({ project_id: project.id, text, size, position: nextPosition(list) })} />
      <div className="row-actions">
        <Button disabled={suggest.kind === 'queued' || launch.isPending}
          onClick={() => launch.mutate({ kind: 'suggest_ideas', payload: { project_id: project.id } })}>
          {suggest.kind === 'queued' ? 'Queued for Mac' : suggest.kind === 'failed' ? 'Try again' : 'Suggest improvements'}
        </Button>
        {suggest.kind === 'launched' && <span className="muted small">Opened on Mac</span>}
      </div>
      {(launch.isError || addIdea.isError || updateIdea.isError || reorder.isError || work.isError) && <p role="alert" className="error small">Couldn't save. Try again.</p>}
      {suggest.kind === 'failed' && <ErrorDetail error={suggest.error} />}
      {done.length > 0 && (
        <Disclosure summary={`Done (${done.length})`}>
          <ul className="list">{done.map((d) => <li key={d.id} className="list-row muted">{d.text}</li>)}</ul>
        </Disclosure>
      )}
    </Card>
  );
}

export function ProjectsList() {
  const now = useNow();
  const projects = useProjects();
  const commits = useCommits();
  const ideas = useIdeas();
  const requests = useLaunchRequests();
  const active = (projects.data ?? []).filter((p) => p.active);
  if (projects.isPending) return <Skeleton label="Loading projects" />;
  if (projects.isError) return <LoadError what="projects" onRetry={() => void projects.refetch()} />;
  if (active.length === 0) return <Empty>No active projects. Add one in Settings.</Empty>;
  return (
    <>
      {active.map((p, i) => (
        <ProjectCard key={p.id} project={p} primary={i === 0} now={now}
          commits={commits.data ?? []} ideas={ideas.data ?? []} requests={requests.data ?? []} />
      ))}
    </>
  );
}

/** The Projects tab: today's idea, then every active project with its ideas. */
export default function Projects() {
  return (
    <div className="screen">
      <header className="screen-head"><h1>Projects</h1></header>
      <TodayIdeaCard />
      <ProjectsList />
    </div>
  );
}
