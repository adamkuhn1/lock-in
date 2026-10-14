import { useEffect, useRef } from 'react';
import type { DayActivity } from '../lib/activity';
import { shortDate } from '../lib/time';

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
function title(d: DayActivity): string {
  const parts = [
    d.solves && plural(d.solves, 'solve'), d.applications && plural(d.applications, 'app'), d.outreach && plural(d.outreach, 'email'),
    d.commits && plural(d.commits, 'commit'), d.prep && plural(d.prep, 'prep session'),
  ].filter(Boolean);
  return `${shortDate(d.day)}: ${parts.length ? parts.join(', ') : 'nothing yet'}`;
}

export function Heatmap({ weeks, totalDays }: { weeks: (DayActivity | null)[][]; totalDays: number }) {
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => { const el = scroller.current; if (el) el.scrollLeft = el.scrollWidth; }, [weeks.length]);
  const active = weeks.flat().filter((d) => d?.active).length;
  return (
    <div className="heatmap">
      <div className="heat-scroll" ref={scroller}>
        <div className="heat-grid" role="img" aria-label={`Activity: ${active} of ${totalDays} days active`}>
          {weeks.map((w, i) => (
            <div className="heat-col" key={i}>
              {w.map((d, j) => (
                <span key={j} className={d ? `heat-cell h${d.intensity}` : 'heat-cell blank'} title={d ? title(d) : undefined} />
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="heat-foot label" aria-hidden="true">
        <span>{totalDays} {totalDays === 1 ? 'day' : 'days'}</span>
        <span className="heat-legend">less <i className="h0" /><i className="h1" /><i className="h2" /><i className="h3" /><i className="h4" /> more</span>
      </div>
    </div>
  );
}
