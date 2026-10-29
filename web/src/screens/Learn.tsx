import { useState } from 'react';
import { useParams } from 'react-router';
import {
  useLaunchRequests, useLearnChecks, useLearnItems, useLearnModules, useLearnProgress, useLearnStates, useNow, useRequestLaunch,
  useSaveLearnProgress, useSetModuleDone,
} from '../data/hooks';
import type { LearnItem, LearnProgress, LearnStatus, LearnTrack, Rating } from '../data/types';
import { launchState, type LaunchState } from '../lib/ideas';
import { STATUS_LABEL, TRACKS, TYPE_LABEL, TYPE_ORDER, moduleViews, progressMap, type LearnData, type ModuleView } from '../lib/learn';
import { planDay, shortDate } from '../lib/time';
import { RATINGS } from '../lib/today';
import { safeHref } from '../lib/url';
import { Badge, Button, Card, CardHead, Disclosure, Empty, ErrorDetail, ExternalLink, LoadError, Skeleton } from '../ui/primitives';

const MODULE_CLASS = { not_started: 'lvl-available', in_progress: 'lvl-learning', done: 'lvl-solid', review: 'lvl-practicing' } as const;
const MODULE_LABEL = { not_started: 'Not started', in_progress: 'In progress', done: 'Done', review: 'Review due' } as const;
const STATUSES: LearnStatus[] = ['not_started', 'in_progress', 'done'];
const hours = (h: number) => (h >= 1 ? `${h % 1 ? h.toFixed(1) : h} h` : `${Math.round(h * 60)} min`);

/** All five learning queries as one; a missing migration reads as empty, so the screen still loads. */
export function useLearnData(): { state: 'loading' | 'error' | 'ready'; data: LearnData; retry: () => void } {
  const qs = [useLearnModules(), useLearnItems(), useLearnProgress(), useLearnStates(), useLearnChecks()] as const;
  const [modules, items, progress, states, checks] = qs;
  return {
    state: qs.some((q) => q.isPending) ? 'loading' : qs.some((q) => q.isError) ? 'error' : 'ready',
    data: { modules: modules.data ?? [], items: items.data ?? [], progress: progress.data ?? [], states: states.data ?? [], checks: checks.data ?? [] },
    retry: () => qs.forEach((q) => void q.refetch()),
  };
}

function LaunchButton({ label, name, state, busy, onClick, variant = 'ghost' }: {
  label: string; name: string; state: LaunchState; busy: boolean; onClick: () => void; variant?: 'ghost' | 'primary';
}) {
  return (
    <>
      <Button variant={variant} aria-label={`${label}: ${name}`} disabled={busy || state.kind === 'queued'} onClick={onClick}>
        {state.kind === 'queued' ? 'Queued for Mac' : state.kind === 'failed' ? 'Try again' : label}
      </Button>
      {state.kind === 'launched' && <span className="muted small">Opened on Mac</span>}
    </>
  );
}

