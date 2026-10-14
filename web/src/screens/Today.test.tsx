import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AlreadyCountedError } from '../data/api';
import { createDemoApi } from '../data/demo';
import { renderWithData } from '../test/render';
import Today from './Today';

describe('Today', () => {
  it('leads with the day and the LeetCode set', async () => {
    const { container } = renderWithData(<Today />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Day 12' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { level: 2, name: 'Sliding Window' })).toBeInTheDocument();
    expect(await screen.findAllByRole('listitem', {}, { timeout: 2000 })).not.toHaveLength(0);
    expect(container.querySelector('[data-primary]')).toHaveTextContent('Sliding Window');
    expect(container.querySelector('.count')).toHaveTextContent('2/6');
  });
  it('hides the mystery topic', async () => {
    renderWithData(<Today />);
    const row = await screen.findByRole('link', { name: /Daily Temperatures/ });
    expect(row).toHaveTextContent('Mystery');
    expect(row).not.toHaveTextContent('Stack');
  });
  it('one tap rates a fresh solve and the buttons go away', async () => {
    const api = createDemoApi();
    const spy = vi.spyOn(api, 'rateSolve');
    renderWithData(<Today />, { api });
    const group = await screen.findByRole('group', { name: 'How did Best Time to Buy and Sell Stock go?' });
    await userEvent.click(within(group).getByRole('button', { name: 'Nailed it' }));
    expect(spy).toHaveBeenCalledWith(expect.any(Number), 'nailed', expect.any(Date));
    await waitFor(() => expect(screen.queryByRole('group', { name: /How did/ })).toBeNull());
  });
  it("shows today's idea and marks it done", async () => {
    const api = createDemoApi();
    const spy = vi.spyOn(api, 'updateIdea');
    renderWithData(<Today />, { api });
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Add Chicago to the city picker' }));
    expect(spy).toHaveBeenCalledWith('i1', expect.objectContaining({ status: 'done' }));
  });
  it('shows new postings with stars and hides zero follow-ups', async () => {
    renderWithData(<Today />);
    expect(await screen.findByRole('link', { name: /New postings\s*8 · 3 ⭐/ })).toHaveAttribute('href', '/jobs');
    expect(screen.queryByText('Follow-ups due')).toBeNull();
  });
  it('Today before the first set', async () => {
    const api = createDemoApi();
    api.getDailySet = async () => null;
    renderWithData(<Today />, { api });
    expect(await screen.findByText('No set yet.')).toBeInTheDocument(); // M11
  });
  it('late solves show the counted state instead of rating buttons', async () => {
    const api = createDemoApi();
    const list = api.listSolves.bind(api);
    api.listSolves = async () => (await list()).map((s) => ({ ...s, applied_at: s.applied_at ?? '2026-01-01T00:00:00Z' }));
    renderWithData(<Today />, { api });
    expect(await screen.findByText(/Counted as/)).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: /How did/ })).toBeNull();
  });
  it('hides the topic of a non-mystery item on a mixed day until solved', async () => {
    const api = createDemoApi();
    const get = api.getDailySet.bind(api);
    api.getDailySet = async (d) => { const set = await get(d); return set && { ...set, mixed_day: true }; };
    renderWithData(<Today />, { api });
    expect(await screen.findByRole('heading', { level: 2, name: 'Mixed day' })).toBeInTheDocument();
    const row = await screen.findByRole('link', { name: /Contains Duplicate II/ });
    expect(row).not.toHaveTextContent('Sliding Window');
    expect(row).not.toHaveTextContent('Hash');
  });
  it('a failed rating write restores the buttons', async () => {
    const api = createDemoApi();
    const spy = vi.spyOn(api, 'rateSolve').mockRejectedValue(new Error('nope'));
    renderWithData(<Today />, { api });
    const group = await screen.findByRole('group', { name: 'How did Best Time to Buy and Sell Stock go?' });
    await userEvent.click(within(group).getByRole('button', { name: 'Nailed it' }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(await screen.findByRole('group', { name: 'How did Best Time to Buy and Sell Stock go?' })).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: /How did Best Time/ })).getByRole('button', { name: 'Nailed it' })).toBeEnabled();
  });
  it('a failed rating write says so in the set card (I3)', async () => {
    const api = createDemoApi();
    vi.spyOn(api, 'rateSolve').mockRejectedValue(new Error('nope'));
    const { container } = renderWithData(<Today />, { api });
    const group = await screen.findByRole('group', { name: 'How did Best Time to Buy and Sell Stock go?' });
    await userEvent.click(within(group).getByRole('button', { name: 'Nailed it' }));
    expect(await screen.findByText("Couldn't save rating. Try again.")).toBeInTheDocument();
    expect(container.querySelector('[data-primary]')).toHaveTextContent("Couldn't save rating. Try again.");
  });
  it('a rating the worker beat says Already counted (I3/I4)', async () => {
    const api = createDemoApi();
    vi.spyOn(api, 'rateSolve').mockRejectedValue(new AlreadyCountedError());
    renderWithData(<Today />, { api });
    const group = await screen.findByRole('group', { name: 'How did Best Time to Buy and Sell Stock go?' });
    await userEvent.click(within(group).getByRole('button', { name: 'Nailed it' }));
    expect(await screen.findByText('Already counted.')).toBeInTheDocument();
    expect(screen.queryByText("Couldn't save rating. Try again.")).toBeNull();
  });
});
