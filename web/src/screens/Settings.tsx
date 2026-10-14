import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useState, type FormEvent } from 'react';
import { useAuth } from '../data/context';
import { useAddProject, useNow, useProjects, useSetProjectActive, useSettings, useSyncStatus, useUpdateSettings } from '../data/hooks';
import type { Project } from '../data/types';
import { STAGE_LABEL } from '../lib/funnel';
import { STAGE_RULES } from '../lib/stages';
import { SOURCE_LABEL, isStale } from '../lib/sync';
import { relativeTime } from '../lib/time';
import { safeHref } from '../lib/url';
import { Badge, Button, Card, CardHead, Disclosure, Empty, ErrorDetail } from '../ui/primitives';

function TextField({ label, value, placeholder, validate, onSave }: {
  label: string; value: string; placeholder?: string; validate?: (v: string) => string | null;
  onSave: (v: string, cb: { onSuccess: () => void; onError: () => void }) => void;
}) {
  const id = useId();
  const [v, setV] = useState(value);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => setV(value), [value]);
  const commit = () => {
    const t = v.trim();
    if (t === value) return;
    const e = validate?.(t) ?? null;
    setErr(e);
    if (e) return;
    setFailed(false);
    onSave(t, { onSuccess: () => setSaved(true), onError: () => setFailed(true) });
  };
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} value={v} placeholder={placeholder} aria-invalid={err ? true : undefined}
        aria-describedby={err ? `${id}-err` : undefined}
        onChange={(e) => { setV(e.target.value); setSaved(false); setFailed(false); }} onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); }} />
      {(err || failed) && <p id={`${id}-err`} className="error small">{err ?? SAVE_ERROR}</p>}
      <span className="muted small" aria-live="polite">{saved ? 'Saved' : ''}</span>
    </div>
  );
}

function NumberField({ label, value, min, max, onSave }: { label: string; value: number; min: number; max: number; onSave: (v: number) => void }) {
  const id = useId();
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  const commit = () => {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n)) { setV(String(value)); return; }
    const clamped = Math.min(max, Math.max(min, n));
    setV(String(clamped));
    if (clamped !== value) onSave(clamped);
  };
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} type="number" inputMode="numeric" min={min} max={max} value={v}
        onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit(); }} />
    </div>
  );
}

const SAVE_ERROR = "Couldn't save. Try again.";

const NUDGE_LABELS = ['Plan', 'Check-in', 'Streak alert'];

function NudgeTimes({ value, onSave }: { value: string[]; onSave: (v: string[]) => void }) {
  const [times, setTimes] = useState(value);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => setTimes(value), [value]);
  const dirty = times.join() !== value.join();
  const save = () => {
    const ok = times.length === 3 && times.every((t) => /^\d{2}:\d{2}$/.test(t)) && times[0] < times[1] && times[1] < times[2];
    setErr(ok ? null : 'Times must be in order.');
    if (ok && dirty) onSave(times);
  };
  return (
    <fieldset className="field" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget) && dirty) save(); }}>
      <legend className="muted small">Nudges</legend>
      <div className="times">
        {NUDGE_LABELS.map((label, i) => (
          <label key={label} className="field">
            <span>{label}</span>
            <input type="time" value={times[i] ?? ''}
              onChange={(e) => setTimes(times.map((t, j) => (j === i ? e.target.value : t)))} />
          </label>
        ))}
      </div>
      {dirty && <div><Button onClick={save}>Save times</Button></div>}
      {err && <p role="alert" className="error small">{err}</p>}
    </fieldset>
  );
}

const EMPTY_FORM = { id: '', name: '', repo: '', local_path: '' };

