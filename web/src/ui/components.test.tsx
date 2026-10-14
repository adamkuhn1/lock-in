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
    rerender(<IdeaCard idea={idea} state={{ kind: 'failed', error: 'LaunchError: Project folder not found' }} busy={false} onWork={onWork} onDone={() => {}} />);
    expect(screen.getByText(/Project folder not found/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Work on this: Add Chicago' })).toBeEnabled();
  });
});
