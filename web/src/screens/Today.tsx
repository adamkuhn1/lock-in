import { Link } from 'react-router';
import { useTodayStats } from '../data/useTodayStats';
import { Heatmap } from '../ui/Heatmap';
import { useCountUp } from '../ui/motion';
import { LoadError, Skeleton } from '../ui/primitives';
import { Ring } from '../ui/Ring';
import { ratePct, replyTotal } from '../lib/referrals';
import { tierLabel } from '../lib/tiers';
import { FunnelTile } from '../ui/StatTile';

export default function Today() {
  const { state, retry, stats } = useTodayStats();
  const shown = useCountUp(stats?.n ?? 0);
  if (state === 'loading') return <Skeleton label="Loading today" />;
  if (state === 'error' || !stats) return <LoadError what="today" onRetry={retry} />;
  const s = stats;
  return (
    <div className="screen today">
      <header className="today-head" data-primary>
        <p className="label today-line">
          {s.dateLine}{s.streak > 0 && <> · <span className="streak-chip"><span aria-hidden="true">🔥</span> {s.streak} day streak</span></>}
        </p>
        <h1 className="day-n" aria-label={`Day ${s.n}`}>Day <span>{shown}</span></h1>
      </header>
      <section className="today-heat" aria-label="Activity">
        <Heatmap weeks={s.weeks} totalDays={s.days.length} />
      </section>
      <section className="rings" aria-label="Rings">
        <Link to="/grind/leetcode" className="ring-link">
          <Ring value={s.lcDone} max={s.lcTotal} label="LeetCode today" caption={`LC /${s.lcTotal}`} color="orange" />
        </Link>
        <Link to="/hunt/apps" className="ring-link">
          <Ring value={s.appsWeek} max={s.appTarget} label="Applications this week" caption={`Apps /${s.appTarget}`} color="yellow" />
        </Link>
        <Link to="/hunt/engineers" className="ring-link">
          <Ring value={s.notesWeek} max={s.notesTarget} label="LinkedIn notes to engineers this week" caption={`Notes /${s.notesTarget}`} color="green" />
        </Link>
        <Link to="/hunt/outreach" className="ring-link">
          <Ring value={s.emailsWeek} max={s.emailTarget} label="Emails this week" caption={`Emails /${s.emailTarget}`} color="cyan" />
        </Link>
      </section>
      {s.reachUncovered > 0 && (
        <p className="small today-flag">
          <Link to="/hunt/apps">{s.reachUncovered} Reach application{s.reachUncovered === 1 ? '' : 's'} with no engineer contacted yet</Link>
        </p>
      )}
      <section className="funnel-tiles" aria-labelledby="season-h">
        <h2 id="season-h">Season</h2>
        {s.funnel.map((r) => (
          <Link key={r.stage} to="/hunt/apps" className="tile-link"><FunnelTile row={r} /></Link>
        ))}
      </section>
      <section aria-labelledby="replies-h">
        <h2 id="replies-h">Reply rate</h2>
        <table className="funnel reply-rates" aria-labelledby="replies-h">
          <thead><tr><th scope="col">Tier</th><th scope="col">LinkedIn notes</th><th scope="col">Recruiter emails</th></tr></thead>
          <tbody>
            {[...s.replies.map((r) => ({ label: tierLabel(r.tier), notes: r.notes, emails: r.emails })),
              { label: 'All', notes: replyTotal(s.replies, 'notes'), emails: replyTotal(s.replies, 'emails') }].map((r) => (
              <tr key={r.label}>
                <th scope="row">{r.label}</th>
                <td>{ratePct(r.notes)} <span className="muted small">{r.notes.replied}/{r.notes.sent}</span></td>
                <td>{ratePct(r.emails)} <span className="muted small">{r.emails.replied}/{r.emails.sent}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
