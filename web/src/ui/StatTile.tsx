import type { ReactNode } from 'react';
import type { FunnelRow, FunnelStage } from '../lib/funnel';

export function StatTile({ label, value, children }: { label: string; value: ReactNode; children?: ReactNode }) {
  return (
    <div className="stat-tile">
      <div className="stat-main"><span className="label">{label}</span>{children}</div>
      <b className="num stat-value">{value}</b>
    </div>
  );
}

const FUNNEL_LABEL: Record<FunnelStage, string> = { applied: 'Applications', oa: 'Online assessments', interview: 'Interviews', offer: 'Offers' };

export function FunnelTile({ row }: { row: FunnelRow }) {
  const rate = row.pct === null ? null : Math.round(row.pct);
  const ref = row.refPct === null ? null : Math.round(row.refPct);
  const beats = row.pct !== null && row.refPct !== null && row.pct >= row.refPct;
  return (
    <StatTile label={FUNNEL_LABEL[row.stage]} value={row.count}>
      {row.stage !== 'applied' && (
        <span className={beats ? 'stat-rate beats' : 'stat-rate'}>
          <span>{rate === null ? '—' : `${rate}%`}</span> <span className="muted">vs {ref}%</span>
        </span>
      )}
    </StatTile>
  );
}