function ItemRow({ it, p, today, teach, busy, onPatch, onTeach }: {
  it: LearnItem; p: LearnProgress | undefined; today: string; teach: LaunchState; busy: boolean;
  onPatch: (patch: Partial<LearnProgress>) => void; onTeach: () => void;
}) {
  const status = p?.status ?? 'not_started';
  const [notes, setNotes] = useState(p?.notes ?? '');
  const href = safeHref(it.url);
  const setStatus = (s: LearnStatus) => onPatch({
    status: s, started_on: s === 'not_started' ? null : p?.started_on ?? today, done_on: s === 'done' ? p?.done_on ?? today : null,
  });
  return (
    <li className={`learn-item is-${status}`}>
      <p className="job-title">
        {it.title}
        {it.project && <> <Badge>{it.project}</Badge></>}
      </p>
      <p className="muted small">{[hours(it.hours), it.check_kind && { quiz: 'Claude quiz', explain: 'Explain it back', honor: 'Honor system' }[it.check_kind], STATUS_LABEL[status]].filter(Boolean).join(' · ')}</p>
      {it.details && <p className="small">{it.details}</p>}
      <div className="chips" role="group" aria-label={`Status: ${it.title}`}>
        {STATUSES.map((s) => (
          <button key={s} type="button" className="chip" aria-pressed={status === s} disabled={busy} onClick={() => setStatus(s)}>{STATUS_LABEL[s]}</button>
        ))}
      </div>
      {status !== 'not_started' && (
        <div className="chips" role="group" aria-label={`How it went: ${it.title}`}>
          {RATINGS.map((r) => (
            <button key={r.value} type="button" className="chip" aria-pressed={p?.rating === r.value} disabled={busy}
              onClick={() => onPatch({ rating: (p?.rating === r.value ? null : r.value) as Rating | null })}>
              <span aria-hidden="true">{r.emoji}</span> {r.label}
            </button>
          ))}
        </div>
      )}
      <div className="row-actions">
        {href && <ExternalLink className="btn" href={href}>Open</ExternalLink>}
        <LaunchButton label="Teach me" name={it.title} state={teach} busy={busy} onClick={onTeach} />
      </div>
      <Disclosure summary={p?.notes ? 'Notes' : 'Add notes'}>
        <label className="field">
          <span className="sr-only">Notes for {it.title}</span>
          <textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <Button disabled={busy || notes === (p?.notes ?? '')} onClick={() => onPatch({ notes })}>Save notes</Button>
      </Disclosure>
    </li>
  );
}

