import { ChevronLeft, ChevronRight, ExternalLink as LinkIcon, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useAddEvent, useApplications, useCompanyPrep, useDeleteEvent, useEvents, useNow, useOutreach, useSettings } from '../data/hooks';
import type { EventKind } from '../data/types';
import { KIND_LABEL, addMonths, calendarItems, countdown, dotKind, groupByWeek, monthGrid, upcoming, weekFocus, type CalItem } from '../lib/calendar';
import { appliedThisWeek } from '../lib/funnel';
import { addDays, planDay, shortDate, weekStart } from '../lib/time';
import { safeHref } from '../lib/url';
import { Button, Card, CardHead, Empty, ExternalLink, LoadError, Skeleton } from '../ui/primitives';

const SAVE_ERROR = "Couldn't save. Try again.";
const KINDS = Object.keys(KIND_LABEL) as EventKind[];
const monthTitle = (m: string) => new Date(`${m}-01T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

function CalRow({ item, day, onDelete, busy }: { item: CalItem; day: string; onDelete: (id: string) => void; busy: boolean }) {
  return (
    <li className="cal-row">
      <span className="cal-date label">{shortDate(item.on_date)}{item.at_time ? ` ${item.at_time.slice(0, 5)}` : ''}</span>
      <span className="cal-main">
        <span className={`cal-kind k-${item.kind}`}>{KIND_LABEL[item.kind]}</span>
        <span className="cal-title">{item.title}</span>
        {item.company && !item.title.includes(item.company) && <span className="muted small">{item.company}</span>}
      </span>
      <span className="cal-count">{countdown(item.on_date, day)}</span>
      {item.url && <ExternalLink className="btn btn-quiet" href={item.url}><LinkIcon size={16} aria-hidden /><span className="sr-only">Open link: {item.title}</span></ExternalLink>}
      {item.eventId && (
        <Button variant="quiet" aria-label={`Delete: ${item.title}`} disabled={busy} onClick={() => onDelete(item.eventId!)}><X size={18} aria-hidden /></Button>
      )}
    </li>
  );
}

function AddEventCard({ day }: { day: string }) {
  const add = useAddEvent();
  const empty = { title: '', kind: 'oa' as EventKind, on_date: day, at_time: '', company: '', url: '' };
  const [f, setF] = useState(empty);
  const [err, setErr] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const problem = !f.title.trim() ? 'Title is required.'
      : !/^\d{4}-\d{2}-\d{2}$/.test(f.on_date) ? 'Pick a date.'
      : f.url.trim() && !safeHref(f.url.trim()) ? 'Link must start with http:// or https://'
      : null;
    setErr(problem);
    if (problem) return;
    add.mutate({
      title: f.title.trim(), kind: f.kind, on_date: f.on_date, at_time: f.at_time || null,
      company: f.company.trim() || null, url: f.url.trim() || null,
    }, { onSuccess: () => setF({ ...empty }) });
  };
  const input = (k: 'title' | 'company' | 'url', label: string, placeholder: string) => (
    <label className="field"><span>{label}</span>
      <input maxLength={k === 'url' ? 500 : 120} value={f[k]} placeholder={placeholder} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>
  );
  return (
    <Card aria-labelledby="add-h">
      <CardHead id="add-h" title="New event" />
      <form className="stack" onSubmit={submit}>
        {input('title', 'Title', 'Stripe OA due')}
        <div className="prep-fields">
          <label className="field"><span>Kind</span>
            <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as EventKind })}>
              {KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
            </select></label>
          <label className="field"><span>Date</span>
            <input type="date" value={f.on_date} onChange={(e) => setF({ ...f, on_date: e.target.value })} /></label>
        </div>
        <label className="field"><span>Time (optional)</span>
          <input type="time" value={f.at_time} onChange={(e) => setF({ ...f, at_time: e.target.value })} /></label>
        {input('company', 'Company (optional)', 'Stripe')}
        {input('url', 'Link (optional)', 'https://…')}
        {err && <p role="alert" className="error small">{err}</p>}
        {add.isError && <p role="alert" className="error small">{SAVE_ERROR}</p>}
        <div><Button type="submit" variant="primary" disabled={add.isPending}>Add event</Button></div>
      </form>
    </Card>
  );
}

export default function Calendar() {
  const now = useNow();
  const day = planDay(now);
  const events = useEvents();
  const cprep = useCompanyPrep();
  const outreach = useOutreach();
  const settings = useSettings();
  const apps = useApplications();
  const del = useDeleteEvent();
  const [month, setMonth] = useState(day.slice(0, 7));
  const [picked, setPicked] = useState<string | null>(null);
  if (events.isPending || settings.isPending) return <Skeleton label="Loading calendar" />;
  if (events.isError) return <LoadError what="the calendar" onRetry={() => void events.refetch()} />;

  const items = calendarItems(events.data ?? [], cprep.data ?? [], outreach.data ?? []);
  const target = settings.data?.weekly_app_target ?? 25;
  const focus = weekFocus(items, day, target);
  const ws = weekStart(day);
  const weekCount = items.filter((i) => i.on_date >= ws && i.on_date <= addDays(ws, 6)).length;
  const byDay = new Map<string, CalItem[]>();
  for (const i of items) byDay.set(i.on_date, [...(byDay.get(i.on_date) ?? []), i]);
  const list = picked ? (byDay.get(picked) ?? []) : upcoming(items, day);
  const groups = picked ? [{ label: '', items: list }] : groupByWeek(list, day);
  const go = (n: number) => { setMonth(addMonths(month, n)); setPicked(null); };

  return (
    <div className="screen">
      <header className="screen-head"><h1>Calendar</h1></header>

      <Card data-primary aria-labelledby="week-h">
        <CardHead id="week-h" title="This week" />
        {focus.to
          ? <Link className="row-link focus-line" to={focus.to}><span>{focus.text}</span><ChevronRight size={18} aria-hidden /></Link>
          : <p className="focus-line">{focus.text}</p>}
        <p className="muted small">{appliedThisWeek(apps.data ?? [], day)}/{target} apps · {weekCount} {weekCount === 1 ? 'event' : 'events'}</p>
      </Card>

      <Card aria-labelledby="month-h">
        <CardHead id="month-h" title={monthTitle(month)}>
          <div className="row-actions">
            <Button variant="quiet" aria-label="Previous month" onClick={() => go(-1)}><ChevronLeft size={18} aria-hidden /></Button>
            <Button variant="quiet" aria-label="Next month" onClick={() => go(1)}><ChevronRight size={18} aria-hidden /></Button>
          </div>
        </CardHead>
        <div className="month">
          <div className="month-row month-head" aria-hidden="true">{['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <span key={i}>{d}</span>)}</div>
          {monthGrid(month).map((w, i) => (
            <div className="month-row" key={i}>
              {w.map((d, j) => {
                if (d === null) return <span key={j} className="month-day blank" />;
                const its = byDay.get(d) ?? [];
                const k = dotKind(its);
                return (
                  <button key={j} type="button" data-day={d} className={d === day ? 'month-day is-today' : 'month-day'} aria-pressed={picked === d}
                    aria-label={`${shortDate(d)}${its.length ? `, ${its.length} ${its.length === 1 ? 'item' : 'items'}` : ''}`}
                    onClick={() => setPicked(picked === d ? null : d)}>
                    <span>{Number(d.slice(8))}</span>{k && <i className={`cal-dot k-${k}`} aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </Card>

      <Card aria-labelledby="up-h">
        <CardHead id="up-h" title={picked ? shortDate(picked) : 'Upcoming'}>
          {picked && <Button variant="quiet" onClick={() => setPicked(null)}>Show all</Button>}
        </CardHead>
        {list.length === 0
          ? <Empty>{picked ? 'Nothing that day.' : 'Nothing coming up. Add an OA, interview or deadline below.'}</Empty>
          : groups.map((g) => (
            <section key={g.label || 'day'} className="cal-group">
              {g.label && <h3 className="label">{g.label}</h3>}
              <ul className="list">{g.items.map((i) => <CalRow key={i.key} item={i} day={day} busy={del.isPending} onDelete={(id) => del.mutate(id)} />)}</ul>
            </section>
          ))}
        {del.isError && <p role="alert" className="error small">{SAVE_ERROR}</p>}
      </Card>

      <AddEventCard day={day} />
    </div>
  );
}
