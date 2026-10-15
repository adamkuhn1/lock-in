import type { ReactNode } from 'react';
import { fmtPct, type FunnelRow, type FunnelStage } from '../lib/funnel';

export function StatTile({ label, value, children }: { label: string; value: ReactNode; children?: ReactNode }) {
  return (
    <div className="stat-tile">
      <div className="stat-main"><span className="label">{label}</span>{children}</div>
      <b className="num stat-value">{value}</b>
    </div>
  );
}

const FUNNEL_LABEL: Record<FunnelStage, string> = { applied: 'Applications', oa: 'Online assessments', interview: 'Interviews', offer: 'Offers' };

/** "2 active · 1 rejected · 67% passed" */
export const funnelDetail = (r: FunnelRow) => `${r.active} active · ${r.rejected} rejected · ${fmtPct(r.passRate)} passed`;

export function FunnelTile({ row }: { row: FunnelRow }) {
  const beats = row.pct !== null && row.refPct !== null && row.pct >= row.refPct;
  return (
    <StatTile label={FUNNEL_LABEL[row.stage]} value={row.count}>
      {row.stage !== 'applied' && (
        <span className={beats ? 'stat-rate beats' : 'stat-rate'}>
          <span>{fmtPct(row.pct)}</span> <span className="muted">vs {fmtPct(row.refPct)}</span>
        </span>
      )}
      {(row.stage === 'oa' || row.stage === 'interview') && (
        <span className="muted small stat-sub">{funnelDetail(row)}</span>
      )}
    </StatTile>
  );
}
