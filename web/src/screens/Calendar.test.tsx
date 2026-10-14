import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createDemoApi } from '../data/demo';
import { addDays, planDay } from '../lib/time';
import { renderWithData } from '../test/render';
import Calendar from './Calendar';

const day = planDay(new Date());

describe('Calendar', () => {
  it('This week focus picks the interview within 7 days', async () => {
    const { container } = renderWithData(<Calendar />);
    const primary = await screen.findByRole('region', { name: 'This week' });
    expect(container.querySelector('[data-primary]')).toBe(primary);
    expect(within(primary).getByRole('link', { name: /^Interview in 3 days: mock \+ company notes/ })).toHaveAttribute('href', '/grind/prep');
  });

  it('Upcoming merges events, interviews and follow-ups by week with countdowns', async () => {
    renderWithData(<Calendar />);
    const up = await screen.findByRole('region', { name: 'Upcoming' });
    expect(within(up).getByText('Amazon OA due')).toBeInTheDocument();
    expect(within(up).getByText('Datadog interview')).toBeInTheDocument();
    expect(within(up).getByText('Follow up: Datadog')).toBeInTheDocument();
    expect(within(up).getAllByText('in 2 days').length).toBeGreaterThan(0);
  });

  it('tapping a day filters the list; tapping again clears', async () => {
    renderWithData(<Calendar />);
    const target = addDays(day, 2); // demo Amazon OA
    await screen.findByRole('region', { name: 'Upcoming' });
    if (target.slice(0, 7) !== day.slice(0, 7)) await userEvent.click(screen.getByRole('button', { name: 'Next month' }));
    const dayBtn = document.querySelector<HTMLButtonElement>(`button[data-day="${target}"]`)!;
    expect(dayBtn).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(dayBtn);
    expect(dayBtn).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('region', { name: 'Upcoming' })).toBeNull();
    expect(screen.getByText('Amazon OA due')).toBeInTheDocument();
    expect(screen.queryByText('Career fair')).toBeNull();
    await userEvent.click(dayBtn);
    expect(await screen.findByRole('region', { name: 'Upcoming' })).toBeInTheDocument();
  });

  it('adds and deletes an event', async () => {
    const api = createDemoApi();
    const add = vi.spyOn(api, 'addEvent');
    renderWithData(<Calendar />, { api });
    await userEvent.click(await screen.findByRole('button', { name: 'Add event' }));
    expect(screen.getByText('Title is required.')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Title'), 'Stripe interview');
    await userEvent.selectOptions(screen.getByLabelText('Kind'), 'interview');
    await userEvent.click(screen.getByRole('button', { name: 'Add event' }));
    expect(add).toHaveBeenCalledWith({ title: 'Stripe interview', kind: 'interview', on_date: day, at_time: null, company: null, url: null });
    const row = await screen.findByText('Stripe interview');
    await userEvent.click(within(row.closest('li')!).getByRole('button', { name: 'Delete: Stripe interview' }));
    expect(screen.queryByText('Stripe interview')).toBeNull();
  });

  it('month navigation', async () => {
    renderWithData(<Calendar />);
    const text = (await screen.findByText(/^[A-Z][a-z]+ \d{4}$/)).textContent;
    await userEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(screen.getByText(/^[A-Z][a-z]+ \d{4}$/).textContent).not.toBe(text);
  });
});
