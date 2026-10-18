import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createDemoApi } from '../data/demo';
import { addDays, planDay, weekStart } from '../lib/time';
import { renderWithData } from '../test/render';
import Today from './Today';

describe('Today', () => {
  it('shows Day N, streak, heatmap, three rings and the funnel', async () => {
    const { container } = renderWithData(<Today />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Day 21' })).toBeInTheDocument(); // demo day_one = today - 20
    expect(container.querySelector('[data-primary]')).toHaveTextContent(/DAY STREAK/i);
    expect(screen.getByRole('img', { name: /^Activity: \d+ of 21 days active$/ })).toBeInTheDocument();
    expect(await screen.findByRole('img', { name: /^LeetCode today: \d+ of 6$/ })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /^Applications this week: \d+ of 25$/ })).toBeInTheDocument();
    // Demo outreach was sent today (2) and 5 days ago (counts only on a weekend, when that day is still this week).
    const day = planDay(new Date());
    const emails = 2 + (addDays(day, -5) >= weekStart(day) ? 1 : 0);
    expect(screen.getByRole('img', { name: `Emails this week: ${emails} of 10` })).toBeInTheDocument();
    for (const t of ['Applications', 'Online assessments', 'Interviews', 'Offers']) expect(screen.getByText(t)).toBeInTheDocument();
    expect(screen.getByText('vs 9%')).toBeInTheDocument();
    expect(screen.getByText('vs 38%')).toBeInTheDocument(); // Offers: 5/13, rounded only at display
    const fire = container.querySelector('.streak-chip [aria-hidden="true"]');
    expect(fire).toHaveTextContent('🔥');
    expect(container.querySelector('.streak-chip')).toHaveTextContent(/\d+ day streak/);
  });

  it('rings and tiles link to their screens', async () => {
    renderWithData(<Today />);
    const lc = await screen.findByRole('img', { name: /^LeetCode today/ });
    expect(lc.closest('a')).toHaveAttribute('href', '/grind/leetcode');
    expect(screen.getByRole('img', { name: /^Emails this week/ }).closest('a')).toHaveAttribute('href', '/hunt/outreach');
    expect(screen.getByText('Offers').closest('a')).toHaveAttribute('href', '/hunt/apps');
  });

  it('a future Day 1 shows DAY 0 and an empty heatmap without crashing', async () => {
    const api = createDemoApi();
    await api.updateSettings({ day_one: '2099-01-01' });
    renderWithData(<Today />, { api });
    expect(await screen.findByRole('heading', { level: 1, name: 'Day 0' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Activity: 0 of 0 days active' })).toBeInTheDocument();
    expect(screen.queryByText(/DAY STREAK/i)).toBeNull();
  });

  it('a settings load failure offers retry', async () => {
    const api = createDemoApi();
    api.getSettings = () => Promise.reject(new Error('boom'));
    renderWithData(<Today />, { api });
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load today.");
  });
});