function ModuleDetail({ v, data, today }: { v: ModuleView; data: LearnData; today: string }) {
  const now = useNow();
  const requests = useLaunchRequests();
  const launch = useRequestLaunch();
  const save = useSaveLearnProgress();
  const setDone = useSetModuleDone();
  const prog = progressMap(data.progress);
  const reqs = requests.data ?? [];
  const checks = data.checks.filter((c) => c.module_id === v.module.id).sort((a, b) => b.taken_on.localeCompare(a.taken_on));
  const busy = save.isPending || launch.isPending || setDone.isPending;
  const check = launchState(reqs, (r) => r.kind === 'check_module' && r.payload.module_id === v.module.id, now);
  const review = launchState(reqs, (r) => r.kind === 'review_module' && r.payload.module_id === v.module.id, now);
  const headId = `mod-${v.module.id}`;
  const failed = [check, review].find((s) => s.kind === 'failed');
  return (
    <Card aria-labelledby={headId}>
      <CardHead id={headId} title={`${v.module.ord}. ${v.module.title}`}>
        <Badge tone={v.status === 'review' ? 'warn' : v.status === 'done' ? 'accent' : 'muted'}>{MODULE_LABEL[v.status]}</Badge>
      </CardHead>
      {v.module.summary && <p className="small">{v.module.summary}</p>}
      <p className="muted small">
        {v.done} of {v.total} done · about {hours(v.hours)}
        {v.doneOn && ` · finished ${shortDate(v.doneOn)}`}{v.nextReview && ` · next review ${shortDate(v.nextReview)}`}
      </p>
      <div className="row-actions">
        {v.status === 'review' && (
          <LaunchButton label="Review" name={v.module.title} state={review} busy={busy} variant="primary"
            onClick={() => launch.mutate({ kind: 'review_module', payload: { module_id: v.module.id } })} />
        )}
        <LaunchButton label="Check me" name={v.module.title} state={check} busy={busy}
          variant={v.status !== 'review' && v.done >= v.total - 1 && !v.doneOn ? 'primary' : 'ghost'}
          onClick={() => launch.mutate({ kind: 'check_module', payload: { module_id: v.module.id } })} />
        {v.doneOn ? (
          <Button variant="quiet" aria-label={`Not done: ${v.module.title}`} disabled={busy}
            onClick={() => setDone.mutate({ moduleId: v.module.id, doneOn: null })}>Mark not done</Button>
        ) : (
          <Button variant={v.done === v.total ? 'primary' : 'quiet'} aria-label={`Mark done: ${v.module.title}`} disabled={busy}
            onClick={() => setDone.mutate({ moduleId: v.module.id, doneOn: today })}>Mark module done</Button>
        )}
      </div>
      {failed?.kind === 'failed' && <ErrorDetail error={failed.error} />}
      {(save.isError || launch.isError || setDone.isError) && <p role="alert" className="error small">Couldn't save. Try again.</p>}
      {TYPE_ORDER.map((t) => {
        const list = v.items.filter((i) => i.type === t);
        if (!list.length) return null;
        return (
          <section key={t} className="learn-group" aria-label={TYPE_LABEL[t]}>
            <h3 className="label">{TYPE_LABEL[t]}</h3>
            <ul>
              {list.map((it) => (
                <ItemRow key={`${it.id}-${prog.get(it.id)?.notes ?? ''}`} it={it} p={prog.get(it.id)} today={today} busy={busy}
                  teach={launchState(reqs, (r) => r.kind === 'teach_item' && r.payload.item_id === it.id, now)}
                  onPatch={(patch) => save.mutate({ itemId: it.id, patch })}
                  onTeach={() => launch.mutate({ kind: 'teach_item', payload: { item_id: it.id } })} />
              ))}
            </ul>
          </section>
        );
      })}
      {checks.length > 0 && (
        <Disclosure summary={`Checks and reviews (${checks.length})`}>
          <ul className="list">
            {checks.map((c) => (
              <li key={c.id} className="list-row">
                <span>{c.kind === 'check' ? 'Check' : 'Review'} · {c.score}/{c.total} · {RATINGS.find((r) => r.value === c.rating)?.label}</span>
                <span className="muted small">{shortDate(c.taken_on)}{c.summary && ` · ${c.summary}`}</span>
              </li>
            ))}
          </ul>
        </Disclosure>
      )}
    </Card>
  );
}

export default function Learn() {
  const { track = 'cs' } = useParams();
  const now = useNow();
  const today = planDay(now);
  const { state, data, retry } = useLearnData();
  const info = TRACKS.find((t) => t.id === track) ?? TRACKS[0];
  const views = moduleViews(data, info.id as LearnTrack, today);
  const [open, setOpen] = useState<string | null>(null);
  const selected = views.find((v) => v.module.id === open)
    ?? views.find((v) => v.status === 'review') ?? views.find((v) => v.status === 'in_progress') ?? views.find((v) => v.status === 'not_started') ?? views[0];
  const doneCount = views.filter((v) => v.doneOn).length;

  return (
    <div className="screen">
      <header className="screen-head">
        <h1>{info.label}</h1>
        {views.length > 0 && <span className="count">{doneCount}/{views.length} modules</span>}
      </header>
      {state === 'loading' ? (
        <Skeleton label={`Loading ${info.label}`} />
      ) : state === 'error' ? (
        <LoadError what={`the ${info.label} track`} onRetry={retry} />
      ) : views.length === 0 ? (
        <Empty>No modules yet. They appear after the next sync.</Empty>
      ) : (
        <>
          <Card data-primary aria-labelledby="learn-map-h">
            <CardHead id="learn-map-h" title="Roadmap" />
            <p className="muted small">In recommended order. Every module is open: start anywhere.</p>
            <ol className="roadmap learn-roadmap">
              {views.map((v) => (
                <li key={v.module.id}>
                  <button type="button" className={`topic ${MODULE_CLASS[v.status]}${selected?.module.id === v.module.id ? ' is-focus' : ''}`}
                    aria-expanded={selected?.module.id === v.module.id} aria-controls="module-detail"
                    aria-label={`${v.module.ord}. ${v.module.title}, ${MODULE_LABEL[v.status]}, ${v.done} of ${v.total} done`}
                    data-sub={`${MODULE_LABEL[v.status]} · ${v.done}/${v.total}`} onClick={() => setOpen(v.module.id)}>
                    {v.module.ord}. {v.module.title}
                  </button>
                </li>
              ))}
            </ol>
          </Card>
          <div id="module-detail" aria-live="polite">
            {selected && <ModuleDetail key={selected.module.id} v={selected} data={data} today={today} />}
          </div>
        </>
      )}
    </div>
  );
}