function ProjectsCard({ projects }: { projects: Project[] }) {
  const setActive = useSetProjectActive();
  const add = useAddProject();
  const [form, setForm] = useState(EMPTY_FORM);
  const [err, setErr] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const p = { id: form.id.trim().toLowerCase(), name: form.name.trim(), repo: form.repo.trim(), local_path: form.local_path.trim() || null };
    const problem =
      !/^[a-z0-9-]+$/.test(p.id) ? 'ID: lowercase letters, digits and dashes.'
      : !p.name ? 'Name is required.'
      : (!/^[A-Za-z0-9-][\w.-]*\/[\w.-]+$/.test(p.repo) || p.repo.includes('..')) ? 'Repo looks like owner/name.'
      : projects.some((x) => x.id === p.id) ? 'That ID is taken.'
      : null;
    setErr(problem);
    if (!problem) add.mutate(p, { onSuccess: () => setForm(EMPTY_FORM) });
  };
  const field = (key: keyof typeof EMPTY_FORM, label: string, placeholder: string) => (
    <label className="field">
      <span>{label}</span>
      <input value={form[key]} placeholder={placeholder} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
    </label>
  );
  return (
    <Card aria-labelledby="proj-h">
      <CardHead id="proj-h" title="Projects" />
      {setActive.isError && <p role="alert" className="error small">{SAVE_ERROR}</p>}
      <ul>
        {projects.map((p) => (
          <li key={p.id}>
            <label className="check-row">
              <input type="checkbox" checked={p.active} onChange={(e) => setActive.mutate({ id: p.id, active: e.target.checked })} />
              <span>{p.name} <span className="muted small">{p.repo}</span></span>
            </label>
          </li>
        ))}
      </ul>
      <Disclosure summary="New project">
        <form className="stack" onSubmit={submit}>
          {field('id', 'ID', 'lego')}
          {field('name', 'Name', 'LEGO from photo')}
          {field('repo', 'GitHub repo', 'adamkuhn1/lego')}
          {field('local_path', 'Folder on Mac', '~/Developer/lego')}
          <div><Button type="submit" variant="primary" disabled={add.isPending}>Add project</Button></div>
          {(err || add.isError) && <p role="alert" className="error small">{err ?? SAVE_ERROR}</p>}
        </form>
      </Disclosure>
    </Card>
  );
}

export default function Settings() {
  const now = useNow();
  const settings = useSettings();
  const projects = useProjects();
  const status = useSyncStatus();
  const update = useUpdateSettings();
  const auth = useAuth();
  const qc = useQueryClient();
  const s = settings.data;
  const rows = [...(status.data ?? [])].sort((a, b) => a.source.localeCompare(b.source));

  return (
    <div className="screen">
      <header className="screen-head"><h1>Settings</h1></header>

      <Card data-primary aria-labelledby="sync-h">
        <CardHead id="sync-h" title="Sync" />
        {rows.length === 0 ? <Empty>No syncs yet.</Empty> : (
          <ul>
            {rows.map((r) => (
              <li key={r.source} className="sync-row">
                <span>{SOURCE_LABEL[r.source] ?? r.source}</span>
                <span className="muted small">
                  {r.last_ok_at ? relativeTime(r.last_ok_at, now) : 'Never'}{' '}
                  {isStale(r, now) && <Badge tone="warn">Stale</Badge>}
                </span>
                {r.consecutive_failures > 0 && r.last_error && <div className="sync-error"><ErrorDetail error={r.last_error} /></div>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {s && (
        <Card aria-labelledby="targets-h">
          <CardHead id="targets-h" title="Targets" />
          <NumberField label="Applications per week" value={s.weekly_app_target} min={1} max={200} onSave={(v) => update.mutate({ weekly_app_target: v })} />
          <NudgeTimes value={s.nudge_times} onSave={(v) => update.mutate({ nudge_times: v })} />
        </Card>
      )}

      {(update.isError) && <p role="alert" className="error small">{SAVE_ERROR}</p>}

      <ProjectsCard projects={projects.data ?? []} />

      {s && (
        <Card aria-labelledby="mac-h">
          <CardHead id="mac-h" title="Mac" />
          <TextField label="Resume folder" value={s.resume_root} onSave={(v, cb) => update.mutate({ resume_root: v }, cb)}
            validate={(v) => (v ? null : 'Required.')} />
          <TextField label="App URL" value={s.app_url ?? ''} placeholder="https://lock-in.vercel.app"
            validate={(v) => (!v || safeHref(v) ? null : 'Must start with http:// or https://')}
            onSave={(v, cb) => update.mutate({ app_url: v || null }, cb)} />
        </Card>
      )}

      <Card aria-labelledby="rules-h">
        <CardHead id="rules-h" title="Sheet stages" />
        <table className="rules" aria-labelledby="rules-h">
          <thead className="sr-only"><tr><th scope="col">Status matches</th><th scope="col">Stage</th></tr></thead>
          <tbody>
            {STAGE_RULES.map(([pattern, stage]) => (
              <tr key={pattern}><td><code>{pattern}</code></td><td>{STAGE_LABEL[stage]}</td></tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">First match wins. Anything else is Other.</p>
      </Card>

      <div>
        <Button variant="danger" onClick={async () => { await auth.signOut(); qc.clear(); }}>Sign out</Button>
      </div>
    </div>
  );
}
