import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { Idea } from '../data/types';
import { dayActivity, heatmapWeeks } from '../lib/activity';
import { funnel } from '../lib/funnel';
import { Heatmap } from './Heatmap';
import { IdeaCard } from './IdeaCard';
import { Ring } from './Ring';
import { Segmented } from './Segmented';
import { FunnelTile } from './StatTile';

const idea: Idea = { id: 'i1', project_id: '27b', text: 'Add Chicago', size: 'S', status: 'todo', source: 'me', position: 0, today_on: null, done_at: null, started_at: null, created_at: '' };

describe('components', () => {
  it('Ring exposes value of max and caps the arc at 100%', () => {
    const { container } = render(<Ring value={30} max={25} label="Applications" caption="Apps /25" color="yellow" />);
    expect(screen.getByRole('img', { name: 'Applications: 30 of 25' })).toBeInTheDocument();
    expect(container.querySelector('figcaption b')).toHaveTextContent('30');
  });

  it('Heatmap renders one cell per day slot, with intensity classes and a summary', () => {
    const days = dayActivity({ solves: [], applications: [{ applied_on: '2026-10-14' }], outreach: [], commits: [], prep: [] }, '2026-10-14', '2026-10-15');
    const { container } = render(<Heatmap weeks={heatmapWeeks(days)} totalDays={days.length} />);
    expect(screen.getByRole('img', { name: 'Activity: 1 of 2 days active' })).toBeInTheDocument();
    expect(container.querySelectorAll('.heat-cell')).toHaveLength(7);
    expect(container.querySelectorAll('.heat-cell.h1')).toHaveLength(1);
    expect(container.querySelector('.heat-cell.h1')).toHaveAttribute('title', 'Oct 14: 1 app');
  });

  it('FunnelTile shows rate vs benchmark and dashes for zero denominators', () => {
    const rows = funnel([]);
    render(<><FunnelTile row={rows[0]} /><FunnelTile row={rows[1]} /></>);
    expect(screen.getByText('Applications')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('vs 9%')).toBeInTheDocument();
  });

  it('FunnelTile rounds only for display and compares raw rates', () => {
    const rows = funnel([]);
    // 23/60 = 38.3% shows as 38% like the 5/13 = 38.5% benchmark, but does not beat it.
    const offer = { ...rows[3], count: 23, pct: (23 / 60) * 100 };
    const { container } = render(<FunnelTile row={offer} />);
    expect(screen.getByText('vs 38%')).toBeInTheDocument();
    expect(screen.getByText('38%')).toBeInTheDocument();
    expect(container.querySelector('.stat-rate')).not.toHaveClass('beats');
  });

  it('FunnelTile shows active, rejected and pass rate for OA and interview rows only', () => {
    const rows = funnel([]);
    const oa = { ...rows[1], active: 1, rejected: 2, passed: 1, passRate: (1 / 3) * 100 };
    const { rerender } = render(<FunnelTile row={oa} />);
    expect(screen.getByText('1 active · 2 rejected · 33% passed')).toBeInTheDocument();
    rerender(<FunnelTile row={rows[1]} />);
    expect(screen.getByText('0 active · 0 rejected · — passed')).toBeInTheDocument();
    rerender(<FunnelTile row={rows[3]} />);
    expect(screen.queryByText(/active/)).toBeNull();
  });

  it('Segmented renders links with badges', () => {
    render(<MemoryRouter initialEntries={['/hunt/jobs']}><Segmented label="Hunt" items={[{ to: '/hunt/jobs', label: 'Jobs', badge: 4, badgeLabel: 'new' }, { to: '/hunt/apps', label: 'Applications' }]} /></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'Jobs, 4 new' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Applications' })).toBeInTheDocument();
  });

  it('IdeaCard: Work on this, queued, in progress, failed', async () => {
    const onWork = vi.fn();
    const { rerender } = render(<IdeaCard idea={idea} state={{ kind: 'idle' }} busy={false} onWork={onWork} onDone={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Work on this: Add Chicago' }));
    expect(onWork).toHaveBeenCalledOnce();
    rerender(<IdeaCard idea={{ ...idea, status: 'in_progress' }} state={{ kind: 'queued' }} busy={false} onWork={onWork} onDone={() => {}} />);
    expect(screen.getByRole('button', { name: 'Queued for Mac: Add Chicago' })).toBeDisabled();
    rerender(<IdeaCard idea={{ ...idea, status: 'in_progress' }} state={{ kind: 'launched' }} busy={false} onWork={onWork} onDone={() => {}} />);
    expect(screen.getByText('In progress')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Work on this/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Send again/ })).toBeNull();
    const onResend = vi.fn();
    rerender(<IdeaCard idea={{ ...idea, status: 'in_progress' }} state={{ kind: 'launched' }} busy={false} onWork={onWork} onResend={onResend} onDone={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Send again: Add Chicago' }));
    expect(onResend).toHaveBeenCalledOnce();
    expect(onWork).toHaveBeenCalledOnce();
    rerender(<IdeaCard idea={idea} state={{ kind: 'failed', error: 'LaunchError: Project folder not found' }} busy={false} onWork={onWork} onDone={() => {}} />);
    expect(screen.getByText(/Project folder not found/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Work on this: Add Chicago' })).toBeEnabled();
  });
});
