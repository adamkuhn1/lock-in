import { useState } from 'react';
import { useApplications, useNow, useSettings } from '../data/hooks';
import { STAGE_LABEL, appliedThisWeek, funnel, groupByStage, searchApps } from '../lib/funnel';
import { localDay, shortDate } from '../lib/time';
import { Card, CardHead, Disclosure, Empty, ExternalLink, LoadError, Skeleton } from '../ui/primitives';

const OPEN_BY_DEFAULT = new Set(['offer', 'interview', 'oa']);

export default function Applications() {
  const now = useNow();
  const apps = useApplications();
  const settings = useSettings();
  const [q, setQ] = useState('');
  const list = apps.data ?? [];
  const week = appliedThisWeek(list, localDay(now));
  const target = settings.data?.weekly_app_target ?? 25;
  const rows = funnel(list);
  const searching = q.trim() !== '';
  const groups = groupByStage(searchApps(list, q));
  const sheetId = settings.data?.sheet_id;
  const sheet = sheetId ? `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}` : null;

  return (
    <div className="screen screen-split">
      <header className="screen-head">
        <h1>Applications</h1>
        {sheet && <ExternalLink className="btn btn-quiet" href={sheet}>Open sheet</ExternalLink>}
      </header>

      <Card data-primary aria-labelledby="week-h">
        <CardHead id="week-h" title="This week" />
        {apps.isPending ? (
          <Skeleton label="Loading applications" />
        ) : apps.isError ? (
          <LoadError what="applications" onRetry={() => void apps.refetch()} />
        ) : (
          <>
            <p className="big-num"><b>{week}</b><span className="muted">of {target}</span></p>
            <div className="bar" role="progressbar" aria-label="Applications this week"
              aria-valuemin={0} aria-valuemax={target} aria-valuenow={week}>
              <span style={{ width: `${Math.min(100, (week / Math.max(1, target)) * 100)}%` }} />
            </div>
          </>
        )}
      </Card>

      <Card aria-labelledby="funnel-h">
        <CardHead id="funnel-h" title="Funnel" />
        {apps.isPending ? (
          <Skeleton label="Loading funnel" />
        ) : apps.isError ? (
          <LoadError what="funnel" onRetry={() => void apps.refetch()} />
        ) : (
          <>
            <table className="funnel" aria-labelledby="funnel-h">
              <thead>
                <tr><th scope="col">Stage</th><th scope="col">You</th><th scope="col">Rate</th><th scope="col">Typical</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.stage}>
                    <th scope="row">{r.label}</th>
                    <td>{r.count}</td>
                    <td>{r.pct === null ? '—' : `${r.pct}%`}</td>
                    <td className="muted">{r.refPct === null ? '—' : `${r.refPct}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        <p className="muted small">Typical: 582 → 54 → 13 → 5.</p>
      </Card>

      <Card className="span-all" aria-labelledby="board-h">
        <CardHead id="board-h" title="Board" />
        <label className="field">
          <span>Search</span>
          <input type="search" value={q} placeholder="Company, role or status" onChange={(e) => setQ(e.target.value)} />
        </label>
        {apps.isPending ? (
          <Skeleton label="Loading board" />
        ) : apps.isError ? (
          <LoadError what="board" onRetry={() => void apps.refetch()} />
        ) : groups.length === 0 ? (
          <Empty>{searching ? 'No matches.' : 'No applications yet.'}</Empty>
        ) : (
          groups.map(([stage, items]) => (
            <Disclosure key={`${stage}-${searching}`} open={searching || OPEN_BY_DEFAULT.has(stage)}
              summary={`${STAGE_LABEL[stage]} (${items.length})`}>
              <ul>
                {items.map((a) => (
                  <li key={a.id} className="app-row">
                    <span className="job-title">{a.company}</span>
                    {a.role && <span className="small">{a.role}</span>}
                    <span className="muted small">{[a.status, a.applied_on && shortDate(a.applied_on)].filter(Boolean).join(' · ')}</span>
                  </li>
                ))}
              </ul>
            </Disclosure>
          ))
        )}
      </Card>
    </div>
  );
}
