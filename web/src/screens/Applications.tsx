import { useState } from 'react';
import { Link } from 'react-router';
import {
  useApplications, useFindEngineers, useLaunchRequests, useNow, useReferrals, useSetApplicationStatus, useSettings, useSheetStatuses, useUndoApplied,
} from '../data/hooks';
import type { Application, Tier } from '../data/types';
import { STAGE_LABEL, appliedThisWeek, fmtPct, funnel, groupByStage, searchApps } from '../lib/funnel';
import { backing, latestFind, reachWithoutContact } from '../lib/referrals';
import { TIERS, TIER_LABEL } from '../lib/tiers';
import { localDay, shortDate } from '../lib/time';
import { funnelDetail } from '../ui/StatTile';
import { Badge, Button, Card, CardHead, Chip, Disclosure, Empty, ExternalLink, LoadError, Skeleton } from '../ui/primitives';

const OPEN_BY_DEFAULT = new Set(['offer', 'interview', 'oa']);

/** Native select of the Sheet's Status options; writes immediately, reverts on error. */
function StatusSelect({ a, options }: { a: Application; options: string[] }) {
  const set = useSetApplicationStatus();
  const current = a.status ?? '';
  const list = current && !options.includes(current) ? [current, ...options] : options;
  return (
    <span className="status-edit">
      <select aria-label={`Status for ${[a.company, a.role].filter(Boolean).join(' ')}`} value={current} disabled={set.isPending}
        onChange={(e) => set.mutate({ app: a, status: e.target.value })}>
        {!current && <option value="">No status</option>}
        {list.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
      <span className="muted small" aria-live="polite">{set.isPending ? 'Saving…' : set.isSuccess ? 'Saved' : ''}</span>
      {set.isError && <span role="alert" className="error small">{set.error.message}</span>}
    </span>
  );
}

/** Undo for an "I applied" from today that's still just Applied; older rows are real history and stay. */
function UndoApplied({ a }: { a: Application }) {
  const undo = useUndoApplied();
  return (
    <span className="status-edit">
      <Button variant="quiet" disabled={undo.isPending} aria-label={`Undo I applied: ${[a.company, a.role].filter(Boolean).join(' ')}`}
        onClick={() => undo.mutate({ company: a.company, role: a.role, sheet_row: a.sheet_row })}>
        {undo.isPending ? 'Undoing…' : 'Undo'}
      </Button>
      {undo.isError && <span role="alert" className="error small">{undo.error.message}</span>}
    </span>
  );
}

export default function Applications() {
  const now = useNow();
  const apps = useApplications();
  const settings = useSettings();
  const statuses = useSheetStatuses();
  const options = statuses.data ?? [];
  const [q, setQ] = useState('');
  const [tier, setTier] = useState<Tier | null>(null);
  const refs = useReferrals();
  const requests = useLaunchRequests();
  const find = useFindEngineers();
  const list = apps.data ?? [];
  const flagged = reachWithoutContact(list, refs.data ?? []);
  const today = localDay(now);
  const week = appliedThisWeek(list, today);
  const target = settings.data?.weekly_app_target ?? 25;
  const rows = funnel(list);
  const searching = q.trim() !== '';
  const groups = groupByStage(searchApps(tier ? list.filter((a) => a.tier === tier) : list, q));
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
                    <th scope="row">
                      {r.label}
                      {(r.stage === 'oa' || r.stage === 'interview') && <small className="muted funnel-detail">{funnelDetail(r)}</small>}
                    </th>
                    <td>{r.count}</td>
                    <td>{fmtPct(r.pct)}</td>
                    <td className="muted">{fmtPct(r.refPct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        <p className="muted small">Typical: 582 → 54 → 13 → 5.</p>
      </Card>

      {flagged.length > 0 && (
        <Card className="span-all" aria-labelledby="flag-h">
          <CardHead id="flag-h" title="Reach, no engineer yet"><Badge tone="warn">{flagged.length}</Badge></CardHead>
          <p className="muted small">Reach applications with nobody contacted at the company. A referral note is the best next step.</p>
          <ul className="flag-list">
            {flagged.map((a) => {
              const req = latestFind(requests.data ?? [], { company: a.company });
              const drafted = backing(a.company, refs.data ?? []) === 'drafted';
              const name = [a.company, a.role].filter(Boolean).join(' ');
              return (
                <li key={a.id} className="app-row">
                  <span className="job-title">{a.company}</span>
                  {a.role && <span className="small">{a.role}</span>}
                  {drafted ? (
                    <Link className="btn" to="/hunt/engineers">Note drafted, send it</Link>
                  ) : (
                    <Button variant="primary" aria-label={`Find engineers: ${name}`} disabled={find.isPending || req?.status === 'queued'}
                      onClick={() => find.mutate({ company: a.company, role: a.role, tier: a.tier ?? 'reach' })}>
                      {req?.status === 'queued' ? 'Queued for Mac' : req?.status === 'launched' ? 'Find again' : 'Find engineers'}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
          {find.isError && <p role="alert" className="error small">Couldn't queue it. Try again.</p>}
        </Card>
      )}

      <Card className="span-all" aria-labelledby="board-h">
        <CardHead id="board-h" title="Board" />
        <div className="chips" role="group" aria-label="Tier">
          {TIERS.map((t) => <Chip key={t} pressed={tier === t} onToggle={() => setTier(tier === t ? null : t)}>{TIER_LABEL[t]}</Chip>)}
        </div>
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
                    {a.tier && <span className="muted small">{TIER_LABEL[a.tier]}</span>}
                    {options.length > 0 ? (
                      <>
                        {a.applied_on && <span className="muted small">{shortDate(a.applied_on)}</span>}
                        <StatusSelect a={a} options={options} />
                        {a.applied_on === today && a.stage === 'applied' && <UndoApplied a={a} />}
                      </>
                    ) : (
                      <span className="muted small">{[a.status, a.applied_on && shortDate(a.applied_on)].filter(Boolean).join(' · ')}</span>
                    )}
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
